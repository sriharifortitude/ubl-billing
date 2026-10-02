/**
 * Mutation operators for the differential test.
 *
 * Each mutant is one small, deliberate break of a valid invoice: an element
 * removed, an amount nudged by a cent, a VAT category swapped. The official
 * validator says which business rules each break violates, so the corpus is
 * a labelled set of rule violations that nobody here had to write by hand
 * or guess at.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export interface Mutant {
  /** Stable name: seed, operator, and the path or code involved. */
  readonly id: string;
  readonly seed: string;
  readonly operator: 'seed' | 'drop' | 'nudge' | 'category';
  readonly xml: string;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const VAT_CODES = ['S', 'Z', 'E', 'AE', 'K', 'G', 'O', 'L', 'M'];

type Node_ = ReturnType<DOMParser['parseFromString']>['documentElement'];

function elementPath(el: Node_): string {
  const parts: string[] = [];
  let cur: Node_ | null = el;
  while (cur && cur.nodeType === 1) {
    const parent = cur.parentNode as Node_ | null;
    let index = 1;
    if (parent && parent.nodeType === 1) {
      for (let sib = cur.previousSibling; sib; sib = sib.previousSibling) {
        if (sib.nodeType === 1 && (sib as Node_).nodeName === cur.nodeName) index++;
      }
    }
    parts.unshift(`${cur.nodeName}[${index}]`);
    cur = parent && parent.nodeType === 1 ? parent : null;
  }
  return parts.join('/');
}

function allElements(root: Node_): Node_[] {
  const out: Node_[] = [];
  const walk = (el: Node_): void => {
    out.push(el);
    for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) walk(c as Node_);
  };
  walk(root);
  return out;
}

const serializer = new XMLSerializer();

function reparse(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
}

function nudge(text: string): string {
  const decimals = text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
  const next = (Number(text) + 0.01).toFixed(Math.max(decimals, 2));
  return next;
}

/**
 * Yields every mutant of one seed. Each is built from a fresh parse of the
 * seed, so mutants never interact.
 */
export function* mutate(seedName: string, seedXml: string, only?: ReadonlySet<Mutant['operator']>): Generator<Mutant> {
  const base = new DOMParser().parseFromString(seedXml, 'text/xml');
  const elements = allElements(base.documentElement as unknown as Node_);
  const paths = elements.map(elementPath);
  const want = (op: Mutant['operator']): boolean => !only || only.has(op);

  if (want('seed')) yield { id: `${seedName}::seed`, seed: seedName, operator: 'seed', xml: seedXml };

  for (let i = 1; i < elements.length; i++) {
    const path = paths[i] ?? '';
    const el = elements[i] as Node_;
    const leafText = el.childNodes.length === 1 && el.firstChild?.nodeType === 3 ? (el.firstChild.nodeValue ?? '').trim() : null;

    if (want('drop')) {
      const doc = reparse(seedXml);
      const target = allElements(doc.documentElement as unknown as Node_)[i] as Node_;
      target.parentNode?.removeChild(target);
      yield { id: `${seedName}::drop::${path}`, seed: seedName, operator: 'drop', xml: serializer.serializeToString(doc as never) };
    }

    if (want('nudge') && leafText !== null && NUMERIC.test(leafText)) {
      const doc = reparse(seedXml);
      const target = allElements(doc.documentElement as unknown as Node_)[i] as Node_;
      if (target.firstChild) target.firstChild.nodeValue = nudge(leafText);
      yield { id: `${seedName}::nudge::${path}`, seed: seedName, operator: 'nudge', xml: serializer.serializeToString(doc as never) };
    }

    if (want('category') && el.nodeName === 'cbc:ID' && /TaxCategory$/.test((el.parentNode as Node_ | null)?.nodeName ?? '') && leafText !== null) {
      for (const code of VAT_CODES) {
        if (code === leafText) continue;
        const doc = reparse(seedXml);
        const target = allElements(doc.documentElement as unknown as Node_)[i] as Node_;
        if (target.firstChild) target.firstChild.nodeValue = code;
        yield { id: `${seedName}::category::${path}->${code}`, seed: seedName, operator: 'category', xml: serializer.serializeToString(doc as never) };
      }
    }
  }
}
