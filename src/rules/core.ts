import { COUNTRY_CODE_PATTERN, CURRENCY_CODE_PATTERN, VAT_ID_PREFIXES } from '../model/codes.js';
import type { Invoice } from '../model/invoice.js';
import { tryAmount } from '../money/decimal.js';
import { fatal, type Rule, type Violation } from './types.js';

/**
 * Document-level integrity rules from EN 16931, as they apply to this model.
 * One function per rule, named after it, so the correspondence to the
 * standard is one-to-one and greppable.
 *
 * Every rule here was checked against the official validation artefacts, not
 * only against the specification text: conformance/run.ts runs the official
 * Schematron and this code over the same documents and compares them. Two
 * things that came out of that and are visible in this file:
 *
 *  - Rules about a missing mandatory field are reported by rule id. They used
 *    to fail in the parser as "Missing required element ID", which is not
 *    what the sender's access point will say back, and not something they
 *    can look up.
 *  - BR-08 and BR-10 are implemented. They were once left out as "impossible
 *    to violate because the type requires an address", which is true of the
 *    type and not of a parsed document.
 */

const blank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

export const br02: Rule = (invoice) =>
  blank(invoice.number) ? [fatal('BR-02', 'An invoice shall have an invoice number.', ['BT-1'])] : [];

export const br03: Rule = (invoice) =>
  /^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate) ? [] : [fatal('BR-03', 'An invoice shall have an issue date (YYYY-MM-DD).', ['BT-2'])];

/**
 * BR-04 asks only that a type code is present. Whether it is one of the
 * allowed codes is a code-list rule (BR-CL-01), which is not implemented, so
 * a present-but-unknown code passes here exactly as it does in the standard.
 */
export const br04: Rule = (invoice) =>
  blank(invoice.typeCode) ? [fatal('BR-04', 'An invoice shall have an invoice type code.', ['BT-3'])] : [];

export const br05: Rule = (invoice) =>
  CURRENCY_CODE_PATTERN.test(invoice.currency) ? [] : [fatal('BR-05', 'An invoice shall have an invoice currency code.', ['BT-5'])];

export const br06: Rule = (invoice) =>
  blank(invoice.seller.name) ? [fatal('BR-06', 'An invoice shall contain the seller name.', ['BT-27'])] : [];

export const br07: Rule = (invoice) =>
  blank(invoice.buyer.name) ? [fatal('BR-07', 'An invoice shall contain the buyer name.', ['BT-44'])] : [];

/**
 * A postal address is "absent" when it has nothing in it, country included.
 * An address element that exists but is empty looks the same here, so for
 * that one case this reports BR-08 as well as BR-09 where the standard
 * reports only BR-09.
 */
const emptyAddress = (a: Invoice['seller']['address']): boolean =>
  [a.street, a.additionalStreet, a.city, a.postalCode, a.countrySubdivision, a.countryCode].every(blank);

export const br08: Rule = (invoice) =>
  emptyAddress(invoice.seller.address) ? [fatal('BR-08', 'An invoice shall contain the seller postal address.', ['BG-5'])] : [];

export const br09: Rule = (invoice) =>
  COUNTRY_CODE_PATTERN.test(invoice.seller.address.countryCode)
    ? []
    : [fatal('BR-09', 'The seller postal address shall contain a seller country code.', ['BT-40'])];

export const br10: Rule = (invoice) =>
  emptyAddress(invoice.buyer.address) ? [fatal('BR-10', 'An invoice shall contain the buyer postal address.', ['BG-8'])] : [];

export const br11: Rule = (invoice) =>
  COUNTRY_CODE_PATTERN.test(invoice.buyer.address.countryCode)
    ? []
    : [fatal('BR-11', 'The buyer postal address shall contain a buyer country code.', ['BT-55'])];

/** BR-12..BR-15: the four document totals every invoice carries. */
export const br12to15: Rule = (invoice) => {
  const t = invoice.totals;
  const checks: [string, string, string, string][] = [
    ['BR-12', t.lineExtensionAmount, 'Sum of Invoice line net amount', 'BT-106'],
    ['BR-13', t.taxExclusiveAmount, 'Invoice total amount without VAT', 'BT-109'],
    ['BR-14', t.taxInclusiveAmount, 'Invoice total amount with VAT', 'BT-112'],
    ['BR-15', t.payableAmount, 'Amount due for payment', 'BT-115'],
  ];
  return checks.flatMap(([rule, value, name, term]) => (blank(value) ? [fatal(rule, `An invoice shall have the ${name} (${term}).`, [term])] : []));
};

