import { z } from 'zod';

import {
  COUNTRY_CODE_PATTERN,
  CURRENCY_CODE_PATTERN,
  ELECTRONIC_ADDRESS_SCHEMES,
  INVOICE_TYPE_CODES,
  PAYMENT_MEANS_CODES,
  VAT_CATEGORIES,
} from './codes.js';

/**
 * The invoice model, following the EN 16931 semantic model. Field comments
 * carry the business term (BT-n) or group (BG-n) identifier from the
 * standard, because that is how every validation message, every access
 * point rejection and every national CIUS refers to them. A developer
 * holding a rejection that says "BT-131" should be able to grep for it here.
 *
 * Amounts are decimal strings at this boundary -- "19.99", never 19.99 --
 * so a JSON payload cannot smuggle a float in. They are converted to exact
 * decimals on the way in and never touch a number.
 */

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string such as "19.99"');

const nonNegativeDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string such as "19.99"');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, YYYY-MM-DD');

const vatCategory = z.enum(Object.keys(VAT_CATEGORIES) as [keyof typeof VAT_CATEGORIES, ...Array<keyof typeof VAT_CATEGORIES>]);
const invoiceTypeCode = z.enum(Object.keys(INVOICE_TYPE_CODES) as [keyof typeof INVOICE_TYPE_CODES, ...Array<keyof typeof INVOICE_TYPE_CODES>]);
const paymentMeansCode = z.enum(Object.keys(PAYMENT_MEANS_CODES) as [keyof typeof PAYMENT_MEANS_CODES, ...Array<keyof typeof PAYMENT_MEANS_CODES>]);
const electronicAddressScheme = z.enum(
  Object.keys(ELECTRONIC_ADDRESS_SCHEMES) as [keyof typeof ELECTRONIC_ADDRESS_SCHEMES, ...Array<keyof typeof ELECTRONIC_ADDRESS_SCHEMES>],
);

/** BG-5 / BG-8: postal address. */
export const addressSchema = z.object({
  /** BT-35 / BT-50 */
  street: z.string().min(1).optional(),
  /** BT-36 / BT-51 */
  additionalStreet: z.string().min(1).optional(),
  /** BT-37 / BT-52 */
  city: z.string().min(1).optional(),
  /** BT-38 / BT-53 */
  postalCode: z.string().min(1).optional(),
  /** BT-39 / BT-54 */
  countrySubdivision: z.string().min(1).optional(),
  /** BT-40 / BT-55: ISO 3166-1 alpha-2. Mandatory (BR-09, BR-11). */
  countryCode: z.string().regex(COUNTRY_CODE_PATTERN, 'ISO 3166-1 alpha-2 country code'),
});

/** BT-34 / BT-49: Peppol electronic address with its scheme. */
export const electronicAddressSchema = z.object({
  scheme: electronicAddressScheme,
  value: z.string().min(1),
});

/** BG-4 Seller / BG-7 Buyer share a shape. */
export const partySchema = z.object({
  /** BT-27 / BT-44: registered name. Mandatory (BR-06, BR-08). */
  name: z.string().min(1),
  /** BT-28 / BT-45: trading name, if different. */
  tradingName: z.string().min(1).optional(),
  /** BT-30 / BT-47: legal registration identifier. */
  legalRegistrationId: z.string().min(1).optional(),
  /** BT-31 / BT-48: VAT identifier, with country prefix, e.g. "DE123456789". */
  vatId: z.string().min(3).optional(),
  /** BT-32: seller tax registration identifier (non-VAT). */
  taxRegistrationId: z.string().min(1).optional(),
  /** BT-34 / BT-49: electronic address. Peppol requires both (PEPPOL-EN16931-R020/R010). */
  electronicAddress: electronicAddressSchema.optional(),
  /** BG-5 / BG-8 */
  address: addressSchema,
  /** BG-6 / BG-9: contact. */
  contact: z
    .object({
      name: z.string().min(1).optional(),
      telephone: z.string().min(1).optional(),
      email: z.string().min(3).optional(),
    })
    .optional(),
});

