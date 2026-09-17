# ubl-billing

[![CI](https://github.com/sriharifortitude/ubl-billing/actions/workflows/ci.yml/badge.svg)](https://github.com/sriharifortitude/ubl-billing/actions/workflows/ci.yml)

Build, calculate, validate and parse EN 16931 electronic invoices — the
European standard behind Peppol BIS Billing 3.0, XRechnung, and the national
e-invoicing mandates rolling out across the EU.

TypeScript, exact decimal arithmetic, rule identifiers straight from the
specification. MIT.

---

## Why this exists

Mandatory B2B e-invoicing is arriving country by country — Germany's receiving
obligation is in force, Belgium, Poland and France follow — and every one of
those mandates is built on EN 16931. The invoice is no longer a PDF: it is a
UBL XML document that a receiving system validates by machine against a
published rule set, and rejects with a rule id.

Two things go wrong in practice. Totals are computed with floating point and
come out a cent off, failing `BR-CO-14` at the recipient. And the document is
structurally right but semantically wrong — a reverse-charge invoice with no
exemption reason, a Peppol document with no buyer reference — and fails a
rule nobody on the sending side had read.

This library does the arithmetic exactly and runs the rules before you send.

## What it does

```ts
import { calculate, validate, toUbl, fromUbl } from 'ubl-billing';

const invoice = calculate({
  number: 'RE-2026-0042',
  issueDate: '2026-09-15',
  dueDate: '2026-10-15',
  currency: 'EUR',
  buyerReference: 'PO-7781',
  seller: { name: 'Muster GmbH', vatId: 'DE123456789',
            electronicAddress: { scheme: '9930', value: 'DE123456789' },
            address: { city: 'Berlin', countryCode: 'DE' } },
  buyer:  { name: 'Kunde AG', vatId: 'DE987654321',
            electronicAddress: { scheme: '0204', value: '04011000-12345-67' },
            address: { city: 'München', countryCode: 'DE' } },
  lines: [
    { id: '1', quantity: '10', unitCode: 'HUR', netPrice: '120.00',
      itemName: 'Consulting', vatCategory: 'S', vatRate: '19' },
    { id: '2', quantity: '3', unitCode: 'C62', netPrice: '0.3333',
      itemName: 'Widget', vatCategory: 'S', vatRate: '19' },
  ],
});

invoice.totals.payableAmount;   // "1429.19" -- derived, never typed in
validate(invoice);              // [] -- or a list of { rule, severity, message, terms }
const xml = toUbl(invoice);     // UBL 2.1, Peppol BIS Billing 3.0
const back = fromUbl(xml);      // and back again
```

- **`calculate`** derives every total and the VAT breakdown from lines,
  allowances and charges. You supply what you know; it computes what the
  standard defines. Amounts are decimal *strings* at the boundary so a JSON
  payload cannot smuggle a float in.
- **`validate`** runs 78 rules — EN 16931 `BR-*`, `BR-CO-*`, `BR-DEC-*`, the
  per-category VAT rules, and the Peppol `PEPPOL-EN16931-R*` set — and
  returns every violation with the rule id the recipient would cite.
- **`toUbl` / `fromUbl`** serialise to and parse from UBL 2.1 Invoice and
  CreditNote, in schema element order.
- **CLI**: `ubl-billing build invoice.json`, `validate invoice.xml`,
  `inspect invoice.xml`, `rules`.

## The arithmetic, and why it is the way it is

Every amount is a `decimal.js` value. A JavaScript `number` cannot represent
`0.1`, and `0.1 + 0.2 + 0.7` is not `1.00` — it is `1.0000000000000002`, and an
invoice that says so is rejected.

The order of operations follows what a receiving validator recomputes:

1. Each line net is `quantity × (price ÷ base quantity)`, rounded **once**, to
   two decimals. `3 × 0.3333` is `1.00`; rounding the price first gives `0.99`.
2. Lines, allowances and charges are grouped by `(VAT category, rate)`. The
   taxable amount per group is the sum of rounded line nets.
3. VAT per group is `taxable × rate ÷ 100`, rounded. Three lines at `0.33`
   and 19% give `0.99 × 0.19 = 0.19`; computing per line and summing gives
   `0.18` — and the recipient computes per group.
4. Totals are sums of those rounded figures.

Rounding is half-up. EN 16931 does not mandate a method; half-up is what the
Peppol validation artefacts and every national implementation encountered
agree on, and it is what an accountant checking the PDF against the XML
expects.

The tests state their expected values from hand-worked arithmetic in a
comment, not from the code's output.

## Rule coverage, honestly

78 rule ids are implemented — `ubl-billing rules` lists them. EN 16931 has
around 200 and Peppol adds around 90 more, many of them national. What is
here is the set that rejects documents in practice: every arithmetic rule,
every per-category VAT rule, the mandatory-field rules, the decimal
constraints, and the Peppol identity rules.

Rules the typed model makes impossible to violate are deliberately **not**
listed as implemented. `BR-08` (seller address present) cannot fail when the
type requires it; counting it would inflate the number without adding a
check.

Not implemented: code-list validation against live ISO lists (currency and
country are checked by shape only), the full schematron for line-level
allowance/charge VAT, and national CIUS rules (XRechnung's `BR-DE-*`,
Italy's SDI rules). These are the natural next additions.

## Install

```bash
npm install ubl-billing
```

Node 20.11+. No native dependencies.

## Testing

```bash
npm test     # 52 tests: arithmetic against hand-worked figures, every rule
             # firing and not firing, serialise → parse round trip, credit notes
```

## Design notes

See [`docs/adr/`](docs/adr/) for: why decimal strings at the boundary, why
`calculate()` re-parses its input, why exemption reasons are input rather
than inferred, and why the parser reports inconsistent totals instead of
repairing them.

## Licence

MIT. Copyright (c) 2026 Sri Hari Manikandan.
