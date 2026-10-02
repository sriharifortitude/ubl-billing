import type { VatCategory } from '../model/codes.js';
import type { Invoice } from '../model/invoice.js';
import { ZERO, round2, sum, tryAmount, type Amount } from '../money/decimal.js';
import { fatal, type Rule, type Violation } from './types.js';

/**
 * The per-category VAT rules.
 *
 * EN 16931 has a parallel block of rules for each VAT category, with the
 * same ten-rule shape: the breakdown must exist (-01), the right parties
 * must be identified (-02..-04), the rate must be what the category allows
 * (-05..-07), the taxable amount must follow from the lines (-08), the VAT
 * amount from the rate (-09), and the exemption reason must be present or
 * absent as the category requires (-10). The blocks differ in a handful of
 * ways, listed in FAMILIES, and everything else is shared.
 *
 * Every definition here was read from the official CEN/TC 434 Schematron
 * (conformance/), not from the specification's prose. The prose is where
 * this code first went wrong: it said exact, the Schematron allows a
 * tolerance of one currency unit; it said "intra-community" is BR-K-*, the
 * standard calls it BR-IC-*.
 */

interface Family {
  readonly category: VatCategory;
  /** The id prefix the standard uses for this category's block. */
  readonly prefix: string;
  /** What BT-95 / BT-102 / BT-118 / BT-151 call it, for messages. */
  readonly name: string;
  /** Rate required of lines, allowances and charges in this category. */
  readonly rate: 'positive' | 'zero' | 'absent' | 'nonNegative';
  /** Several breakdown entries allowed, one per rate (S, IGIC, IPSI); otherwise exactly one. */
  readonly byRate: boolean;
  /** VAT amount is rate-proportional within a unit (S, IGIC, IPSI), or exactly zero. */
  readonly taxAmount: 'proportional' | 'zero';
  /** Exemption reason forbidden (the categories that charge VAT) or required (the ones that don't). */
  readonly exemption: 'forbidden' | 'required';
  /** Who must be identified when the category is used. */
  readonly identification: 'seller' | 'sellerVat' | 'reverseCharge' | 'intraCommunity' | 'noVatIds';
}

const FAMILIES: readonly Family[] = [
  { category: 'S', prefix: 'BR-S', name: 'Standard rated', rate: 'positive', byRate: true, taxAmount: 'proportional', exemption: 'forbidden', identification: 'seller' },
  { category: 'Z', prefix: 'BR-Z', name: 'Zero rated', rate: 'zero', byRate: false, taxAmount: 'zero', exemption: 'forbidden', identification: 'seller' },
  { category: 'E', prefix: 'BR-E', name: 'Exempt from VAT', rate: 'zero', byRate: false, taxAmount: 'zero', exemption: 'required', identification: 'seller' },
  { category: 'AE', prefix: 'BR-AE', name: 'VAT reverse charge', rate: 'zero', byRate: false, taxAmount: 'zero', exemption: 'required', identification: 'reverseCharge' },
  { category: 'K', prefix: 'BR-IC', name: 'Intra-community supply', rate: 'zero', byRate: false, taxAmount: 'zero', exemption: 'required', identification: 'intraCommunity' },
  { category: 'G', prefix: 'BR-G', name: 'Free export item, VAT not charged', rate: 'zero', byRate: false, taxAmount: 'zero', exemption: 'required', identification: 'sellerVat' },
  { category: 'O', prefix: 'BR-O', name: 'Not subject to VAT', rate: 'absent', byRate: false, taxAmount: 'zero', exemption: 'required', identification: 'noVatIds' },
  { category: 'L', prefix: 'BR-AF', name: 'IGIC', rate: 'nonNegative', byRate: true, taxAmount: 'proportional', exemption: 'forbidden', identification: 'seller' },
  { category: 'M', prefix: 'BR-AG', name: 'IPSI', rate: 'nonNegative', byRate: true, taxAmount: 'proportional', exemption: 'forbidden', identification: 'seller' },
];

const present = (value: string | undefined): boolean => value !== undefined && value.trim() !== '';

function sellerIds(invoice: Invoice): { vat: boolean; any: boolean } {
  const vat = present(invoice.seller.vatId) || present(invoice.taxRepresentativeVatId);
  return { vat, any: vat || present(invoice.seller.taxRegistrationId) };
}

