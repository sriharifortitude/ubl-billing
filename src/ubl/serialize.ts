import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';

import { PEPPOL_CUSTOMIZATION_ID, PEPPOL_PROFILE_ID } from '../model/codes.js';
import type { AllowanceCharge, Invoice, Line, Party, VatBreakdownEntry } from '../model/invoice.js';
import { amount, formatAmount, formatPercent, formatQuantity } from '../money/decimal.js';

/**
 * Produces a UBL 2.1 Invoice (or CreditNote) conforming to Peppol BIS
 * Billing 3.0.
 *
 * Element order is not stylistic here: UBL is schema-validated with xsd
 * sequences, and an element in the wrong position is a rejection before any
 * business rule is looked at. The order below follows the UBL-Invoice-2.1
 * schema and every element carries the business term it implements, because
 * that mapping is the thing a reader of this file is trying to verify.
 */

export const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  creditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const;

export interface SerializeOptions {
  /** Pretty-print with indentation. Default false: access points do not care, and it costs bytes. */
  readonly pretty?: boolean;
}

export function toUbl(invoice: Invoice, options: SerializeOptions = {}): string {
  const isCreditNote = invoice.typeCode === '381';
  const rootName = isCreditNote ? 'CreditNote' : 'Invoice';
  const rootNs = isCreditNote ? NS.creditNote : NS.invoice;

  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(rootNs, rootName, {
    'xmlns:cac': NS.cac,
    'xmlns:cbc': NS.cbc,
  });

  // BT-24, BT-23
  cbc(doc, 'CustomizationID', PEPPOL_CUSTOMIZATION_ID);
  cbc(doc, 'ProfileID', PEPPOL_PROFILE_ID);
  // BT-1, BT-2
  cbc(doc, 'ID', invoice.number);
  cbc(doc, 'IssueDate', invoice.issueDate);
  // BT-9: DueDate exists on Invoice only; a CreditNote carries it in PaymentMeans.
  if (!isCreditNote && invoice.dueDate !== undefined) cbc(doc, 'DueDate', invoice.dueDate);
  // BT-3
  cbc(doc, isCreditNote ? 'CreditNoteTypeCode' : 'InvoiceTypeCode', invoice.typeCode);
  // BT-22
  if (invoice.note !== undefined) cbc(doc, 'Note', invoice.note);
  // BT-7
  if (invoice.vatPointDate !== undefined) cbc(doc, 'TaxPointDate', invoice.vatPointDate);
  // BT-5, BT-6
  cbc(doc, 'DocumentCurrencyCode', invoice.currency);
  if (invoice.vatAccountingCurrency !== undefined) cbc(doc, 'TaxCurrencyCode', invoice.vatAccountingCurrency);
  // BT-10
  if (invoice.buyerReference !== undefined) cbc(doc, 'BuyerReference', invoice.buyerReference);

  // BT-13
  if (invoice.purchaseOrderReference !== undefined) {
    cbc(doc.ele(NS.cac, 'cac:OrderReference'), 'ID', invoice.purchaseOrderReference);
  }
  // BG-3
  for (const ref of invoice.precedingInvoiceReferences ?? []) {
    const docRef = doc.ele(NS.cac, 'cac:BillingReference').ele(NS.cac, 'cac:InvoiceDocumentReference');
    cbc(docRef, 'ID', ref.number);
    if (ref.issueDate !== undefined) cbc(docRef, 'IssueDate', ref.issueDate);
  }
  // BT-12
  if (invoice.contractReference !== undefined) {
    cbc(doc.ele(NS.cac, 'cac:ContractDocumentReference'), 'ID', invoice.contractReference);
  }

  // BG-4, BG-7
  writeParty(doc.ele(NS.cac, 'cac:AccountingSupplierParty'), invoice.seller);
  writeParty(doc.ele(NS.cac, 'cac:AccountingCustomerParty'), invoice.buyer);

  // BG-10
  if (invoice.payee !== undefined) {
    const payee = doc.ele(NS.cac, 'cac:PayeeParty');
    cbc(payee.ele(NS.cac, 'cac:PartyName'), 'Name', invoice.payee.name);
    if (invoice.payee.legalRegistrationId !== undefined) {
      cbc(payee.ele(NS.cac, 'cac:PartyLegalEntity'), 'CompanyID', invoice.payee.legalRegistrationId);
    }
  }

  // BG-16
  if (invoice.payment !== undefined) {
    const means = doc.ele(NS.cac, 'cac:PaymentMeans');
    const code = cbc(means, 'PaymentMeansCode', invoice.payment.meansCode);
    if (invoice.payment.meansText !== undefined) code.att('name', invoice.payment.meansText);
    if (isCreditNote && invoice.dueDate !== undefined) cbc(means, 'PaymentDueDate', invoice.dueDate);
    if (invoice.payment.remittanceInformation !== undefined) cbc(means, 'PaymentID', invoice.payment.remittanceInformation);
    if (invoice.payment.creditTransfer !== undefined) {
      const account = means.ele(NS.cac, 'cac:PayeeFinancialAccount');
      cbc(account, 'ID', invoice.payment.creditTransfer.accountId);
      if (invoice.payment.creditTransfer.accountName !== undefined) cbc(account, 'Name', invoice.payment.creditTransfer.accountName);
      if (invoice.payment.creditTransfer.serviceProviderId !== undefined) {
        cbc(account.ele(NS.cac, 'cac:FinancialInstitutionBranch'), 'ID', invoice.payment.creditTransfer.serviceProviderId);
      }
    }
  }
  // BT-20
  if (invoice.paymentTerms !== undefined) cbc(doc.ele(NS.cac, 'cac:PaymentTerms'), 'Note', invoice.paymentTerms);

  // BG-20, BG-21
  for (const allowance of invoice.allowances ?? []) writeAllowanceCharge(doc, allowance, false, invoice.currency, true);
  for (const charge of invoice.charges ?? []) writeAllowanceCharge(doc, charge, true, invoice.currency, true);

  // BG-23
  const taxTotal = doc.ele(NS.cac, 'cac:TaxTotal');
  cbcAmount(taxTotal, 'TaxAmount', invoice.totals.taxAmount, invoice.currency);
  for (const entry of invoice.vatBreakdown) writeTaxSubtotal(taxTotal, entry, invoice.currency);

  // BG-22
  const totals = doc.ele(NS.cac, 'cac:LegalMonetaryTotal');
  cbcAmount(totals, 'LineExtensionAmount', invoice.totals.lineExtensionAmount, invoice.currency);
  cbcAmount(totals, 'TaxExclusiveAmount', invoice.totals.taxExclusiveAmount, invoice.currency);
  cbcAmount(totals, 'TaxInclusiveAmount', invoice.totals.taxInclusiveAmount, invoice.currency);
  if (!amount(invoice.totals.allowanceTotalAmount).isZero()) cbcAmount(totals, 'AllowanceTotalAmount', invoice.totals.allowanceTotalAmount, invoice.currency);
  if (!amount(invoice.totals.chargeTotalAmount).isZero()) cbcAmount(totals, 'ChargeTotalAmount', invoice.totals.chargeTotalAmount, invoice.currency);
  if (!amount(invoice.totals.prepaidAmount).isZero()) cbcAmount(totals, 'PrepaidAmount', invoice.totals.prepaidAmount, invoice.currency);
  if (!amount(invoice.totals.payableRoundingAmount).isZero()) cbcAmount(totals, 'PayableRoundingAmount', invoice.totals.payableRoundingAmount, invoice.currency);
  cbcAmount(totals, 'PayableAmount', invoice.totals.payableAmount, invoice.currency);

  // BG-25
  for (const line of invoice.lines) writeLine(doc, line, invoice.currency, isCreditNote);

  return doc.end({ prettyPrint: options.pretty ?? false });
}

