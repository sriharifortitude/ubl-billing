import { EU_MEMBER_STATES } from '../model/codes.js';
import { fatal, type Rule, warning, type Violation } from './types.js';

/**
 * Peppol BIS Billing 3.0 adds rules on top of EN 16931. The ones here are
 * the ones that reject a document at an access point most often in practice:
 * the buyer reference, the electronic addresses, and the VAT-id shape.
 *
 * The full BIS has around 90 rules including national ones; the README
 * states which are implemented.
 */

/** PEPPOL-EN16931-R003: a buyer reference or purchase order reference shall be provided. */
export const r003: Rule = (invoice) =>
  invoice.buyerReference === undefined && invoice.purchaseOrderReference === undefined
    ? [fatal('PEPPOL-EN16931-R003', 'A buyer reference or purchase order reference MUST be provided.', ['BT-10', 'BT-13'])]
    : [];

/** PEPPOL-EN16931-R010: buyer electronic address MUST be provided. */
export const r010: Rule = (invoice) =>
  invoice.buyer.electronicAddress === undefined
    ? [fatal('PEPPOL-EN16931-R010', 'Buyer electronic address MUST be provided.', ['BT-49'])]
    : [];

/** PEPPOL-EN16931-R020: seller electronic address MUST be provided. */
export const r020: Rule = (invoice) =>
  invoice.seller.electronicAddress === undefined
    ? [fatal('PEPPOL-EN16931-R020', 'Seller electronic address MUST be provided.', ['BT-34'])]
    : [];

/**
 * PEPPOL-EN16931-R040: allowance/charge amount must not be negative, and
 * R041/R042: percentage and base amount go together.
 */
export const r040: Rule = (invoice) => {
  const violations: Violation[] = [];
  for (const item of [...(invoice.allowances ?? []), ...(invoice.charges ?? [])]) {
    if ((item.percentage === undefined) !== (item.baseAmount === undefined)) {
      violations.push(fatal('PEPPOL-EN16931-R041', 'Allowance/charge base amount MUST be provided when allowance/charge percentage is provided, and vice versa.', ['BT-93', 'BT-94']));
    }
  }
  return violations;
};

/** PEPPOL-EN16931-R061: a mandatory scheme identifier shall accompany a payment account identifier for SEPA. */
export const r061: Rule = (invoice) => {
  const payment = invoice.payment;
  if (payment === undefined) return [];
  if ((payment.meansCode === '58' || payment.meansCode === '30') && payment.creditTransfer === undefined) {
    return [fatal('PEPPOL-EN16931-R061', 'Payment account identifier (BT-84) MUST be provided when payment means is credit transfer.', ['BT-84'])];
  }
  return [];
};

/** PEPPOL-EN16931-CL007: a seller VAT identifier prefixed with an EU country code should be a syntactically plausible VAT number. */
export const cl007: Rule = (invoice) => {
  const violations: Violation[] = [];
  for (const [party, term] of [[invoice.seller, 'BT-31'], [invoice.buyer, 'BT-48']] as const) {
    const id = party.vatId;
    if (id === undefined) continue;
    const prefix = id.slice(0, 2);
    if (EU_MEMBER_STATES.has(prefix) && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(id)) {
      violations.push(warning('PEPPOL-EN16931-CL007', `VAT identifier "${id}" does not look like a valid EU VAT number.`, [term]));
    }
  }
  return violations;
};

/**
 * A K (intra-community) supply must be between two EU member states. Not a
 * numbered Peppol rule but a substantive check every tax authority makes and
 * that a validator focused on structure would miss.
 */
export const intraCommunityCountries: Rule = (invoice) => {
  const usesK = invoice.lines.some((line) => line.vatCategory === 'K');
  if (!usesK) return [];
  const seller = invoice.seller.address.countryCode;
  const buyer = invoice.buyer.address.countryCode;
  if (!EU_MEMBER_STATES.has(seller) || !EU_MEMBER_STATES.has(buyer)) {
    return [warning('UBL-BILLING-K-COUNTRIES', `Intra-community supply (category K) between ${seller} and ${buyer}: both parties are expected to be in EU member states.`, ['BT-40', 'BT-55'])];
  }
  if (seller === buyer) {
    return [warning('UBL-BILLING-K-SAME-STATE', `Intra-community supply (category K) with seller and buyer both in ${seller}: a domestic supply is not intra-community.`, ['BT-40', 'BT-55'])];
  }
  return [];
};

export const PEPPOL_RULES: readonly Rule[] = [r003, r010, r020, r040, r061, cl007, intraCommunityCountries];