/** BG-20 document allowance / BG-21 document charge, and their line-level equivalents. */
export const allowanceChargeSchema = z.object({
  /** BT-92/BT-99: amount, excluding VAT. */
  amount: nonNegativeDecimalString,
  /** BT-97/BT-104: reason text. One of reason or reasonCode is required (BR-33, BR-38). */
  reason: z.string().min(1).optional(),
  /** BT-98/BT-105: UNTDID 5189 / 7161 reason code. */
  reasonCode: z.string().min(1).optional(),
  /** BT-95/BT-102: VAT category of the allowance or charge. Required at document level. */
  vatCategory: vatCategory,
  /** BT-96/BT-103: VAT rate. */
  vatRate: nonNegativeDecimalString.optional(),
  /** BT-93/BT-100: base amount the percentage applied to, informational. */
  baseAmount: nonNegativeDecimalString.optional(),
  /** BT-94/BT-101: percentage, informational. */
  percentage: nonNegativeDecimalString.optional(),
});

/** BG-25 invoice line. */
export const lineInputSchema = z.object({
  /** BT-126: line identifier, unique within the invoice (BR-21, BR-CO-04 uniqueness handled in rules). */
  id: z.string().min(1),
  /** BT-127: note. */
  note: z.string().min(1).optional(),
  /** BT-129: invoiced quantity. May be negative on a credit-style line. */
  quantity: decimalString,
  /** BT-130: UN/ECE Rec 20 unit code. */
  unitCode: z.string().min(1),
  /** BT-146: item net price, per BT-149 base quantity. Must be non-negative (BR-27). */
  netPrice: nonNegativeDecimalString,
  /** BT-149: price base quantity. Defaults to 1. */
  priceBaseQuantity: nonNegativeDecimalString.optional(),
  /** BT-153: item name. Mandatory (BR-25). */
  itemName: z.string().min(1),
  /** BT-154: item description. */
  itemDescription: z.string().min(1).optional(),
  /** BT-155: seller's item identifier. */
  sellerItemId: z.string().min(1).optional(),
  /** BT-151: VAT category. Mandatory (BR-CO-04). */
  vatCategory: vatCategory,
  /** BT-152: VAT rate as a percentage, e.g. "19" or "20.5". Required for S; must be 0 for zero-rate categories. */
  vatRate: nonNegativeDecimalString.optional(),
  /** BG-27 / BG-28: line-level allowances and charges. */
  allowances: z.array(allowanceChargeSchema.omit({ vatCategory: true, vatRate: true })).optional(),
  charges: z.array(allowanceChargeSchema.omit({ vatCategory: true, vatRate: true })).optional(),
  /** BT-132: referenced purchase order line. */
  orderLineReference: z.string().min(1).optional(),
});

/**
 * What the caller provides. Totals and the VAT breakdown are deliberately
 * absent: they are derived by calculate(), because an invoice whose totals
 * were typed in by hand is an invoice whose totals are wrong often enough
 * that the standard has fourteen rules about it.
 */
