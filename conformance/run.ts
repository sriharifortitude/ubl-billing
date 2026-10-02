/**
 * Differential conformance test: ubl-billing against the official EN 16931
 * validation artefacts.
 *
 *   conformance/fetch.sh            download the pinned artefacts and Saxon
 *   npx tsx conformance/run.ts      run it
 *
 * A corpus is built from the official example invoices (valid by
 * construction) plus single-fault mutations of them. The official Schematron
 * says which business rules each document violates; ubl-billing says what
 * it thinks; the two are compared per document.
 *
 * What counts as a failure is chosen to matter in production, not to
 * maximise a score:
 *
 *   accepts-invalid:<rule>   the official validator rejects the document for
 *                            this rule, ubl-billing accepts it. An invalid
 *                            invoice getting through. Gated only for rules
 *                            ubl-billing says it implements.
 *   rejects-valid:<rule>     the official validator accepts it, ubl-billing
 *                            rejects it. A valid invoice refused.
 *                            ("parse-error" when it fails to read at all.)
 *   unknown-rule-id:<id>     ubl-billing cites a rule id the standard does
 *                            not contain.
 *
 * Everything else (rejecting an invalid document under a different id, or
 * with a parse error and no rule id) is reported, not gated. Anything gated
 * that isn't listed, with a reason, in known-differences.json fails the run.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IMPLEMENTED_RULES, fromUbl, validate } from '../src/index.js';
import { mutate, type Mutant } from './mutate.js';
import { officialAvailable, validateOfficially } from './official.js';

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const operators = flag('operators')?.split(',') as Mutant['operator'][] | undefined;
const limit = Number(flag('limit') ?? '0');
const seedFilter = flag('seeds')?.split(',');
const sampleEvery = Number(flag('sample') ?? '1');
const write = args.includes('--write-baseline');

if (!officialAvailable()) {
  console.error('The official artefacts are not downloaded. Run conformance/fetch.sh first.');
  process.exit(2);
}

/** A business rule: BR-nn, BR-CO-nn, BR-DEC-nn, and the per-category BR-S-nn, BR-IC-nn and so on. Not code lists (BR-CL) or syntax (UBL-*). */
const isBusinessRule = (id: string): boolean => /^BR-/.test(id) && !/^BR-CL-/.test(id);

// ---------------------------------------------------------------- corpus --
const cache = join(here, '.cache');
const seedDir = join(cache, 'ubl', 'examples');
const seeds = readdirSync(seedDir)
  .filter((f) => /\.xml$/i.test(f))
  .filter((f) => !seedFilter || seedFilter.some((s) => f.includes(s)))
  .sort();

const mutants: Mutant[] = [];
for (const seed of seeds) {
  const xml = readFileSync(join(seedDir, seed), 'utf8');
  for (const m of mutate(seed, xml, operators ? new Set(operators) : undefined)) mutants.push(m);
}
if (limit > 0) mutants.length = Math.min(mutants.length, limit);
if (sampleEvery > 1) {
  // Deterministic thinning for quick runs; every unmodified seed is kept.
  const kept = mutants.filter((m, i) => m.operator === 'seed' || i % sampleEvery === 0);
  mutants.length = 0;
  mutants.push(...kept);
}

const work = mkdtempSync(join(tmpdir(), 'ubl-conformance-'));
const inputDir = join(work, 'in');
mkdirSync(inputDir);
const fileOf = (i: number): string => `m${String(i).padStart(6, '0')}.xml`;
mutants.forEach((m, i) => writeFileSync(join(inputDir, fileOf(i)), m.xml));

console.log(`corpus: ${seeds.length} official invoices -> ${mutants.length} documents; validating officially...`);
const { results: official, crashed } = validateOfficially(inputDir, work);

// ------------------------------------------------------------------ ours --
interface Doc {
  readonly id: string;
  readonly operator: Mutant['operator'];
  readonly official: readonly string[];
  readonly ours: readonly string[];
  readonly parseError?: string;
}

