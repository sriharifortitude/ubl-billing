import { ZERO_RATE_CATEGORIES } from '../model/codes.js';
import {
  invoiceInputSchema,
  type AllowanceCharge,
  type Invoice,
  type InvoiceInput,
  type Line,
  type LineInput,
  type Totals,
  type VatBreakdownEntry,
} from '../model/invoice.js';
import { amount, formatAmount, round2, sum, ZERO, type Amount } from '../money/decimal.js';

/**
 * Derives every calculated field of an invoice from its inputs, following the
 * arithmetic the EN 16931 BR-CO rules will later check.
 *
 * The order matters and is the one the standard implies: line nets are rounded
 * individually (BR-DEC-23) *before* being summed, VAT is computed per
 * (category, rate) group on the rounded taxable amount (BR-CO-17) and rounded
 * per group, and the totals are sums of those rounded figures. Computing VAT
 * on the unrounded grand total and rounding once at the end gives a different
 * answer by a cent often enough to matter, and that different answer fails
 * validation at the recipient.
 */
export function calculate(rawInput: InvoiceInput): Invoice {
  // Parsed rather than trusted: this applies the schema defaults (typeCode)
  // and rejects a float or a malformed date before any arithmetic happens.
  const input = invoiceInputSchema.parse(rawInput);
  const lines = input.lines.map(calculateLine);

  const lineExtension = round2(sum(lines.map((line) => amount(line.netAmount))));
  const allowanceTotal = round2(sum((input.allowances ?? []).map((a) => amount(a.amount))));
  const chargeTotal = round2(sum((input.charges ?? []).map((c) => amount(c.amount))));

  // BR-CO-13
  const taxExclusive = round2(lineExtension.minus(allowanceTotal).plus(chargeTotal));

  const vatBreakdown = calculateVatBreakdown(lines, input.allowances ?? [], input.charges ?? []).map((entry) => {
    const reasons = input.vatExemptionReasons?.[entry.category];
    return {
      ...entry,
      ...(reasons?.reason === undefined ? {} : { exemptionReason: reasons.reason }),
      ...(reasons?.code === undefined ? {} : { exemptionReasonCode: reasons.code }),
    };
  });

  // BR-CO-14
  const taxTotal = round2(sum(vatBreakdown.map((entry) => amount(entry.taxAmount))));

  const rounding = round2(amount(input.roundingAmount ?? '0'));
  // BR-CO-15
  const taxInclusive = round2(taxExclusive.plus(taxTotal).plus(rounding));

  const prepaid = round2(amount(input.prepaidAmount ?? '0'));
  // BR-CO-16
  const payable = round2(taxInclusive.minus(prepaid));

  const totals: Totals = {
    lineExtensionAmount: formatAmount(lineExtension),
    allowanceTotalAmount: formatAmount(allowanceTotal),
    chargeTotalAmount: formatAmount(chargeTotal),
    taxExclusiveAmount: formatAmount(taxExclusive),
    taxAmount: formatAmount(taxTotal),
    taxInclusiveAmount: formatAmount(taxInclusive),
    prepaidAmount: formatAmount(prepaid),
    payableRoundingAmount: formatAmount(rounding),
    payableAmount: formatAmount(payable),
  };

  return { ...input, lines, vatBreakdown, totals };
}

/**
 * BT-131 = BT-129 × (BT-146 ÷ BT-149) − line allowances + line charges,
 * rounded to two decimals. The intermediate product is not rounded: a price
 * of 0.3333 for 3 units is 1.00, not 3 × 0.33 = 0.99.
 */
export function calculateLine(line: LineInput): Line {
  const quantity = amount(line.quantity);
  const price = amount(line.netPrice);
  const base = amount(line.priceBaseQuantity ?? '1');

  if (base.isZero()) {
    throw new RangeError(`Line ${line.id}: price base quantity (BT-149) must not be zero.`);
  }

  const gross = quantity.times(price.div(base));
  const allowances = sum((line.allowances ?? []).map((a) => amount(a.amount)));
  const charges = sum((line.charges ?? []).map((c) => amount(c.amount)));

  return { ...line, netAmount: formatAmount(gross.minus(allowances).plus(charges)) };
}

interface BreakdownKey {
  readonly category: Line['vatCategory'];
  readonly rate: Amount;
}

function keyOf(category: Line['vatCategory'], rate: string | undefined): string {
  return `${category}|${amount(rate ?? '0').toString()}`;
}

/**
 * BG-23. One entry per distinct (category, rate) across lines and
 * document-level allowances/charges. Taxable amount is the sum of the rounded
 * line nets in the group, less allowances plus charges in that same group
 * (BR-S-08 and siblings); tax is taxable × rate ÷ 100, rounded (BR-CO-17).
 */
export function calculateVatBreakdown(
  lines: readonly Line[],
  allowances: readonly AllowanceCharge[],
  charges: readonly AllowanceCharge[],
): VatBreakdownEntry[] {
  const groups = new Map<string, { key: BreakdownKey; taxable: Amount; exemptionReason?: string; exemptionReasonCode?: string }>();

  const add = (category: Line['vatCategory'], rate: string | undefined, delta: Amount): void => {
    const id = keyOf(category, rate);
    const existing = groups.get(id);
    if (existing !== undefined) {
      existing.taxable = existing.taxable.plus(delta);
      return;
    }
    groups.set(id, { key: { category, rate: amount(rate ?? '0') }, taxable: delta });
  };

  for (const line of lines) add(line.vatCategory, line.vatRate, amount(line.netAmount));
  for (const allowance of allowances) add(allowance.vatCategory, allowance.vatRate, amount(allowance.amount).negated());
  for (const charge of charges) add(charge.vatCategory, charge.vatRate, amount(charge.amount));

  return [...groups.values()]
    .sort((a, b) => a.key.category.localeCompare(b.key.category) || a.key.rate.comparedTo(b.key.rate))
    .map(({ key, taxable }) => {
      const taxableRounded = round2(taxable);
      const isZeroRate = ZERO_RATE_CATEGORIES.has(key.category);
      const tax = isZeroRate ? ZERO : round2(taxableRounded.times(key.rate).div(100));

      return {
        category: key.category,
        // O (outside scope) carries no rate at all; the others carry theirs,
        // including an explicit zero.
        ...(key.category === 'O' ? {} : { rate: key.rate.toString() }),
        taxableAmount: formatAmount(taxableRounded),
        taxAmount: formatAmount(tax),
      };
    });
}
