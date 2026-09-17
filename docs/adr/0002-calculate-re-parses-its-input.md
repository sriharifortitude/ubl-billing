# 0002. `calculate()` re-parses its input through the schema

**Status:** accepted

## Decision

`calculate(input)` runs `invoiceInputSchema.parse(input)` before any
arithmetic, even though the parameter is already typed as `InvoiceInput`.

## Reasoning

A type annotation is a promise the compiler checks at the call site and
nothing checks at runtime. The input to this function is, in every real
deployment, a JSON document that arrived over a wire or was read from a
file, and the `InvoiceInput` annotation on it is an assertion by the caller.
Parsing enforces the string-amount pattern, applies the `typeCode` default,
and turns a malformed date into a clear error before it becomes a wrong
total.

This surfaced from a test, not from foresight: a fixture without `typeCode`
compiled fine and then failed `BR-04` because the default lives in the
schema and the schema had not run.

## Costs

One schema validation per calculation. Negligible against the arithmetic.