const docs: Doc[] = mutants.flatMap((m, i): Doc[] => {
  const file = fileOf(i);
  if (crashed.has(file) || !official.has(file)) return [];
  const off = official.get(file)?.failed ?? [];
  try {
    const ours = [...new Set(validate(fromUbl(m.xml), { peppol: false }).filter((v) => v.severity === 'fatal').map((v) => v.rule))].sort();
    return [{ id: m.id, operator: m.operator, official: off, ours }];
  } catch (error) {
    return [{ id: m.id, operator: m.operator, official: off, ours: [], parseError: (error as Error).message }];
  }
});
rmSync(work, { recursive: true, force: true });

// A gate that has examined nothing has not passed. This is what an empty
// corpus (an unreadable seed directory, a filter that matched nothing, a
// validator that produced no output) would otherwise look like: success.
if (docs.length === 0 || docs.length < mutants.length / 2) {
  console.error(`only ${docs.length} of ${mutants.length} documents produced a comparable verdict; refusing to report on that`);
  process.exit(2);
}

// ------------------------------------------------------------- analysis --
const implemented = new Set(IMPLEMENTED_RULES);
const officialIds = new Set(readFileSync(join(here, 'official-rule-ids.txt'), 'utf8').split('\n').filter(Boolean));

type Outcome = 'same-rule' | 'other-rule' | 'parse-error' | 'accepted';
interface RuleStat {
  documents: number;
  outcomes: Record<Outcome, number>;
}
const perRule = new Map<string, RuleStat>();
const rejectsValid = new Map<string, string[]>();
const misattributed = new Map<string, number>();
const emitted = new Set<string>();
let validDocs = 0;
let agreeOnValid = 0;
let invalidDocs = 0;
let invalidRejected = 0;
let invalidRejectedWithRuleId = 0;

for (const d of docs) {
  for (const id of d.ours) emitted.add(id);
  const officialValid = d.official.length === 0;
  const oursRejects = d.parseError !== undefined || d.ours.length > 0;

  if (officialValid) {
    validDocs++;
    if (!oursRejects) agreeOnValid++;
    else if (d.parseError !== undefined) rejectsValid.set('parse-error', [...(rejectsValid.get('parse-error') ?? []), `${d.id}: ${d.parseError}`]);
    else for (const id of d.ours) rejectsValid.set(id, [...(rejectsValid.get(id) ?? []), d.id]);
    continue;
  }

  invalidDocs++;
  if (oursRejects) invalidRejected++;
  if (d.ours.length > 0) invalidRejectedWithRuleId++;
  for (const id of d.ours) if (!d.official.includes(id)) misattributed.set(id, (misattributed.get(id) ?? 0) + 1);

  for (const rule of d.official.filter(isBusinessRule)) {
    const s = perRule.get(rule) ?? { documents: 0, outcomes: { 'same-rule': 0, 'other-rule': 0, 'parse-error': 0, accepted: 0 } };
    s.documents++;
    const outcome: Outcome = d.ours.includes(rule) ? 'same-rule' : d.parseError !== undefined ? 'parse-error' : d.ours.length > 0 ? 'other-rule' : 'accepted';
    s.outcomes[outcome]++;
    perRule.set(rule, s);
  }
}

// The gated keys.
const observed = new Map<string, string>();
for (const [rule, s] of perRule) {
  if (implemented.has(rule) && s.outcomes.accepted > 0) {
    observed.set(`accepts-invalid:${rule}`, `${s.outcomes.accepted} of ${s.documents} documents the official validator rejects for this rule were accepted`);
  }
}
for (const [id, ids] of rejectsValid) observed.set(`rejects-valid:${id}`, `${ids.length} valid documents, e.g. ${ids[0]}`);
const claimed = new Set([...implemented, ...emitted]);
for (const id of [...claimed].sort()) {
  if (/^(BR-|UBL-)/.test(id) && !officialIds.has(id)) observed.set(`unknown-rule-id:${id}`, 'not a rule id in the official artefacts');
}