/** Whether the parties this family requires are identified. */
function identified(family: Family, invoice: Invoice): boolean {
  const seller = sellerIds(invoice);
  const buyer = invoice.buyer;
  switch (family.identification) {
    case 'seller':
      return seller.any;
    case 'sellerVat':
      return seller.vat;
    case 'reverseCharge':
      return seller.any && (present(buyer.vatId) || present(buyer.taxRegistrationId) || present(buyer.legalRegistrationId));
    case 'intraCommunity':
      return seller.vat && present(buyer.vatId);
    case 'noVatIds':
      return !seller.vat && !present(buyer.vatId);
  }
}

function rateAllowed(family: Family, rate: string | undefined): boolean {
  if (family.rate === 'absent') return !present(rate);
  const value = tryAmount(rate);
  if (value === undefined) return false;
  switch (family.rate) {
    case 'positive':
      return value.greaterThan(0);
    case 'zero':
      return value.isZero();
    case 'nonNegative':
      return !value.isNegative();
  }
}

interface Item {
  readonly category: string;
  readonly rate: string | undefined;
  readonly amount: string;
}

const lineItems = (invoice: Invoice): Item[] => invoice.lines.map((l) => ({ category: l.vatCategory, rate: l.vatRate, amount: l.netAmount }));
const allowanceItems = (invoice: Invoice): Item[] => (invoice.allowances ?? []).map((a) => ({ category: a.vatCategory, rate: a.vatRate, amount: a.amount }));
const chargeItems = (invoice: Invoice): Item[] => (invoice.charges ?? []).map((c) => ({ category: c.vatCategory, rate: c.vatRate, amount: c.amount }));

/** Sum of line net amounts plus charges minus allowances, for one category and, when given, rate. */
function taxableBase(invoice: Invoice, category: VatCategory, rate?: Amount): Amount {
  const sameRate = (item: Item): boolean => rate === undefined || (tryAmount(item.rate)?.equals(rate) ?? false);
  const pick = (items: Item[]): Amount[] => items.filter((i) => i.category === category && sameRate(i)).map((i) => tryAmount(i.amount) ?? ZERO);
  return sum(pick(lineItems(invoice))).plus(sum(pick(chargeItems(invoice)))).minus(sum(pick(allowanceItems(invoice))));
}

