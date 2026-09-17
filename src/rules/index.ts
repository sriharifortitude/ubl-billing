import type { Invoice } from '../model/invoice.js';
import { CORE_RULES } from './core.js';
import { PEPPOL_RULES } from './peppol.js';
import { TOTALS_RULES } from './totals.js';
import type { Rule, Violation } from './types.js';
import { VAT_RULES } from './vat.js';

export type { Violation } from './types.js';

export interface ValidateOptions {
  /** Apply the Peppol BIS Billing 3.0 rules on top of EN 16931. Default true. */
  readonly peppol?: boolean;
}

/**
 * Runs every rule and returns every violation, fatal ones first. Rules are
 * independent and all of them run: a document with three problems reports
 * three, not the first one found, because the person fixing it wants the
 * list.
 */
export function validate(invoice: Invoice, options: ValidateOptions = {}): Violation[] {
  const rules: readonly Rule[] = [
    ...CORE_RULES,
    ...TOTALS_RULES,
    ...VAT_RULES,
    ...(options.peppol === false ? [] : PEPPOL_RULES),
  ];

  const violations = rules.flatMap((rule) => rule(invoice));
  return violations.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'fatal' ? -1 : 1;
    return a.rule.localeCompare(b.rule);
  });
}

export function isValid(invoice: Invoice, options?: ValidateOptions): boolean {
  return !validate(invoice, options).some((violation) => violation.severity === 'fatal');
}

/** Rule ids implemented, for the README and the CLI's --rules listing. */
export const IMPLEMENTED_RULES: readonly string[] = [
  'BR-02', 'BR-03', 'BR-04', 'BR-05', 'BR-06', 'BR-07', 'BR-09', 'BR-11', 'BR-16', 'BR-21', 'BR-22',
  'BR-23', 'BR-24', 'BR-25', 'BR-26', 'BR-27', 'BR-33', 'BR-38',
  'BR-CO-04', 'BR-CO-09', 'BR-CO-10', 'BR-CO-11', 'BR-CO-12', 'BR-CO-13', 'BR-CO-14', 'BR-CO-15',
  'BR-CO-16', 'BR-CO-17', 'BR-CO-25',
  'BR-DEC-01', 'BR-DEC-05', 'BR-DEC-09', 'BR-DEC-10', 'BR-DEC-11', 'BR-DEC-12', 'BR-DEC-13',
  'BR-DEC-14', 'BR-DEC-16', 'BR-DEC-17', 'BR-DEC-18', 'BR-DEC-19', 'BR-DEC-20', 'BR-DEC-23',
  'BR-S-01', 'BR-S-05', 'BR-S-08', 'BR-Z-01', 'BR-Z-05', 'BR-Z-08', 'BR-E-01', 'BR-E-05', 'BR-E-08',
  'BR-E-10', 'BR-AE-01', 'BR-AE-02', 'BR-AE-05', 'BR-AE-08', 'BR-AE-10', 'BR-K-01', 'BR-K-02',
  'BR-K-05', 'BR-K-08', 'BR-K-10', 'BR-G-01', 'BR-G-05', 'BR-G-08', 'BR-G-10', 'BR-O-01', 'BR-O-05',
  'BR-O-08', 'BR-O-10', 'BR-O-11',
  'PEPPOL-EN16931-R003', 'PEPPOL-EN16931-R010', 'PEPPOL-EN16931-R020', 'PEPPOL-EN16931-R041',
  'PEPPOL-EN16931-R061', 'PEPPOL-EN16931-CL007',
];
