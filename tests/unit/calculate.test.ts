import { describe, expect, it } from 'vitest';

import { calculate, calculateLine } from '../../src/calculate/totals.js';
import { domesticInvoice, reverseChargeInvoice } from '../fixtures/invoices.js';

/**
 * Expected values here were worked by hand from the fixture, then checked
 * against the arithmetic in EN 16931. They are not copied from the output of
 * the code under test.
 *
 *   Line 1: 10 × 120.00           = 1200.00  (S 19%)
 *   Line 2: 3 × 0.3333 = 0.9999   → 1.00     (S 19%)  -- rounded once, not per unit
 *   Line 3: 2 × 24.50             = 49.00    (S 7%)
 *   Sum of lines                  = 1250.00
 *   Allowance                     =   50.00  (S 19%)
 *   Tax exclusive                 = 1200.00
 *
 *   S 19% taxable: 1200.00 + 1.00 − 50.00 = 1151.00 → VAT 218.69
 *   S 7%  taxable: 49.00                             → VAT   3.43
 *   Total VAT                                        = 222.12
 *   Tax inclusive = 1200.00 + 222.12                 = 1422.12
 */
describe('calculate: domestic invoice', () => {
  const invoice = calculate(domesticInvoice);

  it('rounds each line net once, after multiplying', () => {
    expect(invoice.lines.map((line) => line.netAmount)).toEqual(['1200.00', '1.00', '49.00']);
  });

  it('sums line nets to BT-106', () => {
    expect(invoice.totals.lineExtensionAmount).toBe('1250.00');
  });

  it('subtracts the document allowance to reach BT-109', () => {
    expect(invoice.totals.allowanceTotalAmount).toBe('50.00');
    expect(invoice.totals.taxExclusiveAmount).toBe('1200.00');
  });

  it('produces one VAT breakdown entry per category and rate, in a stable order', () => {
    expect(invoice.vatBreakdown).toEqual([
      { category: 'S', rate: '7', taxableAmount: '49.00', taxAmount: '3.43' },
      { category: 'S', rate: '19', taxableAmount: '1151.00', taxAmount: '218.69' },
    ]);
  });

  it('applies the document allowance to its own VAT group, not pro rata', () => {
    const nineteen = invoice.vatBreakdown.find((entry) => entry.rate === '19');
    expect(nineteen?.taxableAmount).toBe('1151.00');
  });

  it('sums VAT per group into BT-110', () => {
    expect(invoice.totals.taxAmount).toBe('222.12');
  });

  it('reaches BT-112 and BT-115', () => {
    expect(invoice.totals.taxInclusiveAmount).toBe('1422.12');
    expect(invoice.totals.payableAmount).toBe('1422.12');
  });
});

describe('calculateLine', () => {
  it('does not round the unit price before multiplying', () => {
    // 3 × 0.3333 = 0.9999 → 1.00. Rounding the price first would give 3 × 0.33 = 0.99.
    expect(calculateLine({ id: '1', quantity: '3', unitCode: 'C62', netPrice: '0.3333', itemName: 'x', vatCategory: 'S', vatRate: '19' }).netAmount).toBe('1.00');
  });

  it('divides by the price base quantity', () => {
    // Priced per 100 units at 250.00; 30 units → 75.00
    expect(calculateLine({ id: '1', quantity: '30', unitCode: 'C62', netPrice: '250.00', priceBaseQuantity: '100', itemName: 'x', vatCategory: 'S', vatRate: '19' }).netAmount).toBe('75.00');
  });

  it('applies line allowances and charges', () => {
    expect(
      calculateLine({
        id: '1', quantity: '2', unitCode: 'C62', netPrice: '100.00', itemName: 'x', vatCategory: 'S', vatRate: '19',
        allowances: [{ amount: '10.00', reason: 'promo' }],
        charges: [{ amount: '2.50', reason: 'handling' }],
      }).netAmount,
    ).toBe('192.50');
  });

  it('rounds half up', () => {
    expect(calculateLine({ id: '1', quantity: '1', unitCode: 'C62', netPrice: '10.005', itemName: 'x', vatCategory: 'S', vatRate: '19' }).netAmount).toBe('10.01');
  });

  it('rejects a zero base quantity rather than dividing by it', () => {
    expect(() => calculateLine({ id: '1', quantity: '1', unitCode: 'C62', netPrice: '10', priceBaseQuantity: '0', itemName: 'x', vatCategory: 'S', vatRate: '19' })).toThrow(RangeError);
  });

  it('never goes through a float', () => {
    // 0.1 + 0.2 in IEEE 754 is 0.30000000000000004. Three lines at 0.10, 0.20 and 0.70.
    const invoice = calculate({
      ...domesticInvoice,
      allowances: undefined,
      lines: [
        { id: '1', quantity: '1', unitCode: 'C62', netPrice: '0.10', itemName: 'a', vatCategory: 'S', vatRate: '19' },
        { id: '2', quantity: '1', unitCode: 'C62', netPrice: '0.20', itemName: 'b', vatCategory: 'S', vatRate: '19' },
        { id: '3', quantity: '1', unitCode: 'C62', netPrice: '0.70', itemName: 'c', vatCategory: 'S', vatRate: '19' },
      ],
    });
    expect(invoice.totals.lineExtensionAmount).toBe('1.00');
    expect(invoice.vatBreakdown[0]?.taxAmount).toBe('0.19');
  });
});

describe('calculate: reverse charge', () => {
  const invoice = calculate(reverseChargeInvoice);

  it('carries zero tax for category AE', () => {
    expect(invoice.vatBreakdown).toEqual([
      { category: 'AE', rate: '0', taxableAmount: '5000.00', taxAmount: '0.00', exemptionReason: 'Reverse charge', exemptionReasonCode: 'VATEX-EU-AE' },
    ]);
    expect(invoice.totals.taxAmount).toBe('0.00');
    expect(invoice.totals.payableAmount).toBe('5000.00');
  });
});

describe('calculate: rounding and prepayment', () => {
  it('applies BT-114 rounding to BT-112 and BT-113 prepaid to BT-115', () => {
    const invoice = calculate({ ...reverseChargeInvoice, roundingAmount: '-0.12', prepaidAmount: '1000.00' });
    expect(invoice.totals.taxInclusiveAmount).toBe('4999.88');
    expect(invoice.totals.payableAmount).toBe('3999.88');
  });
});

describe('calculate: VAT per group, not on the grand total', () => {
  /**
   * The case that separates a correct implementation from a plausible one.
   * Three lines at 19% of 0.33 each: per-group VAT is 0.99 × 0.19 = 0.1881 →
   * 0.19. Computing per line and summing would give 3 × 0.06 = 0.18 -- and
   * the recipient's validator computes per group.
   */
  it('computes VAT on the rounded group taxable amount', () => {
    const invoice = calculate({
      ...reverseChargeInvoice,
      lines: ['1', '2', '3'].map((id) => ({ id, quantity: '1', unitCode: 'C62', netPrice: '0.33', itemName: 'x', vatCategory: 'S' as const, vatRate: '19' })),
    });
    expect(invoice.vatBreakdown[0]?.taxableAmount).toBe('0.99');
    expect(invoice.vatBreakdown[0]?.taxAmount).toBe('0.19');
  });
});