function cbc(parent: XMLBuilder, name: string, value: string): XMLBuilder {
  return parent.ele(NS.cbc, `cbc:${name}`).txt(value);
}

function cbcAmount(parent: XMLBuilder, name: string, value: string, currency: string): XMLBuilder {
  return parent.ele(NS.cbc, `cbc:${name}`, { currencyID: currency }).txt(formatAmount(amount(value)));
}

function writeParty(container: XMLBuilder, party: Party): void {
  const el = container.ele(NS.cac, 'cac:Party');

  // BT-34 / BT-49
  if (party.electronicAddress !== undefined) {
    el.ele(NS.cbc, 'cbc:EndpointID', { schemeID: party.electronicAddress.scheme }).txt(party.electronicAddress.value);
  }
  // BT-28 / BT-45
  if (party.tradingName !== undefined) cbc(el.ele(NS.cac, 'cac:PartyName'), 'Name', party.tradingName);

  // BG-5 / BG-8
  const address = el.ele(NS.cac, 'cac:PostalAddress');
  if (party.address.street !== undefined) cbc(address, 'StreetName', party.address.street);
  if (party.address.additionalStreet !== undefined) cbc(address, 'AdditionalStreetName', party.address.additionalStreet);
  if (party.address.city !== undefined) cbc(address, 'CityName', party.address.city);
  if (party.address.postalCode !== undefined) cbc(address, 'PostalZone', party.address.postalCode);
  if (party.address.countrySubdivision !== undefined) cbc(address, 'CountrySubentity', party.address.countrySubdivision);
  cbc(address.ele(NS.cac, 'cac:Country'), 'IdentificationCode', party.address.countryCode);

  // BT-31 / BT-48: VAT id. BT-32: tax registration, scheme "TAX" rather than "VAT".
  if (party.vatId !== undefined) {
    const scheme = el.ele(NS.cac, 'cac:PartyTaxScheme');
    cbc(scheme, 'CompanyID', party.vatId);
    cbc(scheme.ele(NS.cac, 'cac:TaxScheme'), 'ID', 'VAT');
  }
  if (party.taxRegistrationId !== undefined) {
    const scheme = el.ele(NS.cac, 'cac:PartyTaxScheme');
    cbc(scheme, 'CompanyID', party.taxRegistrationId);
    cbc(scheme.ele(NS.cac, 'cac:TaxScheme'), 'ID', 'TAX');
  }

  // BT-27 / BT-44, BT-30 / BT-47
  const legal = el.ele(NS.cac, 'cac:PartyLegalEntity');
  cbc(legal, 'RegistrationName', party.name);
  if (party.legalRegistrationId !== undefined) cbc(legal, 'CompanyID', party.legalRegistrationId);

  // BG-6 / BG-9
  if (party.contact !== undefined) {
    const contact = el.ele(NS.cac, 'cac:Contact');
    if (party.contact.name !== undefined) cbc(contact, 'Name', party.contact.name);
    if (party.contact.telephone !== undefined) cbc(contact, 'Telephone', party.contact.telephone);
    if (party.contact.email !== undefined) cbc(contact, 'ElectronicMail', party.contact.email);
  }
}