export const br16: Rule = (invoice) =>
  invoice.lines.length === 0 ? [fatal('BR-16', 'An invoice shall have at least one invoice line.', ['BG-25'])] : [];

export const br21: Rule = (invoice) => {
  const seen = new Set<string>();
  const violations: Violation[] = [];
  for (const line of invoice.lines) {
    // Missing and duplicate identifiers are different failures in the
    // standard: BR-21 is the first, and a duplicate is not a rule at all.
    if (blank(line.id)) violations.push(fatal('BR-21', 'Each invoice line shall have an invoice line identifier.', ['BT-126']));
    else if (seen.has(line.id)) violations.push(fatal('BR-21', `Invoice line identifier "${line.id}" is not unique.`, ['BT-126'], line.id));
    seen.add(line.id);
  }
  return violations;
};

export const br22: Rule = (invoice) =>
  invoice.lines.flatMap((line) => (blank(line.quantity) ? [fatal('BR-22', 'Each invoice line shall have an invoiced quantity.', ['BT-129'], line.id)] : []));

export const br23: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    blank(line.unitCode) ? [fatal('BR-23', 'An invoice line shall have an invoiced quantity unit of measure code.', ['BT-130'], line.id)] : [],
  );

export const br24: Rule = (invoice) =>
  invoice.lines.flatMap((line) => (blank(line.netAmount) ? [fatal('BR-24', 'Each invoice line shall have an invoice line net amount.', ['BT-131'], line.id)] : []));

export const br25: Rule = (invoice) =>
  invoice.lines.flatMap((line) => (blank(line.itemName) ? [fatal('BR-25', 'Each invoice line shall contain the item name.', ['BT-153'], line.id)] : []));

export const br26: Rule = (invoice) =>
  invoice.lines.flatMap((line) => (blank(line.netPrice) ? [fatal('BR-26', 'Each invoice line shall contain the item net price.', ['BT-146'], line.id)] : []));

/** BR-27's test is `price >= 0`, which is also false for a price that is not there. */
export const br27: Rule = (invoice) =>
  invoice.lines.flatMap((line) => {
    const price = tryAmount(line.netPrice);
    return price === undefined || price.isNegative() ? [fatal('BR-27', 'The item net price shall not be negative.', ['BT-146'], line.id)] : [];
  });

export const br33: Rule = (invoice) =>
  (invoice.allowances ?? []).flatMap((allowance, index) =>
    blank(allowance.reason) && blank(allowance.reasonCode)
      ? [fatal('BR-33', `Document level allowance ${index + 1} shall have a reason or a reason code.`, ['BT-97', 'BT-98'])]
      : [],
  );

export const br38: Rule = (invoice) =>
  (invoice.charges ?? []).flatMap((charge, index) =>
    blank(charge.reason) && blank(charge.reasonCode)
      ? [fatal('BR-38', `Document level charge ${index + 1} shall have a reason or a reason code.`, ['BT-104', 'BT-105'])]
      : [],
  );

/** BR-45..BR-48: each VAT breakdown entry is complete. */
export const br45to48: Rule = (invoice) =>
  invoice.vatBreakdown.flatMap((entry) => {
    const v: Violation[] = [];
    if (blank(entry.taxableAmount)) v.push(fatal('BR-45', 'Each VAT breakdown shall have a VAT category taxable amount.', ['BT-116']));
    if (blank(entry.taxAmount)) v.push(fatal('BR-46', 'Each VAT breakdown shall have a VAT category tax amount.', ['BT-117']));
    if (blank(entry.category)) v.push(fatal('BR-47', 'Each VAT breakdown shall be defined through a VAT category code.', ['BT-118']));
    if (blank(entry.rate) && entry.category !== 'O') {
      v.push(fatal('BR-48', 'Each VAT breakdown shall have a VAT category rate, except if the invoice is not subject to VAT.', ['BT-119']));
    }
    return v;
  });

/**
 * BR-49, BR-50, BR-61: every payment instruction says how it is paid, and a
 * credit transfer names the account. BR-50 reads the account element and so
 * applies only to means 30 and 58; BR-61 is the same requirement stated on the
 * means code, so an absent account fails BR-61 alone and an account without an
 * identifier fails both.
 */
