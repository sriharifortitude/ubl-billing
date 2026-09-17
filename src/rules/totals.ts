import { amount, decimalPlaces, sum } from '../money/decimal.js';
import { fatal, type Rule, type Violation } from './types.js';

/**
 * The arithmetic rules: BR-CO-10 through BR-CO-16 and the BR-DEC decimal
 * constraints. These are the ones that fail in practice. An invoice built by
 * calculate() satisfies them by construction; a parsed one may not, and a
 * caller who edited a total by hand certainly may not.
 */

/** BR-CO-10: sum of invoice line net amounts = Σ BT-131. */
export const brCo10: Rule = (invoice) => {
  const expected = sum(invoice.lines.map((line) => amount(line.netAmount)));
  return expected.equals(amount(invoice.totals.lineExtensionAmount))
    ? []
    : [fatal('BR-CO-10', `Sum of invoice line net amount is ${invoice.totals.lineExtensionAmount} but the lines sum to ${expected.toFixed(2)}.`, ['BT-106', 'BT-131'])];
};

/** BR-CO-11: sum of allowances on document level = Σ BT-92. */
export const brCo11: Rule = (invoice) => {
  const expected = sum((invoice.allowances ?? []).map((a) => amount(a.amount)));
  return expected.equals(amount(invoice.totals.allowanceTotalAmount))
    ? []
    : [fatal('BR-CO-11', `Sum of allowances on document level is ${invoice.totals.allowanceTotalAmount} but the allowances sum to ${expected.toFixed(2)}.`, ['BT-107', 'BT-92'])];
};

/** BR-CO-12: sum of charges on document level = Σ BT-99. */
export const brCo12: Rule = (invoice) => {
  const expected = sum((invoice.charges ?? []).map((c) => amount(c.amount)));
  return expected.equals(amount(invoice.totals.chargeTotalAmount))
    ? []
    : [fatal('BR-CO-12', `Sum of charges on document level is ${invoice.totals.chargeTotalAmount} but the charges sum to ${expected.toFixed(2)}.`, ['BT-108', 'BT-99'])];
};

/** BR-CO-13: BT-109 = BT-106 − BT-107 + BT-108. */
export const brCo13: Rule = (invoice) => {
  const t = invoice.totals;
  const expected = amount(t.lineExtensionAmount).minus(amount(t.allowanceTotalAmount)).plus(amount(t.chargeTotalAmount));
  return expected.equals(amount(t.taxExclusiveAmount))
    ? []
    : [fatal('BR-CO-13', `Invoice total amount without VAT is ${t.taxExclusiveAmount} but ${t.lineExtensionAmount} − ${t.allowanceTotalAmount} + ${t.chargeTotalAmount} = ${expected.toFixed(2)}.`, ['BT-109'])];
};

/** BR-CO-14: BT-110 = Σ BT-117. */
export const brCo14: Rule = (invoice) => {
  const expected = sum(invoice.vatBreakdown.map((entry) => amount(entry.taxAmount)));
  return expected.equals(amount(invoice.totals.taxAmount))
    ? []
    : [fatal('BR-CO-14', `Invoice total VAT amount is ${invoice.totals.taxAmount} but the VAT breakdown sums to ${expected.toFixed(2)}.`, ['BT-110', 'BT-117'])];
};

/** BR-CO-15: BT-112 = BT-109 + BT-110 (+ BT-114 rounding, which UBL places here). */
export const brCo15: Rule = (invoice) => {
  const t = invoice.totals;
  const expected = amount(t.taxExclusiveAmount).plus(amount(t.taxAmount)).plus(amount(t.payableRoundingAmount));
  return expected.equals(amount(t.taxInclusiveAmount))
    ? []
    : [fatal('BR-CO-15', `Invoice total amount with VAT is ${t.taxInclusiveAmount} but ${t.taxExclusiveAmount} + ${t.taxAmount} + ${t.payableRoundingAmount} = ${expected.toFixed(2)}.`, ['BT-112'])];
};

/** BR-CO-16: BT-115 = BT-112 − BT-113. */
export const brCo16: Rule = (invoice) => {
  const t = invoice.totals;
  const expected = amount(t.taxInclusiveAmount).minus(amount(t.prepaidAmount));
  return expected.equals(amount(t.payableAmount))
    ? []
    : [fatal('BR-CO-16', `Amount due for payment is ${t.payableAmount} but ${t.taxInclusiveAmount} − ${t.prepaidAmount} = ${expected.toFixed(2)}.`, ['BT-115'])];
};

/** BR-DEC-*: every amount has at most two decimals. */
export const brDec: Rule = (invoice) => {
  const violations: Violation[] = [];
  const check = (rule: string, value: string, term: string, lineId?: string): void => {
    if (decimalPlaces(amount(value)) > 2) {
      violations.push(fatal(rule, `${term} has more than two decimals: ${value}.`, [term], lineId));
    }
  };
  const t = invoice.totals;
  check('BR-DEC-09', t.lineExtensionAmount, 'BT-106');
  check('BR-DEC-10', t.allowanceTotalAmount, 'BT-107');
  check('BR-DEC-11', t.chargeTotalAmount, 'BT-108');
  check('BR-DEC-12', t.taxExclusiveAmount, 'BT-109');
  check('BR-DEC-13', t.taxAmount, 'BT-110');
  check('BR-DEC-14', t.taxInclusiveAmount, 'BT-112');
  check('BR-DEC-16', t.prepaidAmount, 'BT-113');
  check('BR-DEC-17', t.payableRoundingAmount, 'BT-114');
  check('BR-DEC-18', t.payableAmount, 'BT-115');
  for (const entry of invoice.vatBreakdown) {
    check('BR-DEC-19', entry.taxableAmount, 'BT-116');
    check('BR-DEC-20', entry.taxAmount, 'BT-117');
  }
  for (const line of invoice.lines) check('BR-DEC-23', line.netAmount, 'BT-131', line.id);
  for (const a of invoice.allowances ?? []) check('BR-DEC-01', a.amount, 'BT-92');
  for (const c of invoice.charges ?? []) check('BR-DEC-05', c.amount, 'BT-99');
  return violations;
};

export const TOTALS_RULES: readonly Rule[] = [brCo10, brCo11, brCo12, brCo13, brCo14, brCo15, brCo16, brDec];
