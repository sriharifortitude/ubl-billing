import { EXEMPTION_REASON_CATEGORIES, ZERO_RATE_CATEGORIES, type VatCategory } from '../model/codes.js';
import type { Invoice } from '../model/invoice.js';
import { amount } from '../money/decimal.js';
import { fatal, type Rule, type Violation } from './types.js';

/**
 * The per-category VAT rules. EN 16931 has a parallel block of rules for
 * each category (BR-S-*, BR-Z-*, BR-E-*, BR-AE-*, BR-K-*, BR-G-*, BR-O-*)
 * with the same shape: if a line uses the category, a breakdown entry must
 * exist for it; the rate must be what the category allows; the taxable
 * amount must equal the sum of the lines; the tax amount must follow from
 * the rate. They are implemented once, parameterised by category, and the
 * rule id reported is the category-specific one the standard uses.
 */

const RULE_PREFIX: Readonly<Record<VatCategory, string>> = {
  S: 'BR-S',
  Z: 'BR-Z',
  E: 'BR-E',
  AE: 'BR-AE',
  K: 'BR-K',
  G: 'BR-G',
  O: 'BR-O',
  L: 'BR-IG',
  M: 'BR-IP',
};

function categoriesUsed(invoice: Invoice): Set<VatCategory> {
  const used = new Set<VatCategory>();
  for (const line of invoice.lines) used.add(line.vatCategory);
  for (const item of [...(invoice.allowances ?? []), ...(invoice.charges ?? [])]) used.add(item.vatCategory);
  return used;
}

/** *-01: if any line or allowance/charge uses the category, a breakdown entry for it must exist. */
export const breakdownPresent: Rule = (invoice) => {
  const violations: Violation[] = [];
  const present = new Set(invoice.vatBreakdown.map((entry) => entry.category));
  for (const category of categoriesUsed(invoice)) {
    if (!present.has(category)) {
      violations.push(
        fatal(`${RULE_PREFIX[category]}-01`, `An invoice that contains a line, allowance or charge with VAT category "${category}" shall contain a VAT breakdown for that category.`, ['BT-118']),
      );
    }
  }
  return violations;
};

/** *-05: lines in a zero-rate category must carry a zero rate; S lines must carry a rate > 0. */
export const lineRateMatchesCategory: Rule = (invoice) =>
  invoice.lines.flatMap((line) => {
    const rate = amount(line.vatRate ?? '0');
    if (line.vatCategory === 'S' && !rate.greaterThan(0)) {
      return [fatal('BR-S-05', 'In an invoice line where the VAT category code is "Standard rated", the VAT rate shall be greater than zero.', ['BT-152'], line.id)];
    }
    if (line.vatCategory === 'O' && line.vatRate !== undefined) {
      return [fatal('BR-O-05', 'An invoice line with VAT category "Not subject to VAT" shall not contain a VAT rate.', ['BT-152'], line.id)];
    }
    if (ZERO_RATE_CATEGORIES.has(line.vatCategory) && line.vatCategory !== 'O' && !rate.isZero()) {
      return [fatal(`${RULE_PREFIX[line.vatCategory]}-05`, `In an invoice line where the VAT category code is "${line.vatCategory}", the VAT rate shall be 0.`, ['BT-152'], line.id)];
    }
    return [];
  });

/** *-08 / *-09: the breakdown taxable amount equals the sum of the lines and allowances/charges in that category and rate. */
export const breakdownTaxableMatchesLines: Rule = (invoice) =>
  invoice.vatBreakdown.flatMap((entry) => {
    const rate = amount(entry.rate ?? '0');
    const matches = (category: VatCategory, itemRate: string | undefined): boolean =>
      category === entry.category && amount(itemRate ?? '0').equals(rate);

    let expected = amount('0');
    for (const line of invoice.lines) if (matches(line.vatCategory, line.vatRate)) expected = expected.plus(amount(line.netAmount));
    for (const a of invoice.allowances ?? []) if (matches(a.vatCategory, a.vatRate)) expected = expected.minus(amount(a.amount));
    for (const c of invoice.charges ?? []) if (matches(c.vatCategory, c.vatRate)) expected = expected.plus(amount(c.amount));

    return expected.toDecimalPlaces(2).equals(amount(entry.taxableAmount))
      ? []
      : [fatal(`${RULE_PREFIX[entry.category]}-08`, `VAT category taxable amount for "${entry.category}" at ${rate.toString()}% is ${entry.taxableAmount} but the lines, allowances and charges in that category sum to ${expected.toFixed(2)}.`, ['BT-116'])];
  });

/** BR-CO-17 (and *-09): tax amount = taxable × rate ÷ 100, rounded; zero for zero-rate categories. */
export const breakdownTaxFollowsRate: Rule = (invoice) =>
  invoice.vatBreakdown.flatMap((entry) => {
    const taxable = amount(entry.taxableAmount);
    const rate = amount(entry.rate ?? '0');
    const expected = ZERO_RATE_CATEGORIES.has(entry.category) ? amount('0') : taxable.times(rate).div(100).toDecimalPlaces(2);
    return expected.equals(amount(entry.taxAmount))
      ? []
      : [fatal('BR-CO-17', `VAT category tax amount for "${entry.category}" is ${entry.taxAmount} but ${entry.taxableAmount} × ${rate.toString()}% = ${expected.toFixed(2)}.`, ['BT-117'])];
  });

/** *-10: exempt-style categories must state why. */
export const exemptionReasonPresent: Rule = (invoice) =>
  invoice.vatBreakdown.flatMap((entry) =>
    EXEMPTION_REASON_CATEGORIES.has(entry.category) &&
    entry.exemptionReason === undefined &&
    entry.exemptionReasonCode === undefined
      ? [fatal(`${RULE_PREFIX[entry.category]}-10`, `A VAT breakdown with category "${entry.category}" shall have a VAT exemption reason code or text.`, ['BT-120', 'BT-121'])]
      : [],
  );

/** BR-AE-02 / BR-K-02: reverse charge and intra-community need both parties' VAT identifiers. */
export const reverseChargeNeedsBothVatIds: Rule = (invoice) => {
  const used = categoriesUsed(invoice);
  const violations: Violation[] = [];
  for (const category of ['AE', 'K'] as const) {
    if (!used.has(category)) continue;
    if (invoice.seller.vatId === undefined) {
      violations.push(fatal(`${RULE_PREFIX[category]}-02`, `An invoice with VAT category "${category}" shall contain the seller VAT identifier.`, ['BT-31']));
    }
    if (invoice.buyer.vatId === undefined && invoice.buyer.legalRegistrationId === undefined) {
      violations.push(fatal(`${RULE_PREFIX[category]}-02`, `An invoice with VAT category "${category}" shall contain the buyer VAT identifier or legal registration identifier.`, ['BT-48', 'BT-47']));
    }
  }
  return violations;
};

/** BR-O-11..14: "not subject to VAT" cannot be mixed with any other category. */
export const outsideScopeIsExclusive: Rule = (invoice) => {
  const used = categoriesUsed(invoice);
  return used.has('O') && used.size > 1
    ? [fatal('BR-O-11', 'An invoice that contains a VAT breakdown with category "Not subject to VAT" shall not contain lines, allowances or charges in any other VAT category.', ['BT-118'])]
    : [];
};

export const VAT_RULES: readonly Rule[] = [
  breakdownPresent,
  lineRateMatchesCategory,
  breakdownTaxableMatchesLines,
  breakdownTaxFollowsRate,
  exemptionReasonPresent,
  reverseChargeNeedsBothVatIds,
  outsideScopeIsExclusive,
];
