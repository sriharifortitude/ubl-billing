import { ZERO, decimalPlaces, sum, tryAmount, type Amount } from '../money/decimal.js';
import { fatal, type Rule, type Violation } from './types.js';

/**
 * The arithmetic rules: BR-CO-10 through BR-CO-17 and the BR-DEC decimal
 * constraints. These are the ones that fail in practice. An invoice built by
 * calculate() satisfies them by construction; a parsed one may not, and a
 * caller who edited a total by hand certainly may not.
 *
 * Rounding follows the standard's own Schematron, which writes `round(x * 100)
 * div 100` in XPath. XPath rounds halves towards positive infinity, not away
 * from zero, so -0.125 becomes -0.12 where Decimal's half-up gives -0.13. The
 * difference only shows on negative halves, and it is the difference between
 * agreeing with the reference validator and not.
 */

/** XPath fn:round to two decimals: half towards positive infinity. */
function xround2(value: Amount): Amount {
  return value.times(100).plus(0.5).floor().div(100);
}

/** XPath fn:round to an integer. */
function xround0(value: Amount): Amount {
  return value.plus(0.5).floor();
}

type Money = Amount | undefined;
const m = tryAmount;

/** A missing or non-numeric amount fails an arithmetic rule, as it does in the standard (the XPath comparison is false). */
function equal(a: Money, b: Money): boolean {
  return a !== undefined && b !== undefined && a.equals(b);
}

/** BR-CO-10: sum of invoice line net amounts = Σ BT-131. */
export const brCo10: Rule = (invoice) => {
  const expected = xround2(sum(invoice.lines.map((line) => m(line.netAmount) ?? ZERO)));
  return equal(m(invoice.totals.lineExtensionAmount), expected)
    ? []
    : [fatal('BR-CO-10', `Sum of invoice line net amount is ${invoice.totals.lineExtensionAmount || 'missing'} but the lines sum to ${expected.toFixed(2)}.`, ['BT-106', 'BT-131'])];
};

/** BR-CO-11: sum of allowances on document level = Σ BT-92. */
export const brCo11: Rule = (invoice) => {
  const expected = xround2(sum((invoice.allowances ?? []).map((a) => m(a.amount) ?? ZERO)));
  return equal(m(invoice.totals.allowanceTotalAmount), expected)
    ? []
    : [fatal('BR-CO-11', `Sum of allowances on document level is ${invoice.totals.allowanceTotalAmount} but the allowances sum to ${expected.toFixed(2)}.`, ['BT-107', 'BT-92'])];
};

/** BR-CO-12: sum of charges on document level = Σ BT-99. */
export const brCo12: Rule = (invoice) => {
  const expected = xround2(sum((invoice.charges ?? []).map((c) => m(c.amount) ?? ZERO)));
  return equal(m(invoice.totals.chargeTotalAmount), expected)
    ? []
    : [fatal('BR-CO-12', `Sum of charges on document level is ${invoice.totals.chargeTotalAmount} but the charges sum to ${expected.toFixed(2)}.`, ['BT-108', 'BT-99'])];
};

/** BR-CO-13: BT-109 = BT-106 − BT-107 + BT-108. */
export const brCo13: Rule = (invoice) => {
  const t = invoice.totals;
  const lines = m(t.lineExtensionAmount);
  const expected = lines === undefined ? undefined : xround2(lines.minus(m(t.allowanceTotalAmount) ?? ZERO).plus(m(t.chargeTotalAmount) ?? ZERO));
  return equal(m(t.taxExclusiveAmount), expected)
    ? []
    : [fatal('BR-CO-13', `Invoice total amount without VAT is ${t.taxExclusiveAmount || 'missing'} but ${t.lineExtensionAmount} − ${t.allowanceTotalAmount} + ${t.chargeTotalAmount} = ${expected?.toFixed(2) ?? 'n/a'}.`, ['BT-109'])];
};

