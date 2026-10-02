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
- **`validate`** runs 162 rules — EN 16931 `BR-*`, `BR-CO-*`, `BR-DEC-*`, the
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

162 rule ids are implemented — `ubl-billing rules` lists them. EN 16931 has
around 200 and Peppol adds around 90 more, many of them national.

Rules the typed model makes impossible to violate are deliberately **not**
listed as implemented, so a count is not inflated by checks that cannot fail.

Not implemented: code-list validation against live ISO lists (currency and
country are checked by shape only), the full schematron for line-level
allowance/charge VAT, the document-level references (`BR-17`..`BR-20`,
`BR-52`, `BR-54`..`BR-57`) and national CIUS rules (XRechnung's `BR-DE-*`,
Italy's SDI rules).

`BR-CO-25` (a due date or payment terms when an amount is due) was removed
from the standard in 1.3.16 and is off by default. Pass
`{ paymentTermsRequired: true }` to `validate` if you want it anyway.

## Conformance against the official validator

The numbers above say what is implemented, not whether it is right. So the
rules are tested against the standard's own artefacts: the official EN 16931
Schematron, compiled to XSLT 2.0 and run by Saxon-HE, over a corpus built
from the 19 official UBL example invoices plus single-fault mutations of them
(an element dropped, an amount nudged, a VAT category swapped).

```bash
conformance/fetch.sh            # pinned, sha256-verified download; needs curl + a JDK
npx tsx conformance/run.ts      # 5,872 documents, a few minutes
```

Last run, against validation artefacts 1.3.16:

| | |
| --- | --- |
| valid documents ubl-billing accepts | 1695 of 1695 |
| invalid documents ubl-billing rejects | 3927 of 4177 (94.0%) |
| rules exercised by the corpus that ubl-billing implements | 125, none letting an invalid document through |

The 250 invalid documents that get through violate only rules ubl-billing
does not implement: the document references listed above, the code lists
(`BR-CL-*`) and the UBL syntax rules (`UBL-SR-*`). The run fails on any rule ubl-billing implements
that accepts a document the official validator rejects, any valid document it
refuses, and any rule id it cites that the standard does not contain. One
mutated document crashes the official validator itself and is excluded. What
the corpus cannot show: it is built from 19 invoices, so a rule none of them
exercises is not tested here.

Writing this found defects in the first release that its own tests had not:
a rounding rule that followed half-up instead of XPath's round-half-up-towards-
infinity, VAT rules that demanded exact equality where the standard allows one
currency unit, category `B` (Italian split payment) unknown, a parser that
refused documents instead of reporting the missing element as a business rule,
and payment rules that checked only the first payment instruction.

## Install

```bash
npm install github:sriharifortitude/ubl-billing#v0.2.0
```

Not on npm yet; the line above installs the tagged release from GitHub
and builds it on install (`prepare`). Node 20.11+. No native dependencies.

## Testing

```bash
npm test     # 67 tests: arithmetic against hand-worked figures, every rule
             # firing and not firing, serialise → parse round trip, credit notes
```

## Design notes

See [`docs/adr/`](docs/adr/) for: why decimal strings at the boundary, why
`calculate()` re-parses its input, why exemption reasons are input rather
than inferred, why the parser reports inconsistent totals instead of
repairing them, and why the official validator is the oracle rather than a
hand-written expected list.

## Licence

MIT. Copyright (c) 2026 Sri Hari Manikandan.
