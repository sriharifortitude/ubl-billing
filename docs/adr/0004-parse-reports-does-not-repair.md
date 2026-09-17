# 0004. The parser reports inconsistent documents rather than repairing them

**Status:** accepted

## Decision

`fromUbl()` returns exactly what the document says, including totals that
do not add up. It never recalculates. `validate()` is the separate step that
says what is wrong.

## Reasoning

A document received from a counterparty with a wrong total is evidence of a
problem on their side, and the right response is to reject it citing the
rule -- which is what every access point does. A parser that silently fixed
the total would accept an invoice the recipient's accounting system will
then book at a figure the sender never issued.

It also keeps the two capabilities honest: a round-trip test that serialises,
parses and validates proves the serialiser, and a test that tampers with the
XML and expects `BR-CO-16` proves the parser did not paper over it.

## Costs

A caller who wants "read this and fix it" has to call `calculate()` on the
parsed input themselves. That is one line, and it is explicit.
