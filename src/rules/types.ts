import type { Invoice } from '../model/invoice.js';

/**
 * A rule violation, identified the way the recipient's validator will
 * identify it. `rule` is the id from EN 16931 (BR-*) or the Peppol BIS
 * (PEPPOL-EN16931-R*), verbatim, so a message here matches the message an
 * access point would send back -- which is the whole point of validating
 * before sending.
 */
export interface Violation {
  readonly rule: string;
  /** Fatal violations are rejected by every conformant receiver. Warnings may be. */
  readonly severity: 'fatal' | 'warning';
  readonly message: string;
  /** Business term(s) involved, e.g. "BT-131", for locating the field. */
  readonly terms: readonly string[];
  /** Line id when the violation is on a specific line. */
  readonly lineId?: string;
}

export type Rule = (invoice: Invoice) => Violation[];

export function fatal(rule: string, message: string, terms: readonly string[], lineId?: string): Violation {
  return { rule, severity: 'fatal', message, terms, ...(lineId === undefined ? {} : { lineId }) };
}

export function warning(rule: string, message: string, terms: readonly string[], lineId?: string): Violation {
  return { rule, severity: 'warning', message, terms, ...(lineId === undefined ? {} : { lineId }) };
}
