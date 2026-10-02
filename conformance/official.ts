/**
 * Runs the official EN 16931 validation (the CEN/TC 434 Schematron, as
 * compiled XSLT) under Saxon and reads back which rules failed.
 *
 * One JVM validates a whole directory, so a corpus of thousands of
 * documents costs one startup, not thousands.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const here = import.meta.dirname;
const cache = join(here, '.cache');

export interface OfficialResult {
  /** Fatal rule ids that failed. Empty means the document is valid. */
  readonly failed: readonly string[];
}

export interface OfficialRun {
  readonly results: Map<string, OfficialResult>;
  /**
   * Documents the official validator itself crashed on (a mutation can put a
   * number where the schema wants a boolean, and the compiled XSLT raises a
   * dynamic error). The reference has no verdict on those, so they can't be
   * compared against.
   */
  readonly crashed: ReadonlySet<string>;
}

export function officialAvailable(): boolean {
  try {
    readdirSync(join(cache, 'ubl', 'xslt'));
    readdirSync(cache);
    return true;
  } catch {
    return false;
  }
}

/** Validates every .xml/.XML file in inputDir; returns file name -> failed rule ids. */
export function validateOfficially(inputDir: string, workDir: string): OfficialRun {
  const out = join(workDir, 'svrl');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const java = process.env.JAVA ?? 'java';
  const classpath = ['Saxon-HE-12.7.jar', 'xmlresolver-5.3.3.jar'].map((jar) => join(cache, jar)).join(delimiter);
  const run = spawnSync(
    java,
    [
      '-cp',
      classpath,
      'net.sf.saxon.Transform',
      `-s:${resolve(inputDir)}`,
      `-xsl:${join(cache, 'ubl', 'xslt', 'EN16931-UBL-validation.xslt')}`,
      `-o:${resolve(out)}`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // Saxon carries on past a document whose transformation fails and exits
  // non-zero at the end, so a non-zero exit alone isn't fatal. It is only
  // when it produced nothing at all.
  const crashed = new Set([...(run.stderr ?? '').matchAll(/While processing (\S+\.xml)/gi)].map((m) => m[1] as string));
  if (run.status !== 0 && readdirSync(out).length === 0) {
    throw new Error(`Saxon exited ${run.status}: ${(run.stderr || run.stdout).slice(0, 2000)}`);
  }

  const results = new Map<string, OfficialResult>();
  for (const file of readdirSync(out)) {
    const svrl = readFileSync(join(out, file), 'utf8');
    const failed: string[] = [];
    for (const match of svrl.matchAll(/<svrl:failed-assert\b([^>]*)>/g)) {
      const attrs = match[1] ?? '';
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      const flag = /\bflag="([^"]+)"/.exec(attrs)?.[1];
      if (id !== undefined && flag === 'fatal') failed.push(id);
    }
    results.set(file, { failed: [...new Set(failed)].sort() });
  }
  return { results, crashed };
}
