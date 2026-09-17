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
    ['InvoiceLine', 'CreditNoteLine', 'TaxSubtotal', 'AllowanceCharge', 'PartyTaxScheme', 'BillingReference'].includes(name),
});

export function fromUbl(xml: string): Invoice {
  const parsed = parser.parse(xml) as Node;
  const root = (parsed['Invoice'] ?? parsed['CreditNote']) as Node | undefined;
  if (root === undefined) throw new UblParseError('Document root is neither Invoice nor CreditNote.');
  const isCreditNote = parsed['CreditNote'] !== undefined;

  const typeCode = text(root, isCreditNote ? 'CreditNoteTypeCode' : 'InvoiceTypeCode') ?? (isCreditNote ? '381' : '380');
  const currency = required(root, 'DocumentCurrencyCode');

  const supplier = node(node(root, 'AccountingSupplierParty'), 'Party');
  const customer = node(node(root, 'AccountingCustomerParty'), 'Party');

  const taxTotal = node(root, 'TaxTotal');
  const monetary = node(root, 'LegalMonetaryTotal');
  const lineNodes = (root[isCreditNote ? 'CreditNoteLine' : 'InvoiceLine'] ?? []) as Node[];

  const allowanceCharges = (root['AllowanceCharge'] ?? []) as Node[];
  const allowances = allowanceCharges.filter((n) => text(n, 'ChargeIndicator') === 'false').map(parseAllowanceCharge);
  const charges = allowanceCharges.filter((n) => text(n, 'ChargeIndicator') === 'true').map(parseAllowanceCharge);

  const paymentMeans = optionalNode(root, 'PaymentMeans');
  const dueDate = text(root, 'DueDate') ?? (paymentMeans === undefined ? undefined : text(paymentMeans, 'PaymentDueDate'));

  const totals: Totals = {
    lineExtensionAmount: required(monetary, 'LineExtensionAmount'),
    taxExclusiveAmount: required(monetary, 'TaxExclusiveAmount'),
    taxInclusiveAmount: required(monetary, 'TaxInclusiveAmount'),
    allowanceTotalAmount: text(monetary, 'AllowanceTotalAmount') ?? '0.00',
    chargeTotalAmount: text(monetary, 'ChargeTotalAmount') ?? '0.00',
    prepaidAmount: text(monetary, 'PrepaidAmount') ?? '0.00',
    payableRoundingAmount: text(monetary, 'PayableRoundingAmount') ?? '0.00',
    payableAmount: required(monetary, 'PayableAmount'),
    taxAmount: required(taxTotal, 'TaxAmount'),
  };

  return {
    number: required(root, 'ID'),
    issueDate: required(root, 'IssueDate'),
    ...opt('dueDate', dueDate),
    typeCode: typeCode as InvoiceTypeCode,
    currency,
    ...opt('vatAccountingCurrency', text(root, 'TaxCurrencyCode')),
    ...opt('vatPointDate', text(root, 'TaxPointDate')),
    ...opt('buyerReference', text(root, 'BuyerReference')),
    ...opt('purchaseOrderReference', textPath(root, 'OrderReference', 'ID')),
    ...opt('contractReference', textPath(root, 'ContractDocumentReference', 'ID')),
    ...opt('note', text(root, 'Note')),
    seller: parseParty(supplier),
    buyer: parseParty(customer),
    ...(paymentMeans === undefined ? {} : { payment: parsePayment(paymentMeans) }),
    ...opt('paymentTerms', textPath(root, 'PaymentTerms', 'Note')),
    ...(allowances.length > 0 ? { allowances } : {}),
    ...(charges.length > 0 ? { charges } : {}),
    lines: lineNodes.map((n) => parseLine(n, isCreditNote)),
    vatBreakdown: ((taxTotal['TaxSubtotal'] ?? []) as Node[]).map(parseSubtotal),
    totals,
  };
}