function writeAllowanceCharge(
  parent: XMLBuilder,
  item: AllowanceCharge | Omit<AllowanceCharge, 'vatCategory' | 'vatRate'>,
  isCharge: boolean,
  currency: string,
  documentLevel: boolean,
): void {
  const el = parent.ele(NS.cac, 'cac:AllowanceCharge');
  cbc(el, 'ChargeIndicator', isCharge ? 'true' : 'false');
  if (item.reasonCode !== undefined) cbc(el, 'AllowanceChargeReasonCode', item.reasonCode);
  if (item.reason !== undefined) cbc(el, 'AllowanceChargeReason', item.reason);
  if (item.percentage !== undefined) cbc(el, 'MultiplierFactorNumeric', formatPercent(amount(item.percentage)));
  cbcAmount(el, 'Amount', item.amount, currency);
  if (item.baseAmount !== undefined) cbcAmount(el, 'BaseAmount', item.baseAmount, currency);

  // Document-level allowances and charges carry their own VAT category
  // (BT-95, BT-102); line-level ones inherit the line's and must not.
  if (documentLevel && 'vatCategory' in item) {
    const category = el.ele(NS.cac, 'cac:TaxCategory');
    cbc(category, 'ID', item.vatCategory);
    if (item.vatRate !== undefined) cbc(category, 'Percent', formatPercent(amount(item.vatRate)));
    cbc(category.ele(NS.cac, 'cac:TaxScheme'), 'ID', 'VAT');
  }
}

