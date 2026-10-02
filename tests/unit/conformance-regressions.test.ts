import { describe, expect, it } from 'vitest';

import { calculate } from '../../src/calculate/totals.js';
import { validate } from '../../src/rules/index.js';
import { fromUbl } from '../../src/ubl/parse.js';
import { toUbl } from '../../src/ubl/serialize.js';
import { domesticInvoice, reverseChargeInvoice } from '../fixtures/invoices.js';

/**
 * Each test pins a defect the differential run against the official EN 16931
 * Schematron turned up. They are written against the behaviour the standard
 * has, not against what ubl-billing happened to do.
 */

const rules = (xml: string): string[] => validate(fromUbl(xml)).map((v) => v.rule);
const base = (): string => toUbl(calculate(domesticInvoice));

describe('rounding follows XPath, not half-up', () => {
  it('rounds a negative half towards positive infinity (BR-CO-10)', () => {
    const invoice = calculate(domesticInvoice);
    const lines = [{ ...invoice.lines[0]!, netAmount: '-0.125' }];
    const edited = { ...invoice, lines, totals: { ...invoice.totals, lineExtensionAmount: '-0.12' } };
    expect(validate(edited).map((v) => v.rule)).not.toContain('BR-CO-10');
  });
});

describe('a document is read as the standard reads it, not as ubl-billing wrote it', () => {
  it('accepts xs:boolean 1 and 0 for the charge indicator', () => {
    const xml = base().replace(/<cbc:ChargeIndicator>false<\/cbc:ChargeIndicator>/g, '<cbc:ChargeIndicator>0</cbc:ChargeIndicator>');
    expect(() => fromUbl(xml)).not.toThrow();
  });

  it('reports a missing element as a business rule instead of refusing to read', () => {
    const xml = base().replace(/<cbc:IssueDate>[^<]*<\/cbc:IssueDate>/, '');
    expect(rules(xml)).toContain('BR-03');
  });

  it('ignores a line tax category whose scheme is not VAT (BR-CO-04)', () => {
    const xml = base().replace(/(<cac:ClassifiedTaxCategory>[\s\S]*?<cac:TaxScheme>\s*<cbc:ID>)VAT/g, '$1XYZ');
    expect(rules(xml)).toContain('BR-CO-04');
  });
});

describe('VAT category rules', () => {
  it('knows category B, Italian split payment', () => {
    const invoice = calculate({
      ...domesticInvoice,
      allowances: undefined,
      lines: [{ ...domesticInvoice.lines[0]!, vatCategory: 'B', vatRate: '22' }],
    });
    expect(validate(invoice).map((v) => v.rule)).toContain('BR-B-01');
  });

  it('tolerates one currency unit of rounding on a standard-rated breakdown (BR-S-08)', () => {
    const invoice = calculate(domesticInvoice);
    const [seven, nineteen] = invoice.vatBreakdown;
    const nudged = { ...invoice, vatBreakdown: [seven!, { ...nineteen!, taxableAmount: (Number(nineteen!.taxableAmount) + 0.9).toFixed(2) }] };
    expect(validate(nudged).map((v) => v.rule)).not.toContain('BR-S-08');
  });

  it('is exact for categories that carry no rate (BR-AE-08)', () => {
    const invoice = calculate(reverseChargeInvoice);
    const [entry] = invoice.vatBreakdown;
    const nudged = { ...invoice, vatBreakdown: [{ ...entry!, taxableAmount: (Number(entry!.taxableAmount) + 0.5).toFixed(2) }] };
    expect(validate(nudged).map((v) => v.rule)).toContain('BR-AE-08');
  });

  it('flags a VAT breakdown for a category no line uses (BR-S-01)', () => {
    const invoice = calculate(reverseChargeInvoice);
    const extra = { ...invoice.vatBreakdown[0]!, category: 'S' as const, rate: '19', taxableAmount: '0.00', taxAmount: '0.00' };
    expect(validate({ ...invoice, vatBreakdown: [...invoice.vatBreakdown, extra] }).map((v) => v.rule)).toContain('BR-S-01');
  });
});

describe('VAT identifier prefixes (BR-CO-09)', () => {
  it.each(['EL123456789', 'XI123456789', 'DE123456789'])('accepts %s', (vatId) => {
    const invoice = calculate({ ...domesticInvoice, seller: { ...domesticInvoice.seller, vatId } });
    expect(validate(invoice).map((v) => v.rule)).not.toContain('BR-CO-09');
  });

  it('rejects a prefix the standard does not list', () => {
    const invoice = calculate({ ...domesticInvoice, seller: { ...domesticInvoice.seller, vatId: 'ZZ123456789' } });
    expect(validate(invoice).map((v) => v.rule)).toContain('BR-CO-09');
  });
});

describe('payment instructions (BR-49, BR-50, BR-61)', () => {
  const transfer = { meansCode: '58' as const, creditTransfer: { accountId: 'DE02120300000000202051' } };

  it('checks every payment instruction, not just the first', () => {
    const invoice = calculate({ ...domesticInvoice, payment: transfer, furtherPayments: [{ meansCode: '58' as const }] });
    expect(validate(invoice).map((v) => v.rule)).toContain('BR-61');
  });

  it('keeps further payment instructions through UBL', () => {
    const invoice = calculate({ ...domesticInvoice, payment: transfer, furtherPayments: [{ meansCode: '10' as const }] });
    expect(fromUbl(toUbl(invoice)).furtherPayments).toEqual([{ meansCode: '10' }]);
  });

  it('applies BR-50 only to credit-transfer means', () => {
    const xml = toUbl(calculate({ ...domesticInvoice, payment: { meansCode: '30' as const, creditTransfer: { accountId: 'X' } } }));
    const dropped = xml.replace(/(<cac:PayeeFinancialAccount>\s*)<cbc:ID>X<\/cbc:ID>/, '$1');
    expect(rules(dropped)).toEqual(expect.arrayContaining(['BR-50', 'BR-61']));
    expect(rules(dropped.replace('>30<', '>10<'))).not.toContain('BR-50');
  });
});
