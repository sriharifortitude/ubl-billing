# 0003. VAT exemption reasons are supplied, not inferred

**Status:** accepted

## Decision

`InvoiceInput.vatExemptionReasons` maps a VAT category to a reason text and
code. `calculate()` copies them onto the corresponding breakdown entries.
Nothing is inferred from the category.

## Reasoning

EN 16931 requires a reason (BT-120) or a code (BT-121) for every breakdown
entry in categories E, AE, K, G and O. The VAT breakdown is derived, so the
reason has to come from somewhere; the tempting shortcut is to infer it
("AE means reverse charge, so write 'Reverse charge'"). That produces a
document that passes validation while asserting a legal basis the seller
never chose. The exemption reason is a tax statement with consequences; the
library must not make it on the seller's behalf.

The CEF VATEX code list exists precisely so that the code carries the legal
basis: `VATEX-EU-AE`, `VATEX-EU-IC`, `VATEX-EU-G`. The fixture uses it.

## Costs

A reverse-charge invoice without the field fails `BR-AE-10`. That is the
correct outcome, and the error message names the field.
