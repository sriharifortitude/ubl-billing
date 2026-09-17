import { COUNTRY_CODE_PATTERN, CURRENCY_CODE_PATTERN, INVOICE_TYPE_CODES, VAT_CATEGORIES } from '../model/codes.js';
import { fatal, type Rule } from './types.js';

/**
 * Document-level integrity rules from EN 16931, BR-02 through BR-CO-25 as
 * they apply to this model. One function per rule, named after it, so the
 * correspondence to the standard is one-to-one and greppable.
 *
 * Rules that the typed model makes impossible to violate -- BR-01 (the
 * specification identifier is a constant the serialiser writes), BR-08 and
 * BR-10 (addresses are required by the type) -- are deliberately absent. A
 * rule that always passes is worse than no rule: it inflates the coverage
 * count without adding a check. Coverage is stated honestly in the README.
 */


export const br02: Rule = (invoice) =>
  invoice.number.trim() === '' ? [fatal('BR-02', 'An invoice shall have an invoice number.', ['BT-1'])] : [];

export const br03: Rule = (invoice) =>
  /^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate) ? [] : [fatal('BR-03', 'An invoice shall have an issue date.', ['BT-2'])];

export const br04: Rule = (invoice) =>
  invoice.typeCode in INVOICE_TYPE_CODES ? [] : [fatal('BR-04', 'An invoice shall have an invoice type code.', ['BT-3'])];

export const br05: Rule = (invoice) =>
  CURRENCY_CODE_PATTERN.test(invoice.currency) ? [] : [fatal('BR-05', 'An invoice shall have an invoice currency code.', ['BT-5'])];

export const br06: Rule = (invoice) =>
  invoice.seller.name.trim() === '' ? [fatal('BR-06', 'An invoice shall contain the seller name.', ['BT-27'])] : [];

export const br07: Rule = (invoice) =>
  invoice.buyer.name.trim() === '' ? [fatal('BR-07', 'An invoice shall contain the buyer name.', ['BT-44'])] : [];


export const br09: Rule = (invoice) =>
  COUNTRY_CODE_PATTERN.test(invoice.seller.address.countryCode)
    ? []
    : [fatal('BR-09', 'The seller postal address shall contain a seller country code.', ['BT-40'])];


export const br11: Rule = (invoice) =>
  COUNTRY_CODE_PATTERN.test(invoice.buyer.address.countryCode)
    ? []
    : [fatal('BR-11', 'The buyer postal address shall contain a buyer country code.', ['BT-55'])];

export const br16: Rule = (invoice) =>
  invoice.lines.length === 0 ? [fatal('BR-16', 'An invoice shall have at least one invoice line.', ['BG-25'])] : [];

export const br21: Rule = (invoice) => {
  const seen = new Set<string>();
  const violations = [];
  for (const line of invoice.lines) {
    if (seen.has(line.id)) {
      violations.push(fatal('BR-21', `Invoice line identifier "${line.id}" is not unique.`, ['BT-126'], line.id));
    }
    seen.add(line.id);
  }
  return violations;
};

export const br22: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    line.quantity.trim() === '' ? [fatal('BR-22', 'Each invoice line shall have an invoiced quantity.', ['BT-129'], line.id)] : [],
  );

export const br23: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    line.unitCode.trim() === ''
      ? [fatal('BR-23', 'An invoice line shall have an invoiced quantity unit of measure code.', ['BT-130'], line.id)]
      : [],
  );

export const br24: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    line.netAmount === undefined
      ? [fatal('BR-24', 'Each invoice line shall have an invoice line net amount.', ['BT-131'], line.id)]
      : [],
  );

export const br25: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    line.itemName.trim() === '' ? [fatal('BR-25', 'Each invoice line shall contain the item name.', ['BT-153'], line.id)] : [],
  );

export const br26: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    line.netPrice === undefined ? [fatal('BR-26', 'Each invoice line shall contain the item net price.', ['BT-146'], line.id)] : [],
  );

export const br27: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    line.netPrice.startsWith('-') ? [fatal('BR-27', 'The item net price shall not be negative.', ['BT-146'], line.id)] : [],
  );

export const br33: Rule = (invoice) =>
  (invoice.allowances ?? []).flatMap((allowance, index) =>
    allowance.reason === undefined && allowance.reasonCode === undefined
      ? [fatal('BR-33', `Document level allowance ${index + 1} shall have a reason or a reason code.`, ['BT-97', 'BT-98'])]
      : [],
  );

export const br38: Rule = (invoice) =>
  (invoice.charges ?? []).flatMap((charge, index) =>
    charge.reason === undefined && charge.reasonCode === undefined
      ? [fatal('BR-38', `Document level charge ${index + 1} shall have a reason or a reason code.`, ['BT-104', 'BT-105'])]
      : [],
  );

export const brCo04: Rule = (invoice) =>
  invoice.lines.flatMap((line) =>
    line.vatCategory in VAT_CATEGORIES
      ? []
      : [fatal('BR-CO-04', 'Each invoice line shall be categorized with an invoiced item VAT category code.', ['BT-151'], line.id)],
  );

/** BR-CO-09: a VAT identifier shall be prefixed by the ISO 3166-1 alpha-2 country code. */
export const brCo09: Rule = (invoice) => {
  const violations = [];
  for (const [party, term] of [[invoice.seller, 'BT-31'], [invoice.buyer, 'BT-48']] as const) {
    if (party.vatId !== undefined && !/^[A-Z]{2}/.test(party.vatId)) {
      violations.push(fatal('BR-CO-09', `VAT identifier "${party.vatId}" shall be prefixed by a country code.`, [term]));
    }
  }
  return violations;
};

/** BR-CO-25: if the amount due is positive, a due date or payment terms must be present. */
export const brCo25: Rule = (invoice) =>
  Number(invoice.totals.payableAmount) > 0 && invoice.dueDate === undefined && invoice.paymentTerms === undefined
    ? [fatal('BR-CO-25', 'In case the amount due for payment is positive, either the payment due date or the payment terms shall be present.', ['BT-9', 'BT-20'])]
    : [];

export const CORE_RULES: readonly Rule[] = [
  br02, br03, br04, br05, br06, br07, br09, br11, br16, br21, br22, br23, br24, br25, br26, br27,
  br33, br38, brCo04, brCo09, brCo25,
];
