import { XMLParser } from 'fast-xml-parser';

import type { ElectronicAddressScheme, InvoiceTypeCode, VatCategory } from '../model/codes.js';
import type { AllowanceCharge, Invoice, Line, Party, Totals, VatBreakdownEntry } from '../model/invoice.js';

/**
 * Reads a UBL 2.1 Invoice or CreditNote into the model.
 *
 * What is parsed is what the document says, including its totals. Nothing is
 * recalculated: a parsed document that fails BR-CO-14 should say so, not be
 * quietly repaired. Validation is a separate step the caller runs.
 *
 * The parser is tolerant on purpose. A document missing its invoice number
 * parses, with an empty number, and validate() then reports BR-02 by name.
 * Throwing "Missing required element ID" here would turn a rule violation
 * into an anonymous parse error: the sender could no longer match it against
 * what their access point returns. UblParseError is for documents that
 * cannot be read as an invoice at all.
 *
 * The parser is namespace-aware by prefix stripping rather than by full
 * namespace resolution: real-world UBL uses the conventional cac:/cbc:
 * prefixes universally, and full resolution would add a dependency for a
 * case that has not been observed.
 */

export class UblParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UblParseError';
  }
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  // Every value stays a string. Letting the parser coerce "10.00" to the
  // number 10 would lose the two decimals that BR-DEC-* checks and, worse,
  // hand a float to code that must never see one.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) =>
    ['InvoiceLine', 'CreditNoteLine', 'TaxTotal', 'TaxSubtotal', 'AllowanceCharge', 'PartyTaxScheme', 'BillingReference', 'PaymentMeans'].includes(name),
});