function writeTaxSubtotal(parent: XMLBuilder, entry: VatBreakdownEntry, currency: string): void {
  const el = parent.ele(NS.cac, 'cac:TaxSubtotal');
  cbcAmount(el, 'TaxableAmount', entry.taxableAmount, currency);
  cbcAmount(el, 'TaxAmount', entry.taxAmount, currency);
  const category = el.ele(NS.cac, 'cac:TaxCategory');
  cbc(category, 'ID', entry.category);
  if (entry.rate !== undefined) cbc(category, 'Percent', formatPercent(amount(entry.rate)));
  if (entry.exemptionReasonCode !== undefined) cbc(category, 'TaxExemptionReasonCode', entry.exemptionReasonCode);
  if (entry.exemptionReason !== undefined) cbc(category, 'TaxExemptionReason', entry.exemptionReason);
  cbc(category.ele(NS.cac, 'cac:TaxScheme'), 'ID', 'VAT');
}

function writeLine(parent: XMLBuilder, line: Line, currency: string, isCreditNote: boolean): void {
  const el = parent.ele(NS.cac, isCreditNote ? 'cac:CreditNoteLine' : 'cac:InvoiceLine');
  // BT-126, BT-127
  cbc(el, 'ID', line.id);
  if (line.note !== undefined) cbc(el, 'Note', line.note);
  // BT-129, BT-130
  el.ele(NS.cbc, isCreditNote ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity', { unitCode: line.unitCode }).txt(formatQuantity(amount(line.quantity)));
  // BT-131
  cbcAmount(el, 'LineExtensionAmount', line.netAmount, currency);
  // BT-132
  if (line.orderLineReference !== undefined) cbc(el.ele(NS.cac, 'cac:OrderLineReference'), 'LineID', line.orderLineReference);
  // BG-27, BG-28
  for (const allowance of line.allowances ?? []) writeAllowanceCharge(el, allowance, false, currency, false);
  for (const charge of line.charges ?? []) writeAllowanceCharge(el, charge, true, currency, false);

  // BG-31 item
  const item = el.ele(NS.cac, 'cac:Item');
  if (line.itemDescription !== undefined) cbc(item, 'Description', line.itemDescription);
  cbc(item, 'Name', line.itemName);
  if (line.sellerItemId !== undefined) cbc(item.ele(NS.cac, 'cac:SellersItemIdentification'), 'ID', line.sellerItemId);
  // BG-30
  const category = item.ele(NS.cac, 'cac:ClassifiedTaxCategory');
  cbc(category, 'ID', line.vatCategory);
  if (line.vatRate !== undefined) cbc(category, 'Percent', formatPercent(amount(line.vatRate)));
  cbc(category.ele(NS.cac, 'cac:TaxScheme'), 'ID', 'VAT');

  // BG-29 price
  const price = el.ele(NS.cac, 'cac:Price');
  price.ele(NS.cbc, 'cbc:PriceAmount', { currencyID: currency }).txt(amount(line.netPrice).toString());
  if (line.priceBaseQuantity !== undefined) {
    price.ele(NS.cbc, 'cbc:BaseQuantity', { unitCode: line.unitCode }).txt(formatQuantity(amount(line.priceBaseQuantity)));
  }
}