export const br49to50: Rule = (invoice) => {
  const v: Violation[] = [];
  for (const payment of [invoice.payment, ...(invoice.furtherPayments ?? [])]) {
    if (payment === undefined) continue;
    if (blank(payment.meansCode)) v.push(fatal('BR-49', 'A payment instruction shall specify the payment means type code.', ['BT-81']));
    if (payment.meansCode !== '30' && payment.meansCode !== '58') continue;
    const missingId = payment.creditTransfer === undefined || blank(payment.creditTransfer.accountId);
    if (payment.creditTransfer !== undefined && missingId) {
      v.push(fatal('BR-50', 'A payment account identifier shall be present if credit transfer information is provided.', ['BT-84']));
    }
    if (missingId) v.push(fatal('BR-61', 'If the payment means type code means a credit transfer, the payment account identifier shall be present.', ['BT-81', 'BT-84']));
  }
  return v;
};

/** BR-53: when the VAT accounting currency differs, the VAT amount in it is given. */
export const br53: Rule = (invoice) =>
  !blank(invoice.vatAccountingCurrency) && blank(invoice.totals.taxAmountInAccountingCurrency)
    ? [fatal('BR-53', 'If the VAT accounting currency code is present, the invoice total VAT amount in accounting currency shall be provided.', ['BT-6', 'BT-111'])]
    : [];

/** BR-CO-18: at least one VAT breakdown. */
export const brCo18: Rule = (invoice) =>
  invoice.vatBreakdown.length === 0 ? [fatal('BR-CO-18', 'An invoice shall at least have one VAT breakdown group.', ['BG-23'])] : [];

/** BR-CO-19: an invoicing period states a start, an end, or both. */
export const brCo19: Rule = (invoice) => {
  const period = invoice.invoicePeriod;
  if (period === undefined) return [];
  return blank(period.startDate) && blank(period.endDate) && blank(period.descriptionCode)
    ? [fatal('BR-CO-19', 'If the invoicing period is used, the start date or the end date shall be filled, or both.', ['BT-73', 'BT-74'])]
    : [];
};

export const brCo04: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    blank(line.vatCategory) ? [fatal('BR-CO-04', 'Each invoice line shall be categorized with an invoiced item VAT category code.', ['BT-151'], line.id)] : [],
  );

/**
 * BR-CO-09: a VAT identifier is prefixed by a country code from the official
 * list (which includes "EL" for Greece and "XI" for Northern Ireland), and
 * applies to the seller, the buyer and the seller's tax representative.
 */
export const brCo09: Rule = (invoice) => {
  const violations: Violation[] = [];
  for (const [id, term] of [
    [invoice.seller.vatId, 'BT-31'],
    [invoice.buyer.vatId, 'BT-48'],
    [invoice.taxRepresentativeVatId, 'BT-63'],
  ] as const) {
    if (id !== undefined && !VAT_ID_PREFIXES.has(id.slice(0, 2))) {
      violations.push(fatal('BR-CO-09', `VAT identifier "${id}" shall be prefixed by a country code from the list the standard allows.`, [term]));
    }
  }
  return violations;
};

/**
 * BR-CO-25: if the amount due is positive, a due date or payment terms must
 * be present.
 *
 * Not in the default rule set. The official artefacts enforced it up to
 * release 1.3.15 and 1.3.16 (April 2026) does not contain it for UBL at all
 * (its release notes list "BR-CO-25 applied on credit notes in UBL but not
 * CII"). Enforcing it by default rejected 116 documents the current official
 * validator accepts. It stays available through ValidateOptions for anyone
 * who validates against an older release or wants the stricter behaviour.
 */
export const brCo25: Rule = (invoice) =>
  Number(invoice.totals.payableAmount) > 0 && invoice.dueDate === undefined && invoice.paymentTerms === undefined
    ? [fatal('BR-CO-25', 'In case the amount due for payment is positive, either the payment due date or the payment terms shall be present.', ['BT-9', 'BT-20'])]
    : [];

export const CORE_RULES: readonly Rule[] = [
  br02, br03, br04, br05, br06, br07, br08, br09, br10, br11, br12to15, br16, br21, br22, br23, br24, br25, br26, br27,
  br33, br38, br45to48, br49to50, br53, brCo04, brCo09, brCo18, brCo19,
];

/** Rules that are off unless asked for. */
export const OPTIONAL_RULES: Readonly<Record<'paymentTermsRequired', Rule>> = { paymentTermsRequired: brCo25 };