/** The family's rules over one invoice. */
function familyViolations(family: Family, invoice: Invoice): Violation[] {
  const v: Violation[] = [];
  const id = (n: string): string => `${family.prefix}-${n}`;
  const lines = lineItems(invoice).filter((i) => i.category === family.category);
  const allowances = allowanceItems(invoice).filter((i) => i.category === family.category);
  const charges = chargeItems(invoice).filter((i) => i.category === family.category);
  const breakdown = invoice.vatBreakdown.filter((e) => e.category === family.category);
  const name = `"${family.name}"`;

  // -01: the breakdown matches what the document uses. For the categories
  // with one breakdown per rate (S, IGIC, IPSI) this runs both ways: a
  // breakdown for a category nothing uses is a violation too. The others only
  // ask that a category mentioned anywhere, the breakdown included, has
  // exactly one. The two forms are what the standard's own XPath does.
  const used = lines.length + allowances.length + charges.length;
  if (family.byRate) {
    if (!((used > 0 && breakdown.length > 0) || (used === 0 && breakdown.length === 0))) {
      v.push(fatal(id('01'), `An invoice that uses VAT category ${name} shall contain a VAT breakdown for it, and one that does not use it shall not; ${used} line, allowance or charge entries use it and there are ${breakdown.length} breakdowns.`, ['BT-118']));
    }
  } else if (used + breakdown.length > 0 && breakdown.length !== 1) {
    v.push(fatal(id('01'), `An invoice with VAT category ${name} shall contain exactly one VAT breakdown for it; this one has ${breakdown.length}.`, ['BT-118']));
  }

  // -02 / -03 / -04: the parties the category requires are identified.
  const who = family.identification === 'noVatIds' ? 'shall not contain a seller, tax representative or buyer VAT identifier' : 'lacks the VAT identifiers this category requires';
  for (const [n, group, term] of [
    ['02', lines, 'an invoice line'],
    ['03', allowances, 'a document level allowance'],
    ['04', charges, 'a document level charge'],
  ] as const) {
    if (group.length > 0 && !identified(family, invoice)) {
      v.push(fatal(id(n), `An invoice with ${term} in VAT category ${name} ${who}.`, ['BT-31', 'BT-48', 'BT-63']));
    }
  }

  // -05 / -06 / -07: the rate on lines, allowances and charges.
  const rateWord = { positive: 'greater than zero', zero: 'zero', absent: 'absent', nonNegative: 'zero or more' }[family.rate];
  const linesInCategory = invoice.lines.filter((l) => l.vatCategory === family.category);
  for (const [n, group, term] of [
    ['05', lines, 'invoice line'],
    ['06', allowances, 'document level allowance'],
    ['07', charges, 'document level charge'],
  ] as const) {
    group.forEach((item, index) => {
      if (!rateAllowed(family, item.rate)) {
        const lineId = n === '05' ? linesInCategory[index]?.id : undefined;
        v.push(fatal(id(n), `In a ${term} where the VAT category is ${name}, the VAT rate shall be ${rateWord}.`, ['BT-152', 'BT-96', 'BT-103'], lineId));
      }
    });
  }

  for (const entry of breakdown) {
    const taxable = tryAmount(entry.taxableAmount);
    const tax = tryAmount(entry.taxAmount);
    const rate = tryAmount(entry.rate);

    // -08: the taxable amount follows from the lines, charges and allowances.
    if (family.byRate) {
      const grouped = rate === undefined ? undefined : taxableBase(invoice, family.category, rate);
      const exists = rate !== undefined && [...lines, ...allowances, ...charges].some((i) => tryAmount(i.rate)?.equals(rate) ?? false);
      // The standard allows a unit either way: line amounts are rounded one
      // by one, the breakdown is rounded once.
      const within = taxable !== undefined && grouped !== undefined && taxable.minus(1).lessThan(grouped) && taxable.plus(1).greaterThan(grouped);
      if (!exists || !within) {
        v.push(fatal(id('08'), `For each VAT rate in category ${name}, the taxable amount shall equal the lines plus charges minus allowances at that rate (within 1); ${entry.taxableAmount || 'none'} at ${entry.rate ?? 'no'}% ${grouped === undefined ? 'cannot be checked' : `against ${grouped.toFixed(2)}`}.`, ['BT-116']));
      }
    } else {
      const expected = taxableBase(invoice, family.category);
      if (taxable === undefined || !taxable.equals(expected)) {
        v.push(fatal(id('08'), `In a VAT breakdown with category ${name}, the taxable amount shall equal the lines plus charges minus allowances in that category; ${entry.taxableAmount || 'none'} against ${expected.toFixed(2)}.`, ['BT-116']));
      }
    }

    // -09: the VAT amount follows from the rate.
    if (family.taxAmount === 'zero') {
      if (tax === undefined || !tax.isZero()) v.push(fatal(id('09'), `In a VAT breakdown with category ${name}, the VAT category tax amount shall be 0; it is ${entry.taxAmount || 'missing'}.`, ['BT-117']));
    } else {
      const computed = taxable === undefined || rate === undefined ? undefined : round2(taxable.abs().times(rate.div(100)));
      const ok = tax !== undefined && computed !== undefined && tax.abs().minus(1).lessThan(computed) && tax.abs().plus(1).greaterThan(computed);
      if (!ok) v.push(fatal(id('09'), `In a VAT breakdown with category ${name}, the tax amount shall be the taxable amount times the rate (within 1): ${entry.taxAmount || 'missing'} against ${computed?.toFixed(2) ?? 'n/a'}.`, ['BT-117']));
    }

    // -10: the exemption reason.
    const hasReason = present(entry.exemptionReason) || present(entry.exemptionReasonCode);
    if (family.exemption === 'required' && !hasReason) {
      v.push(fatal(id('10'), `A VAT breakdown with category ${name} shall have a VAT exemption reason code or text.`, ['BT-120', 'BT-121']));
    }
    if (family.exemption === 'forbidden' && hasReason) {
      v.push(fatal(id('10'), `A VAT breakdown with category ${name} shall not have a VAT exemption reason code or text.`, ['BT-120', 'BT-121']));
    }
  }
  return v;
}

/** BR-S-*, BR-Z-*, BR-E-*, BR-AE-*, BR-IC-*, BR-G-*, BR-O-*, BR-AF-*, BR-AG-*: the shared blocks. */
export const categoryRules: Rule = (invoice) => FAMILIES.flatMap((family) => familyViolations(family, invoice));

