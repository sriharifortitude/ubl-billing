# 0001. Amounts are decimal strings in, exact decimals inside, never numbers

**Status:** accepted

## Decision

Every amount, quantity, price and rate enters the library as a string
(`"19.99"`), is validated by pattern, and is converted to a `decimal.js`
value for all arithmetic. No public type carries a `number` for money. Output
amounts are formatted to exactly two decimals.

## Reasoning

`0.1 + 0.2 + 0.7` in IEEE 754 is `1.0000000000000002`. An invoice whose total
is that is rejected by the receiving validator with `BR-CO-14`, days later,
by a machine. Accepting a `number` at the boundary would mean the caller's
JSON serialiser -- not this library -- decided whether the arithmetic was
exact, and the failure would be intermittent and untraceable.

A string boundary also means a JSON payload cannot contain a float by
accident: `19.99` in JSON is a number and fails the schema.

## Costs

Callers write `"19.99"` rather than `19.99`. Every arithmetic operation is a
method call. Both are the price of being right.

## Rejected

**Integer minor units (cents).** Exact, but EN 16931 permits prices with
more than two decimals (BT-146), quantities with arbitrary precision, and
percentages with decimals; three different scales in one model is where
mistakes happen.