export function fromUbl(xml: string): Invoice {
  const parsed = parser.parse(xml) as Node;
  const root = (parsed['Invoice'] ?? parsed['CreditNote']) as Node | undefined;
  if (root === undefined || typeof root !== 'object') throw new UblParseError('Document root is neither Invoice nor CreditNote.');
  const isCreditNote = parsed['CreditNote'] !== undefined;

  // No default for the type code: BR-04 says an invoice shall have one, and
  // filling in 380 here would let a document without one pass.
  const typeCode = text(root, isCreditNote ? 'CreditNoteTypeCode' : 'InvoiceTypeCode') ?? '';
  const currency = text(root, 'DocumentCurrencyCode') ?? '';
  const vatAccountingCurrency = text(root, 'TaxCurrencyCode');

  const supplier = optionalNode(optionalNode(root, 'AccountingSupplierParty') ?? {}, 'Party') ?? {};
  const customer = optionalNode(optionalNode(root, 'AccountingCustomerParty') ?? {}, 'Party') ?? {};

  // BT-110 is the TaxTotal in the invoice currency, and carries the VAT
  // breakdown. BT-111, when BT-6 names another currency, is a second
  // TaxTotal with only a TaxAmount. Which is which comes from the
  // currencyID, not from the order they appear in.
  const taxTotals = (root['TaxTotal'] ?? []) as Node[];
  const inCurrency = (t: Node, code: string | undefined): boolean => code !== undefined && attribute(t, 'TaxAmount', 'currencyID') === code;
  const documentTax = taxTotals.find((t) => inCurrency(t, currency)) ?? taxTotals.find((t) => t['TaxSubtotal'] !== undefined) ?? taxTotals[0] ?? {};
  // When BT-6 equals the invoice currency the one TaxTotal serves as both.
  const accountingTax = taxTotals.find((t) => inCurrency(t, vatAccountingCurrency));

  const monetary = optionalNode(root, 'LegalMonetaryTotal') ?? {};
  const lineNodes = (root[isCreditNote ? 'CreditNoteLine' : 'InvoiceLine'] ?? []) as Node[];

  const allowanceCharges = (root['AllowanceCharge'] ?? []) as Node[];
  const allowances = allowanceCharges.filter((n) => indicator(n) === false).map(parseAllowanceCharge);
  const charges = allowanceCharges.filter((n) => indicator(n) === true).map(parseAllowanceCharge);

  const allMeans = ((root['PaymentMeans'] ?? []) as unknown[]).map((m) => (typeof m === 'object' && m !== null ? (m as Node) : {}));
  const paymentMeans = allMeans[0];
  const dueDate = text(root, 'DueDate') ?? (paymentMeans === undefined ? undefined : text(paymentMeans, 'PaymentDueDate'));

  const totals: Totals = {
    lineExtensionAmount: text(monetary, 'LineExtensionAmount') ?? '',
    taxExclusiveAmount: text(monetary, 'TaxExclusiveAmount') ?? '',
    taxInclusiveAmount: text(monetary, 'TaxInclusiveAmount') ?? '',
    allowanceTotalAmount: text(monetary, 'AllowanceTotalAmount') ?? '0.00',
    chargeTotalAmount: text(monetary, 'ChargeTotalAmount') ?? '0.00',
    prepaidAmount: text(monetary, 'PrepaidAmount') ?? '0.00',
    payableRoundingAmount: text(monetary, 'PayableRoundingAmount') ?? '0.00',
    payableAmount: text(monetary, 'PayableAmount') ?? '',
    taxAmount: text(documentTax, 'TaxAmount') ?? '',
    ...opt('taxAmountInAccountingCurrency', accountingTax === undefined ? undefined : text(accountingTax, 'TaxAmount')),
  };

  const taxRep = optionalNode(root, 'TaxRepresentativeParty');
  const taxRepVat = taxRep === undefined ? undefined : vatCompanyId((taxRep['PartyTaxScheme'] ?? []) as Node[]);
  const delivery = optionalNode(root, 'Delivery');
  const deliveryCountry = delivery === undefined ? undefined : textPath(optionalNode(optionalNode(delivery, 'DeliveryLocation') ?? {}, 'Address') ?? {}, 'Country', 'IdentificationCode');
  const deliveryDate = delivery === undefined ? undefined : text(delivery, 'ActualDeliveryDate');
  const period = optionalNode(root, 'InvoicePeriod');

  return {
    number: text(root, 'ID') ?? '',
    issueDate: text(root, 'IssueDate') ?? '',
    ...opt('dueDate', dueDate),
    typeCode: typeCode as InvoiceTypeCode,
    currency,
    ...opt('vatAccountingCurrency', vatAccountingCurrency),
    ...opt('vatPointDate', text(root, 'TaxPointDate')),
    ...opt('buyerReference', text(root, 'BuyerReference')),
    ...opt('purchaseOrderReference', textPath(root, 'OrderReference', 'ID')),
    ...opt('contractReference', textPath(root, 'ContractDocumentReference', 'ID')),
    ...opt('note', text(root, 'Note')),
    ...opt('taxRepresentativeVatId', taxRepVat),
    ...(deliveryDate !== undefined || deliveryCountry !== undefined
      ? { delivery: { ...opt('date', deliveryDate), ...opt('countryCode', deliveryCountry) } }
      : {}),
    ...(period === undefined
      ? {}
      : { invoicePeriod: { ...opt('startDate', text(period, 'StartDate')), ...opt('endDate', text(period, 'EndDate')), ...opt('descriptionCode', text(period, 'DescriptionCode')) } }),
    seller: parseParty(supplier),
    buyer: parseParty(customer),
    ...(paymentMeans === undefined ? {} : { payment: parsePayment(paymentMeans) }),
    ...(allMeans.length > 1 ? { furtherPayments: allMeans.slice(1).map(parsePayment) } : {}),
    ...opt('paymentTerms', textPath(root, 'PaymentTerms', 'Note')),
    ...(allowances.length > 0 ? { allowances } : {}),
    ...(charges.length > 0 ? { charges } : {}),
    lines: lineNodes.map((n) => parseLine(n, isCreditNote)),
    vatBreakdown: ((documentTax['TaxSubtotal'] ?? []) as Node[]).map(parseSubtotal),
    totals,
  };
}

/**
 * ChargeIndicator is an xs:boolean, whose lexical space is true, false, 1
 * and 0. Matching only the first two silently dropped any allowance written
 * as "0" -- found by running the EN 16931 validation artefacts' own example
 * invoices through this parser, one of which does exactly that.
 */
function indicator(n: Node): boolean | undefined {
  const value = text(n, 'ChargeIndicator');
  if (value === undefined) return undefined; // neither an allowance nor a charge, as in the standard's own sums
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new UblParseError(`AllowanceCharge has a ChargeIndicator of ${value === undefined ? 'nothing' : `"${value}"`}, which is not an xs:boolean.`);
}