/** BR-CO-14: BT-110 = Σ BT-117, when there is a breakdown to sum. */
export const brCo14: Rule = (invoice) => {
  if (invoice.vatBreakdown.length === 0) return [];
  const expected = xround2(sum(invoice.vatBreakdown.map((entry) => m(entry.taxAmount) ?? ZERO)));
  return equal(m(invoice.totals.taxAmount), expected)
    ? []
    : [fatal('BR-CO-14', `Invoice total VAT amount is ${invoice.totals.taxAmount || 'missing'} but the VAT breakdown sums to ${expected.toFixed(2)}.`, ['BT-110', 'BT-117'])];
};

/** BR-CO-15: BT-112 = BT-109 + BT-110. The rounding amount (BT-114) belongs to BR-CO-16, not here. */
export const brCo15: Rule = (invoice) => {
  const t = invoice.totals;
  const exclusive = m(t.taxExclusiveAmount);
  const tax = m(t.taxAmount);
  const expected = exclusive === undefined || tax === undefined ? undefined : xround2(exclusive.plus(tax));
  return equal(m(t.taxInclusiveAmount), expected)
    ? []
    : [fatal('BR-CO-15', `Invoice total amount with VAT is ${t.taxInclusiveAmount || 'missing'} but ${t.taxExclusiveAmount} + ${t.taxAmount} = ${expected?.toFixed(2) ?? 'n/a'}.`, ['BT-112'])];
};

/** BR-CO-16: BT-115 = BT-112 − BT-113 + BT-114. */
export const brCo16: Rule = (invoice) => {
  const t = invoice.totals;
  const inclusive = m(t.taxInclusiveAmount);
  const expected = inclusive === undefined ? undefined : xround2(inclusive.minus(m(t.prepaidAmount) ?? ZERO).plus(m(t.payableRoundingAmount) ?? ZERO));
  return equal(m(t.payableAmount), expected)
    ? []
    : [fatal('BR-CO-16', `Amount due for payment is ${t.payableAmount || 'missing'} but ${t.taxInclusiveAmount} − ${t.prepaidAmount} + ${t.payableRoundingAmount} = ${expected?.toFixed(2) ?? 'n/a'}.`, ['BT-115'])];
};

/**
 * BR-CO-17: a breakdown's VAT amount follows from its taxable amount and
 * rate. The standard allows one currency unit either way, because the
 * taxable amount is a sum of rounded lines. At a rate that rounds to zero
 * the VAT amount must itself round to zero.
 */
export const brCo17: Rule = (invoice) =>
  invoice.vatBreakdown.flatMap((entry) => {
    const tax = m(entry.taxAmount);
    const taxable = m(entry.taxableAmount);
    const rate = m(entry.rate);
    const message = `VAT category tax amount for "${entry.category}" is ${entry.taxAmount || 'missing'} but ${entry.taxableAmount || 'n/a'} × ${entry.rate ?? 'no'}% does not match it.`;
    const bad = [fatal('BR-CO-17', message, ['BT-117'])];
    if (tax === undefined) return bad;
    if (rate === undefined || xround0(rate).isZero()) return xround0(tax).isZero() ? [] : bad;
    if (taxable === undefined) return bad;
    const computed = xround2(taxable.abs().times(rate.div(100)));
    return tax.abs().minus(1).lessThan(computed) && tax.abs().plus(1).greaterThan(computed) ? [] : bad;
  });

/** BR-DEC-*: every amount has at most two decimals. */
export const brDec: Rule = (invoice) => {
  const violations: Violation[] = [];
  const check = (rule: string, value: string | undefined, term: string, lineId?: string): void => {
    const parsed = m(value);
    if (parsed !== undefined && decimalPlaces(parsed) > 2) {
      violations.push(fatal(rule, `${term} has more than two decimals: ${value ?? ''}.`, [term], lineId));
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

export const TOTALS_RULES: readonly Rule[] = [brCo10, brCo11, brCo12, brCo13, brCo14, brCo15, brCo16, brCo17, brDec];
