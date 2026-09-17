import { Decimal } from 'decimal.js';

/**
 * All monetary and quantity arithmetic goes through Decimal. A JavaScript
 * number cannot represent 0.1 exactly, and an invoice whose VAT total is off
 * by a cent fails BR-CO-14 at the recipient's access point -- and the
 * rejection arrives days later, from a machine, with a rule id and no
 * further explanation. Exactness is not a nicety in this domain; it is the
 * acceptance criterion.
 *
 * EN 16931 requires amounts to two decimals (BR-DEC-*) but does not mandate
 * a rounding method. Half-up is what the Peppol validation artefacts and
 * every national implementation encountered agree on, and it is what an
 * accountant expects; banker's rounding would produce totals that a human
 * checking the PDF against the XML would flag as wrong.
 */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Amount = Decimal;

export function amount(value: string | number | Decimal): Amount {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`Not a finite amount: ${String(value)}`);
  }
  return new Decimal(value);
}

/** Two decimals, half-up: the representation every amount is serialised in. */
export function round2(value: Amount): Amount {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Four decimals for unit prices, which the model permits (BT-146). */
export function round4(value: Amount): Amount {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function sum(values: readonly Amount[]): Amount {
  return values.reduce((total, value) => total.plus(value), new Decimal(0));
}

export const ZERO: Amount = new Decimal(0);

/**
 * Serialised form. `toFixed(2)` rather than `toString()`: "10" must appear
 * as "10.00" and "0.1" as "0.10". Several validators reject amounts with
 * fewer than two decimals as a formatting error even though the value is
 * arithmetically fine.
 */
export function formatAmount(value: Amount): string {
  return round2(value).toFixed(2);
}

export function formatQuantity(value: Amount): string {
  // Quantities keep whatever precision they were given, trailing zeros
  // stripped; "1.5000" and "1.5" are the same quantity.
  return value.toString();
}

export function formatPercent(value: Amount): string {
  return value.toString();
}

export function decimalPlaces(value: Amount): number {
  return value.decimalPlaces();
}