export const invoiceInputSchema = z.object({
  /** BT-1: invoice number. Mandatory (BR-02). */
  number: z.string().min(1),
  /** BT-2: issue date. Mandatory (BR-03). */
  issueDate: isoDate,
  /** BT-9: payment due date. */
  dueDate: isoDate.optional(),
  /** BT-3: type code. Mandatory (BR-04). */
  typeCode: invoiceTypeCode.default('380'),
  /** BT-5: invoice currency. Mandatory (BR-05). */
  currency: z.string().regex(CURRENCY_CODE_PATTERN, 'ISO 4217 currency code'),
  /** BT-6: VAT accounting currency, if different from BT-5. */
  vatAccountingCurrency: z.string().regex(CURRENCY_CODE_PATTERN).optional(),
  /** BT-7: VAT point date. */
  vatPointDate: isoDate.optional(),
  /** BT-10: buyer reference. Peppol requires BT-10 or BT-13 (PEPPOL-EN16931-R003). */
  buyerReference: z.string().min(1).optional(),
  /** BT-13: purchase order reference. */
  purchaseOrderReference: z.string().min(1).optional(),
  /** BT-12: contract reference. */
  contractReference: z.string().min(1).optional(),
  /** BT-22: invoice note. */
  note: z.string().min(1).optional(),
  /** BG-3: preceding invoice references, required for credit notes in some CIUS. */
  precedingInvoiceReferences: z.array(z.object({ number: z.string().min(1), issueDate: isoDate.optional() })).optional(),
  /** BG-4 */
  seller: partySchema,
  /** BG-7 */
  buyer: partySchema,
  /** BG-10: payee, if different from seller. */
  payee: z.object({ name: z.string().min(1), legalRegistrationId: z.string().min(1).optional() }).optional(),
  /** BG-16: payment instructions. */
  payment: z
    .object({
      /** BT-81 */
      meansCode: paymentMeansCode,
      /** BT-82 */
      meansText: z.string().min(1).optional(),
      /** BT-83: remittance information. */
      remittanceInformation: z.string().min(1).optional(),
      /** BG-17: credit transfer account. */
      creditTransfer: z
        .object({
          /** BT-84 */
          accountId: z.string().min(1),
          /** BT-85 */
          accountName: z.string().min(1).optional(),
          /** BT-86 */
          serviceProviderId: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
  /** BT-20: payment terms text. */
  paymentTerms: z.string().min(1).optional(),
  /** BT-113: paid amount, subtracted to reach BT-115 amount due. */
  prepaidAmount: nonNegativeDecimalString.optional(),
  /** BT-114: rounding amount applied to reach BT-112. */
  roundingAmount: decimalString.optional(),
  /**
   * BT-120 / BT-121 per VAT category. The breakdown is derived, so the
   * exemption reason for a category has to come from the input; a reverse
   * charge invoice without "VATEX-EU-AE" or equivalent text fails BR-AE-10.
   */
  vatExemptionReasons: z
    .record(vatCategory, z.object({ reason: z.string().min(1).optional(), code: z.string().min(1).optional() }))
    .optional(),
  /** BG-20 */
  allowances: z.array(allowanceChargeSchema).optional(),
  /** BG-21 */
  charges: z.array(allowanceChargeSchema).optional(),
  /** BG-25 */
  lines: z.array(lineInputSchema).min(1, 'at least one invoice line is required (BR-16)'),
});

export type Address = z.infer<typeof addressSchema>;
export type Party = z.infer<typeof partySchema>;
export type AllowanceCharge = z.infer<typeof allowanceChargeSchema>;
export type LineInput = z.infer<typeof lineInputSchema>;
/** What a caller passes in: defaulted fields such as typeCode may be omitted. */
export type InvoiceInput = z.input<typeof invoiceInputSchema>;
/** The same after parsing: defaults applied. */
type InvoiceData = z.output<typeof invoiceInputSchema>;

/** A calculated line: the input plus its derived net amount (BT-131). */
export interface Line extends LineInput {
  /** BT-131: line net amount = quantity × (price / base quantity) − allowances + charges, rounded. */
  readonly netAmount: string;
}

/** BG-23: one VAT breakdown entry per (category, rate). */
export interface VatBreakdownEntry {
  /** BT-118 */
  readonly category: keyof typeof VAT_CATEGORIES;
  /** BT-119: absent for O; zero for Z/E/AE/K/G. */
  readonly rate?: string;
  /** BT-116 */
  readonly taxableAmount: string;
  /** BT-117 */
  readonly taxAmount: string;
  /** BT-120 */
  readonly exemptionReason?: string;
  /** BT-121 */
  readonly exemptionReasonCode?: string;
}

/** BG-22: document totals. */
export interface Totals {
  /** BT-106 */
  readonly lineExtensionAmount: string;
  /** BT-107 */
  readonly allowanceTotalAmount: string;
  /** BT-108 */
  readonly chargeTotalAmount: string;
  /** BT-109 */
  readonly taxExclusiveAmount: string;
  /** BT-110 */
  readonly taxAmount: string;
  /** BT-112 */
  readonly taxInclusiveAmount: string;
  /** BT-113 */
  readonly prepaidAmount: string;
  /** BT-114 */
  readonly payableRoundingAmount: string;
  /** BT-115 */
  readonly payableAmount: string;
}

/**
 * A complete invoice: input plus everything derived from it. This is what
 * gets validated and serialised, and what parsing a document produces.
 */
export interface Invoice extends Omit<InvoiceData, 'lines'> {
  readonly lines: readonly Line[];
  readonly vatBreakdown: readonly VatBreakdownEntry[];
  readonly totals: Totals;
}