// --------------------------------------------------------------- report --
const pct = (a: number, b: number): string => (b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(1)}%`);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
if (crashed.size > 0) console.log(`\n${crashed.size} mutated document(s) crashed the official validator itself and are excluded (it has no verdict on them)`);
console.log(`\ndocuments              ${docs.length}  (${validDocs} the official validator accepts, ${invalidDocs} it rejects)`);
console.log(`valid, and accepted    ${agreeOnValid} of ${validDocs}  (${pct(agreeOnValid, validDocs)})   <- valid invoices ubl-billing does not refuse`);
console.log(`invalid, and rejected  ${invalidRejected} of ${invalidDocs}  (${pct(invalidRejected, invalidDocs)})   <- invalid invoices ubl-billing does not let through`);
console.log(`  of those, with a rule id  ${invalidRejectedWithRuleId} (the rest are parse errors that name no rule)`);

const implementedRows = [...perRule].filter(([rule]) => implemented.has(rule)).sort(([a], [b]) => a.localeCompare(b));
console.log(`\nRules ubl-billing implements that the corpus exercises (${implementedRows.length}), by what ubl-billing does with each document the official validator rejects for that rule`);
console.log(` ${pad('rule', 10)} ${pad('docs', 6)} ${pad('same-rule', 10)} ${pad('other-rule', 11)} ${pad('parse-error', 12)} accepted`);
for (const [rule, s] of implementedRows) {
  const o = s.outcomes;
  console.log(` ${o.accepted > 0 ? '!' : ' '}${pad(rule, 9)} ${pad(s.documents, 6)} ${pad(o['same-rule'], 10)} ${pad(o['other-rule'], 11)} ${pad(o['parse-error'], 12)} ${o.accepted}`);
}

const notImplemented = [...perRule].filter(([rule]) => !implemented.has(rule)).sort(([a], [b]) => a.localeCompare(b));
const acceptedByUnimplemented = notImplemented.reduce((n, [, s]) => n + s.outcomes.accepted, 0);
console.log(`\nOfficial business rules ubl-billing does not implement, that the corpus exercises: ${notImplemented.length} (${acceptedByUnimplemented} rule-document pairs accepted silently)`);
console.log(notImplemented.map(([rule, s]) => `${rule}(${s.outcomes.accepted}/${s.documents})`).join(' '));

console.log(`\nValid documents ubl-billing rejects: ${[...rejectsValid.values()].reduce((n, l) => n + l.length, 0)} rejections`);
for (const [id, ids] of [...rejectsValid].sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${pad(id, 14)} ${pad(ids.length, 5)} e.g. ${ids[0]}`);
if (misattributed.size > 0) {
  console.log(`\nRule ids ubl-billing reports on invalid documents where the official validator reports different ones (not gated): ${[...misattributed].length}`);
  console.log([...misattributed].sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => `${id}(${n})`).join(' '));
}

// ------------------------------------------------------------- baseline --
const baselinePath = join(here, 'known-differences.json');
if (write) {
  const file: Record<string, string> = {};
  for (const key of [...observed.keys()].sort()) file[key] = 'TODO: explain, or fix';
  writeFileSync(baselinePath, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`\nwrote ${observed.size} entries to known-differences.json for triage`);
  process.exit(0);
}
let baseline: Record<string, string> = {};
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, string>;
} catch {
  /* no baseline yet: everything observed is new */
}
const fresh = [...observed].filter(([key]) => !(key in baseline));
const stale = Object.keys(baseline).filter((key) => !observed.has(key));
writeFileSync(join(cache, 'last-run.json'), `${JSON.stringify({ docs, observed: [...observed] }, null, 1)}\n`);

if (fresh.length > 0) {
  console.log(`\n${fresh.length} difference(s) not in known-differences.json:`);
  for (const [key, detail] of fresh) console.log(`  ${key}  -- ${detail}`);
}
if (stale.length > 0) {
  console.log(`\n${stale.length} entr${stale.length === 1 ? 'y' : 'ies'} in known-differences.json no longer observed (fixed? remove them):`);
  for (const key of stale) console.log(`  ${key}`);
}
if (fresh.length === 0 && stale.length === 0) console.log('\nconformance: every difference is recorded, and every record is still observed');
process.exit(fresh.length + stale.length > 0 ? 1 : 0);
