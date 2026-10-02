import type { Invoice } from '../model/invoice.js';
import { CORE_RULES, OPTIONAL_RULES } from './core.js';
import { PEPPOL_RULES } from './peppol.js';
import { TOTALS_RULES } from './totals.js';
import type { Rule, Violation } from './types.js';
import { VAT_RULES, VAT_RULE_IDS } from './vat.js';

export type { Violation } from './types.js';

export interface ValidateOptions {
  /** Apply the Peppol BIS Billing 3.0 rules on top of EN 16931. Default true. */
  readonly peppol?: boolean;
  /**
   * Also require a due date or payment terms when an amount is due (BR-CO-25).
   * Default false: the official EN 16931 artefacts of release 1.3.16 do not
   * enforce it for UBL. See rules/core.ts.
   */
  readonly paymentTermsRequired?: boolean;
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
    ...(options.paymentTermsRequired === true ? [OPTIONAL_RULES.paymentTermsRequired] : []),
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

/**
 * Rule ids implemented, for the README and the CLI's --rules listing. The
 * EN 16931 ids are checked against the official artefacts by
 * conformance/run.ts, which fails on any id the standard does not contain.
 */
export const IMPLEMENTED_RULES: readonly string[] = [
  'BR-02', 'BR-03', 'BR-04', 'BR-05', 'BR-06', 'BR-07', 'BR-08', 'BR-09', 'BR-10', 'BR-11',
  'BR-12', 'BR-13', 'BR-14', 'BR-15', 'BR-16', 'BR-21', 'BR-22', 'BR-23', 'BR-24', 'BR-25',
  'BR-26', 'BR-27', 'BR-33', 'BR-38', 'BR-45', 'BR-46', 'BR-47', 'BR-48', 'BR-49', 'BR-50', 'BR-53', 'BR-61',
  'BR-CO-04', 'BR-CO-09', 'BR-CO-10', 'BR-CO-11', 'BR-CO-12', 'BR-CO-13', 'BR-CO-14', 'BR-CO-15',
  'BR-CO-16', 'BR-CO-17', 'BR-CO-18', 'BR-CO-19',
  'BR-DEC-01', 'BR-DEC-05', 'BR-DEC-09', 'BR-DEC-10', 'BR-DEC-11', 'BR-DEC-12', 'BR-DEC-13',
  'BR-DEC-14', 'BR-DEC-16', 'BR-DEC-17', 'BR-DEC-18', 'BR-DEC-19', 'BR-DEC-20', 'BR-DEC-23',
  ...VAT_RULE_IDS,
  'PEPPOL-EN16931-R003', 'PEPPOL-EN16931-R010', 'PEPPOL-EN16931-R020', 'PEPPOL-EN16931-R041',
  'PEPPOL-EN16931-R061', 'PEPPOL-EN16931-CL007',
];