/** BR-IC-11 / BR-IC-12: an intra-community supply says when and where it was delivered. */
export const intraCommunityDelivery: Rule = (invoice) => {
  if (!invoice.vatBreakdown.some((e) => e.category === 'K')) return [];
  const v: Violation[] = [];
  const period = invoice.invoicePeriod;
  const hasPeriod = period !== undefined && (present(period.startDate) || present(period.endDate) || present(period.descriptionCode));
  if (!(invoice.delivery?.date ?? '').trim() && !hasPeriod) {
    v.push(fatal('BR-IC-11', 'In an invoice with a VAT breakdown of category "Intra-community supply", the actual delivery date or the invoicing period shall not be blank.', ['BT-72', 'BG-14']));
  }
  if ((invoice.delivery?.countryCode ?? '').trim().length < 2) {
    v.push(fatal('BR-IC-12', 'In an invoice with a VAT breakdown of category "Intra-community supply", the deliver-to country code shall not be blank.', ['BT-80']));
  }
  return v;
};

/** BR-O-11..14: "not subject to VAT" cannot be combined with any other category. */
export const outsideScopeIsExclusive: Rule = (invoice) => {
  if (!invoice.vatBreakdown.some((e) => e.category === 'O')) return [];
  const v: Violation[] = [];
  if (invoice.vatBreakdown.some((e) => e.category !== 'O')) {
    v.push(fatal('BR-O-11', 'An invoice with a VAT breakdown of category "Not subject to VAT" shall not contain other VAT breakdown groups.', ['BG-23']));
  }
  if (invoice.lines.some((l) => l.vatCategory !== 'O')) {
    v.push(fatal('BR-O-12', 'An invoice with a VAT breakdown of category "Not subject to VAT" shall not contain an invoice line with another VAT category.', ['BT-151']));
  }
  if ((invoice.allowances ?? []).some((a) => a.vatCategory !== 'O')) {
    v.push(fatal('BR-O-13', 'An invoice with a VAT breakdown of category "Not subject to VAT" shall not contain a document level allowance with another VAT category.', ['BT-95']));
  }
  if ((invoice.charges ?? []).some((c) => c.vatCategory !== 'O')) {
    v.push(fatal('BR-O-14', 'An invoice with a VAT breakdown of category "Not subject to VAT" shall not contain a document level charge with another VAT category.', ['BT-102']));
  }
  return v;
};

/** BR-B-01 / BR-B-02: Italian split payment is a domestic Italian invoice and does not mix with standard rate. */
export const splitPayment: Rule = (invoice) => {
  const categories: string[] = [
    ...invoice.lines.map((l) => l.vatCategory),
    ...(invoice.allowances ?? []).map((a) => a.vatCategory),
    ...(invoice.charges ?? []).map((c) => c.vatCategory),
    ...invoice.vatBreakdown.map((e) => e.category),
  ];
  if (!categories.includes('B')) return [];
  const v: Violation[] = [];
  const countries = [invoice.seller.address.countryCode, invoice.buyer.address.countryCode, invoice.delivery?.countryCode].filter(present);
  if (countries.some((c) => c !== 'IT')) {
    v.push(fatal('BR-B-01', 'An invoice with VAT category "Split payment" shall be a domestic Italian invoice.', ['BT-40', 'BT-55']));
  }
  if (categories.includes('S')) {
    v.push(fatal('BR-B-02', 'An invoice with VAT category "Split payment" shall not also contain "Standard rated" lines, allowances, charges or breakdowns.', ['BT-118']));
  }
  return v;
};

export const VAT_RULES: readonly Rule[] = [categoryRules, intraCommunityDelivery, outsideScopeIsExclusive, splitPayment];

/**
 * Every rule id this file can report, built from the same table that produces
 * them so the two cannot drift apart. The conformance run checks each one
 * against the official artefacts.
 */
export const VAT_RULE_IDS: readonly string[] = [
  ...FAMILIES.flatMap((f) =>
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((n) => `${f.prefix}-${n}`),
  ),
  'BR-IC-11', 'BR-IC-12', 'BR-O-11', 'BR-O-12', 'BR-O-13', 'BR-O-14', 'BR-B-01', 'BR-B-02',
];
