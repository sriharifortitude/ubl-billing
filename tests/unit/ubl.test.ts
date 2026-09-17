import { describe, expect, it } from 'vitest';

import { calculate } from '../../src/calculate/totals.js';
import { PEPPOL_CUSTOMIZATION_ID, PEPPOL_PROFILE_ID } from '../../src/model/codes.js';
import { validate } from '../../src/rules/index.js';
import { fromUbl, UblParseError } from '../../src/ubl/parse.js';
import { toUbl } from '../../src/ubl/serialize.js';
import { domesticInvoice, reverseChargeInvoice } from '../fixtures/invoices.js';

describe('toUbl', () => {
  const xml = toUbl(calculate(domesticInvoice), { pretty: true });

  it('declares the UBL 2.1 Invoice namespace and the Peppol identifiers', () => {
    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(xml).toContain(`<cbc:CustomizationID>${PEPPOL_CUSTOMIZATION_ID}</cbc:CustomizationID>`);
    expect(xml).toContain(`<cbc:ProfileID>${PEPPOL_PROFILE_ID}</cbc:ProfileID>`);
  });

  it('writes amounts with exactly two decimals and a currency attribute', () => {
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">1422.12</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">1.00</cbc:LineExtensionAmount>');
  });

  it('keeps the price at its given precision, not rounded to two decimals', () => {
    // BT-146 may carry more than two decimals; rounding it here would change
    // the arithmetic the recipient recomputes.
    expect(xml).toContain('<cbc:PriceAmount currencyID="EUR">0.3333</cbc:PriceAmount>');
  });

  /**
   * UBL is schema-validated with xsd sequences. An element out of order is a
   * rejection before any business rule is looked at, so the order is asserted
   * on the elements most often got wrong.
   */
  it('emits elements in schema order', () => {
    const order = ['cbc:CustomizationID', 'cbc:ProfileID', 'cbc:ID>', 'cbc:IssueDate', 'cbc:DueDate', 'cbc:InvoiceTypeCode', 'cbc:DocumentCurrencyCode', 'cbc:BuyerReference', 'cac:AccountingSupplierParty', 'cac:AccountingCustomerParty', 'cac:PaymentMeans', 'cac:PaymentTerms', 'cac:AllowanceCharge', 'cac:TaxTotal', 'cac:LegalMonetaryTotal', 'cac:InvoiceLine'];
    const positions = order.map((element) => xml.indexOf(element));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('escapes text content', () => {
    const invoice = calculate({ ...domesticInvoice, note: 'Terms & conditions <apply>' });
    expect(toUbl(invoice)).toContain('<cbc:Note>Terms &amp; conditions &lt;apply&gt;</cbc:Note>');
  });

  it('writes a credit note with the CreditNote root and element names', () => {
    const xml = toUbl(calculate({ ...domesticInvoice, typeCode: '381', dueDate: undefined }));
    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toContain('<cac:CreditNoteLine>');
    expect(xml).toContain('<cbc:CreditedQuantity');
    expect(xml).not.toContain('InvoiceLine');
  });

  it('places the exemption reason on the tax subtotal', () => {
    const xml = toUbl(calculate(reverseChargeInvoice));
    expect(xml).toContain('<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>');
    expect(xml).toContain('<cbc:TaxExemptionReason>Reverse charge</cbc:TaxExemptionReason>');
  });
});

describe('fromUbl round trip', () => {
  for (const [name, input] of [['domestic', domesticInvoice], ['reverse charge', reverseChargeInvoice]] as const) {
    it(`survives serialise → parse for the ${name} invoice`, () => {
      const original = calculate(input);
      const parsed = fromUbl(toUbl(original));

      expect(parsed.number).toBe(original.number);
      expect(parsed.currency).toBe(original.currency);
      expect(parsed.typeCode).toBe(original.typeCode);
      expect(parsed.seller.name).toBe(original.seller.name);
      expect(parsed.seller.vatId).toBe(original.seller.vatId);
      expect(parsed.seller.electronicAddress).toEqual(original.seller.electronicAddress);
      expect(parsed.buyer.address.countryCode).toBe(original.buyer.address.countryCode);
      expect(parsed.totals).toEqual(original.totals);
      expect(parsed.vatBreakdown).toEqual(original.vatBreakdown);
      expect(parsed.lines.map((line) => [line.id, line.netAmount, line.vatCategory])).toEqual(
        original.lines.map((line) => [line.id, line.netAmount, line.vatCategory]),
      );
    });

    it(`the parsed ${name} invoice still passes every rule`, () => {
      expect(validate(fromUbl(toUbl(calculate(input))))).toEqual([]);
    });
  }

  it('parses a credit note', () => {
    const parsed = fromUbl(toUbl(calculate({ ...domesticInvoice, typeCode: '381', dueDate: undefined })));
    expect(parsed.typeCode).toBe('381');
    expect(parsed.lines).toHaveLength(3);
  });

  it('keeps amounts as strings rather than coercing them to numbers', () => {
    const parsed = fromUbl(toUbl(calculate(domesticInvoice)));
    expect(typeof parsed.totals.payableAmount).toBe('string');
    expect(parsed.totals.payableAmount).toBe('1422.12');
  });

  /**
   * Parsing does not repair. A document whose totals are wrong is returned
   * with its wrong totals, and it is validate() that says so.
   */
  it('reports, rather than corrects, a document with inconsistent totals', () => {
    const xml = toUbl(calculate(domesticInvoice)).replace('<cbc:PayableAmount currencyID="EUR">1422.12', '<cbc:PayableAmount currencyID="EUR">1500.00');
    const parsed = fromUbl(xml);
    expect(parsed.totals.payableAmount).toBe('1500.00');
    expect(validate(parsed).map((v) => v.rule)).toContain('BR-CO-16');
  });

  it('rejects a document that is not an invoice', () => {
    expect(() => fromUbl('<?xml version="1.0"?><Order xmlns="urn:x"><ID>1</ID></Order>')).toThrow(UblParseError);
  });

  it('names the missing element when a required one is absent', () => {
    const xml = toUbl(calculate(domesticInvoice)).replace(/<cac:LegalMonetaryTotal>[\s\S]*?<\/cac:LegalMonetaryTotal>/, '');
    expect(() => fromUbl(xml)).toThrow(/LegalMonetaryTotal/);
  });
});