/**
 * BG-23, BT-95, BT-102 and BT-151 are VAT categories, and the standard's
 * rules find them with `TaxScheme/ID = 'VAT'`. A category under any other
 * scheme, or with no scheme, is not one, and the rules report it as missing.
 * The same filter applies to the rate that sits beside it.
 */
function vatCategory(node: Node | undefined): { id: string; rate: string | undefined; node: Node } {
  const n = node ?? {};
  const isVat = normalized(textPath(n, 'TaxScheme', 'ID')) === 'VAT';
  return { id: isVat ? (text(n, 'ID') ?? '') : '', rate: isVat ? text(n, 'Percent') : undefined, node: n };
}

function vatCompanyId(schemes: Node[]): string | undefined {
  const vat = schemes.find((s) => normalized(textPath(s, 'TaxScheme', 'ID')) === 'VAT');
  return vat === undefined ? undefined : text(vat, 'CompanyID');
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function parseParty(party: Node): Party {
  const address = optionalNode(party, 'PostalAddress') ?? {};
  const legal = optionalNode(party, 'PartyLegalEntity');
  const schemes = (party['PartyTaxScheme'] ?? []) as Node[];
  const tax = schemes.find((s) => normalized(textPath(s, 'TaxScheme', 'ID')) === 'TAX');
  const endpoint = party['EndpointID'] as Node | string | undefined;
  const contact = optionalNode(party, 'Contact');

  return {
    // BR-06 / BR-07 ask for the registered name. Falling back to the trading name
    // here would let a document without one pass.
    name: (legal === undefined ? undefined : text(legal, 'RegistrationName')) ?? '',
    ...opt('tradingName', textPath(party, 'PartyName', 'Name')),
    ...opt('legalRegistrationId', legal === undefined ? undefined : text(legal, 'CompanyID')),
    ...opt('vatId', vatCompanyId(schemes)),
    ...opt('taxRegistrationId', tax === undefined ? undefined : text(tax, 'CompanyID')),
    ...(endpoint !== undefined && typeof endpoint === 'object'
      ? { electronicAddress: { scheme: String(endpoint['@schemeID']) as ElectronicAddressScheme, value: String(endpoint['#text']) } }
      : {}),
    address: {
      ...opt('street', text(address, 'StreetName')),
      ...opt('additionalStreet', text(address, 'AdditionalStreetName')),
      ...opt('city', text(address, 'CityName')),
      ...opt('postalCode', text(address, 'PostalZone')),
      ...opt('countrySubdivision', text(address, 'CountrySubentity')),
      countryCode: textPath(address, 'Country', 'IdentificationCode') ?? '',
    },
    ...(contact === undefined
      ? {}
      : {
          contact: {
            ...opt('name', text(contact, 'Name')),
            ...opt('telephone', text(contact, 'Telephone')),
            ...opt('email', text(contact, 'ElectronicMail')),
          },
        }),
  };
}

function parsePayment(means: Node): NonNullable<Invoice['payment']> {
  const code = means['PaymentMeansCode'] as Node | string | undefined;
  // An empty <PayeeFinancialAccount/> still exists as far as BR-50 is concerned.
  const account = optionalNode(means, 'PayeeFinancialAccount') ?? (means['PayeeFinancialAccount'] === undefined ? undefined : {});
  return {
    meansCode: (code === undefined ? '' : typeof code === 'object' ? String(code['#text']) : String(code)) as NonNullable<Invoice['payment']>['meansCode'],
    ...opt('meansText', typeof code === 'object' ? asString(code['@name']) : undefined),
    ...opt('remittanceInformation', text(means, 'PaymentID')),
    ...(account === undefined
      ? {}
      : {
          creditTransfer: {
            accountId: text(account, 'ID') ?? '',
            ...opt('accountName', text(account, 'Name')),
            ...opt('serviceProviderId', textPath(account, 'FinancialInstitutionBranch', 'ID')),
          },
        }),
  };
}

function parseAllowanceCharge(n: Node): AllowanceCharge {
  const category = vatCategory(optionalNode(n, 'TaxCategory'));
  return {
    amount: text(n, 'Amount') ?? '',
    ...opt('reason', text(n, 'AllowanceChargeReason')),
    ...opt('reasonCode', text(n, 'AllowanceChargeReasonCode')),
    ...opt('percentage', text(n, 'MultiplierFactorNumeric')),
    ...opt('baseAmount', text(n, 'BaseAmount')),
    // A document-level allowance without a TaxCategory used to be read as
    // "S". An absent category is a fact about the document, not a default.
    vatCategory: category.id as VatCategory,
    ...opt('vatRate', category.rate),
  };
}

function parseSubtotal(n: Node): VatBreakdownEntry {
  const category = vatCategory(optionalNode(n, 'TaxCategory'));
  return {
    category: category.id as VatCategory,
    ...opt('rate', category.rate),
    taxableAmount: text(n, 'TaxableAmount') ?? '',
    taxAmount: text(n, 'TaxAmount') ?? '',
    ...opt('exemptionReason', text(category.node, 'TaxExemptionReason')),
    ...opt('exemptionReasonCode', text(category.node, 'TaxExemptionReasonCode')),
  };
}

function parseLine(n: Node, isCreditNote: boolean): Line {
  const quantityNode = n[isCreditNote ? 'CreditedQuantity' : 'InvoicedQuantity'] as Node | string | undefined;
  const item = optionalNode(n, 'Item') ?? {};
  const category = vatCategory(optionalNode(item, 'ClassifiedTaxCategory'));
  const price = optionalNode(n, 'Price') ?? {};
  const base = price['BaseQuantity'] as Node | string | undefined;
  const lineAcs = (n['AllowanceCharge'] ?? []) as Node[];
  const lineAllowances = lineAcs.filter((ac) => indicator(ac) === false).map(parseLineAllowanceCharge);
  const lineCharges = lineAcs.filter((ac) => indicator(ac) === true).map(parseLineAllowanceCharge);

  return {
    id: text(n, 'ID') ?? '',
    ...opt('note', text(n, 'Note')),
    quantity: typeof quantityNode === 'object' ? (asString(quantityNode['#text']) ?? '') : (asString(quantityNode) ?? ''),
    unitCode: typeof quantityNode === 'object' ? (asString(quantityNode['@unitCode']) ?? '') : '',
    netAmount: text(n, 'LineExtensionAmount') ?? '',
    netPrice: text(price, 'PriceAmount') ?? '',
    ...opt('priceBaseQuantity', typeof base === 'object' ? String(base['#text']) : base === undefined ? undefined : String(base)),
    itemName: text(item, 'Name') ?? '',
    ...opt('itemDescription', text(item, 'Description')),
    ...opt('sellerItemId', textPath(item, 'SellersItemIdentification', 'ID')),
    vatCategory: category.id as VatCategory,
    ...opt('vatRate', category.rate),
    ...opt('orderLineReference', textPath(n, 'OrderLineReference', 'LineID')),
    ...(lineAllowances.length > 0 ? { allowances: lineAllowances } : {}),
    ...(lineCharges.length > 0 ? { charges: lineCharges } : {}),
  };
}

function parseLineAllowanceCharge(n: Node): Omit<AllowanceCharge, 'vatCategory' | 'vatRate'> {
  return {
    amount: text(n, 'Amount') ?? '',
    ...opt('reason', text(n, 'AllowanceChargeReason')),
    ...opt('reasonCode', text(n, 'AllowanceChargeReasonCode')),
    ...opt('percentage', text(n, 'MultiplierFactorNumeric')),
    ...opt('baseAmount', text(n, 'BaseAmount')),
  };
}

// --- node helpers ----------------------------------------------------------

function optionalNode(parent: Node, name: string): Node | undefined {
  const child = parent[name];
  return child !== undefined && typeof child === 'object' && !Array.isArray(child) ? (child as Node) : undefined;
}

/** The value of an attribute on a child element, e.g. the currencyID of a TaxAmount. */
function attribute(parent: Node, child: string, name: string): string | undefined {
  const value = parent[child];
  return typeof value === 'object' && value !== null ? asString((value as Node)[`@${name}`]) : undefined;
}

/** Text of a simple element, or of an element with attributes (which fast-xml-parser wraps). */
function text(parent: Node, name: string): string | undefined {
  const value = parent[name];
  if (value === undefined) return undefined;
  if (typeof value === 'object' && value !== null) return asString((value as Node)['#text']);
  return asString(value);
}

function textPath(parent: Node, child: string, name: string): string | undefined {
  const c = optionalNode(parent, child);
  return c === undefined ? undefined : text(c, name);
}

function asString(value: unknown): string | undefined {
  // Only primitives. An object here means an element with children where a
  // text value was expected, and "[object Object]" is not a useful amount.
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function opt<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}
