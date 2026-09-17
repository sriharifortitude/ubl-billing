import { describe, expect, it } from 'vitest';

import { calculate } from '../../src/calculate/totals.js';
import type { Invoice } from '../../src/model/invoice.js';
import { isValid, validate } from '../../src/rules/index.js';
import { domesticInvoice, reverseChargeInvoice } from '../fixtures/invoices.js';

function rulesOf(invoice: Invoice): string[] {
  return validate(invoice).map((violation) => violation.rule);
}

describe('a calculated invoice', () => {
  it('passes every rule', () => {
    expect(validate(calculate(domesticInvoice))).toEqual([]);
    expect(validate(calculate(reverseChargeInvoice))).toEqual([]);
  });
});

describe('arithmetic rules catch hand-edited totals', () => {
  const base = calculate(domesticInvoice);

  it('BR-CO-10 when the line sum is wrong', () => {
    expect(rulesOf({ ...base, totals: { ...base.totals, lineExtensionAmount: '1250.01' } })).toContain('BR-CO-10');
  });

  it('BR-CO-14 when the VAT total does not match the breakdown', () => {
    expect(rulesOf({ ...base, totals: { ...base.totals, taxAmount: '222.13' } })).toContain('BR-CO-14');
  });

  it('BR-CO-15 when the gross total is wrong', () => {
    expect(rulesOf({ ...base, totals: { ...base.totals, taxInclusiveAmount: '1422.13' } })).toContain('BR-CO-15');
  });

  it('BR-CO-17 when a breakdown tax amount does not follow from its rate', () => {
    const [seven, nineteen] = base.vatBreakdown;
    expect(rulesOf({ ...base, vatBreakdown: [seven!, { ...nineteen!, taxAmount: '218.70' }] })).toContain('BR-CO-17');
  });

  it('BR-S-08 when a breakdown taxable amount does not match its lines', () => {
    const [seven, nineteen] = base.vatBreakdown;
    expect(rulesOf({ ...base, vatBreakdown: [seven!, { ...nineteen!, taxableAmount: '1152.00' }] })).toContain('BR-S-08');
  });

  it('BR-DEC-23 when a line net has three decimals', () => {
    const [first, ...rest] = base.lines;
    expect(rulesOf({ ...base, lines: [{ ...first!, netAmount: '1200.001' }, ...rest] })).toContain('BR-DEC-23');
  });
});

describe('VAT category rules', () => {
  it('BR-S-05: a standard-rated line needs a rate above zero', () => {
    const invoice = calculate({ ...domesticInvoice, allowances: undefined, lines: [{ ...domesticInvoice.lines[0]!, vatRate: '0' }] });
    expect(rulesOf(invoice)).toContain('BR-S-05');
  });

  it('BR-AE-10: reverse charge needs an exemption reason', () => {
    expect(rulesOf(calculate(reverseChargeInvoice))).not.toContain('BR-AE-10');
    expect(rulesOf(calculate({ ...reverseChargeInvoice, vatExemptionReasons: undefined }))).toContain('BR-AE-10');
  });

  it('BR-AE-02: reverse charge needs both VAT identifiers', () => {
    const invoice = calculate({ ...reverseChargeInvoice, buyer: { ...reverseChargeInvoice.buyer, vatId: undefined } });
    expect(rulesOf(invoice)).toContain('BR-AE-02');
  });

  it('BR-O-11: outside-scope cannot be mixed with other categories', () => {
    const invoice = calculate({
      ...domesticInvoice,
      allowances: undefined,
      lines: [domesticInvoice.lines[0]!, { id: '9', quantity: '1', unitCode: 'C62', netPrice: '10', itemName: 'x', vatCategory: 'O' }],
    });
    expect(rulesOf(invoice)).toContain('BR-O-11');
  });

  it('BR-O-05: an outside-scope line must not carry a rate', () => {
    const invoice = calculate({
      ...domesticInvoice,
      allowances: undefined,
      lines: [{ id: '1', quantity: '1', unitCode: 'C62', netPrice: '10', itemName: 'x', vatCategory: 'O', vatRate: '0' }],
    });
    expect(rulesOf(invoice)).toContain('BR-O-05');
  });
});

describe('Peppol rules', () => {
  it('R003: needs a buyer or order reference', () => {
    expect(rulesOf(calculate({ ...domesticInvoice, buyerReference: undefined }))).toContain('PEPPOL-EN16931-R003');
  });

  it('R010 / R020: both electronic addresses are required', () => {
    const noBuyer = calculate({ ...domesticInvoice, buyer: { ...domesticInvoice.buyer, electronicAddress: undefined } });
    expect(rulesOf(noBuyer)).toContain('PEPPOL-EN16931-R010');
    const noSeller = calculate({ ...domesticInvoice, seller: { ...domesticInvoice.seller, electronicAddress: undefined } });
    expect(rulesOf(noSeller)).toContain('PEPPOL-EN16931-R020');
  });

  it('can be switched off for a plain EN 16931 document', () => {
    const invoice = calculate({ ...domesticInvoice, buyerReference: undefined });
    expect(validate(invoice, { peppol: false }).map((v) => v.rule)).not.toContain('PEPPOL-EN16931-R003');
  });

  it('warns on an intra-community supply where both parties are in the same state', () => {
    const invoice = calculate({ ...domesticInvoice, allowances: undefined, lines: [{ ...domesticInvoice.lines[0]!, vatCategory: 'K', vatRate: '0' }] });
    const warnings = validate(invoice).filter((v) => v.severity === 'warning').map((v) => v.rule);
    expect(warnings).toContain('UBL-BILLING-K-SAME-STATE');
  });
});

describe('structural rules', () => {
  it('BR-21: duplicate line ids', () => {
    const invoice = calculate({ ...domesticInvoice, allowances: undefined, lines: [domesticInvoice.lines[0]!, { ...domesticInvoice.lines[1]!, id: '1' }] });
    expect(rulesOf(invoice)).toContain('BR-21');
  });

  it('BR-CO-25: a positive amount due needs a due date or payment terms', () => {
    expect(rulesOf(calculate({ ...domesticInvoice, dueDate: undefined, paymentTerms: undefined }))).toContain('BR-CO-25');
  });

  it('BR-CO-09: a VAT id needs a country prefix', () => {
    expect(rulesOf(calculate({ ...domesticInvoice, seller: { ...domesticInvoice.seller, vatId: '123456789' } }))).toContain('BR-CO-09');
  });

  it('isValid ignores warnings and fails on fatal', () => {
    expect(isValid(calculate(domesticInvoice))).toBe(true);
    expect(isValid(calculate({ ...domesticInvoice, buyerReference: undefined }))).toBe(false);
  });
});