function parseParty(party: Node): Party {
  const address = node(party, 'PostalAddress');
  const legal = optionalNode(party, 'PartyLegalEntity');
  const schemes = (party['PartyTaxScheme'] ?? []) as Node[];
  const vat = schemes.find((s) => textPath(s, 'TaxScheme', 'ID') === 'VAT');
  const tax = schemes.find((s) => textPath(s, 'TaxScheme', 'ID') === 'TAX');
  const endpoint = party['EndpointID'] as Node | string | undefined;
  const contact = optionalNode(party, 'Contact');

  return {
    name: (legal === undefined ? undefined : text(legal, 'RegistrationName')) ?? textPath(party, 'PartyName', 'Name') ?? '',
    ...opt('tradingName', textPath(party, 'PartyName', 'Name')),
    ...opt('legalRegistrationId', legal === undefined ? undefined : text(legal, 'CompanyID')),
    ...opt('vatId', vat === undefined ? undefined : text(vat, 'CompanyID')),
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
  const code = means['PaymentMeansCode'] as Node | string;
  const account = optionalNode(means, 'PayeeFinancialAccount');
  return {
    meansCode: (typeof code === 'object' ? String(code['#text']) : String(code)) as NonNullable<Invoice['payment']>['meansCode'],
    ...opt('meansText', typeof code === 'object' ? asString(code['@name']) : undefined),
    ...opt('remittanceInformation', text(means, 'PaymentID')),
    ...(account === undefined
      ? {}
      : {
          creditTransfer: {
            accountId: required(account, 'ID'),
            ...opt('accountName', text(account, 'Name')),
            ...opt('serviceProviderId', textPath(account, 'FinancialInstitutionBranch', 'ID')),
          },
        }),
  };
}

function parseAllowanceCharge(n: Node): AllowanceCharge {
  const category = optionalNode(n, 'TaxCategory');
  return {
    amount: required(n, 'Amount'),
    ...opt('reason', text(n, 'AllowanceChargeReason')),
    ...opt('reasonCode', text(n, 'AllowanceChargeReasonCode')),
    ...opt('percentage', text(n, 'MultiplierFactorNumeric')),
    ...opt('baseAmount', text(n, 'BaseAmount')),
    vatCategory: (category === undefined ? 'S' : (text(category, 'ID') ?? 'S')) as VatCategory,
    ...opt('vatRate', category === undefined ? undefined : text(category, 'Percent')),
  };
}

function parseSubtotal(n: Node): VatBreakdownEntry {
  const category = node(n, 'TaxCategory');
  return {
    category: required(category, 'ID') as VatCategory,
    ...opt('rate', text(category, 'Percent')),
    taxableAmount: required(n, 'TaxableAmount'),
    taxAmount: required(n, 'TaxAmount'),
    ...opt('exemptionReason', text(category, 'TaxExemptionReason')),
    ...opt('exemptionReasonCode', text(category, 'TaxExemptionReasonCode')),
  };
}

function parseLine(n: Node, isCreditNote: boolean): Line {
  const quantityNode = n[isCreditNote ? 'CreditedQuantity' : 'InvoicedQuantity'] as Node | string | undefined;
  const item = node(n, 'Item');
  const category = node(item, 'ClassifiedTaxCategory');
  const price = node(n, 'Price');
  const base = price['BaseQuantity'] as Node | string | undefined;
  const lineAcs = (n['AllowanceCharge'] ?? []) as Node[];
  const lineAllowances = lineAcs.filter((ac) => text(ac, 'ChargeIndicator') === 'false').map(parseLineAllowanceCharge);
  const lineCharges = lineAcs.filter((ac) => text(ac, 'ChargeIndicator') === 'true').map(parseLineAllowanceCharge);

  return {
    id: required(n, 'ID'),
    ...opt('note', text(n, 'Note')),
    quantity: typeof quantityNode === 'object' ? String(quantityNode['#text']) : String(quantityNode ?? ''),
    unitCode: typeof quantityNode === 'object' ? String(quantityNode['@unitCode']) : '',
    netAmount: required(n, 'LineExtensionAmount'),
    netPrice: required(price, 'PriceAmount'),
    ...opt('priceBaseQuantity', typeof base === 'object' ? String(base['#text']) : base === undefined ? undefined : String(base)),
    itemName: required(item, 'Name'),
    ...opt('itemDescription', text(item, 'Description')),
    ...opt('sellerItemId', textPath(item, 'SellersItemIdentification', 'ID')),
    vatCategory: required(category, 'ID') as VatCategory,
    ...opt('vatRate', text(category, 'Percent')),
    ...opt('orderLineReference', textPath(n, 'OrderLineReference', 'LineID')),
    ...(lineAllowances.length > 0 ? { allowances: lineAllowances } : {}),
    ...(lineCharges.length > 0 ? { charges: lineCharges } : {}),
  };
}

function parseLineAllowanceCharge(n: Node): Omit<AllowanceCharge, 'vatCategory' | 'vatRate'> {
  return {
    amount: required(n, 'Amount'),
    ...opt('reason', text(n, 'AllowanceChargeReason')),
    ...opt('reasonCode', text(n, 'AllowanceChargeReasonCode')),
    ...opt('percentage', text(n, 'MultiplierFactorNumeric')),
    ...opt('baseAmount', text(n, 'BaseAmount')),
  };
}

// --- node helpers ----------------------------------------------------------

function node(parent: Node, name: string): Node {
  const child = parent[name];
  if (child === undefined || typeof child !== 'object') throw new UblParseError(`Missing required element ${name}.`);
  return child as Node;
}

function optionalNode(parent: Node, name: string): Node | undefined {
  const child = parent[name];
  return child !== undefined && typeof child === 'object' ? (child as Node) : undefined;
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

function required(parent: Node, name: string): string {
  const value = text(parent, name);
  if (value === undefined || value === '') throw new UblParseError(`Missing required element ${name}.`);
  return value;
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
