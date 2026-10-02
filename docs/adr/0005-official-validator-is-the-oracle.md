# 0005. The official validator is the oracle; differences are gated, not scored

**Status:** accepted

## Decision

Conformance is measured by running the standard's own Schematron (via
Saxon-HE) over the same documents as ubl-billing and comparing, per document,
which rule ids each side reports. The run fails on three things only:

- `accepts-invalid:<rule>` -- the official validator rejects, ubl-billing
  accepts, for a rule ubl-billing claims to implement.
- `rejects-valid:<rule>` -- the official validator accepts, ubl-billing rejects.
- `unknown-rule-id:<id>` -- ubl-billing cites a rule the standard does not have.

Rejecting an invalid document under a different rule id is reported, not
gated. A known difference may be recorded in `conformance/known-differences.json`
with a reason; a recorded difference that stops occurring also fails the run,
so the list cannot rot.

## Reasoning

Unit tests written by the implementer encode the implementer's reading of the
standard. The first run of this harness disagreed with that reading in dozens
of places, most of them legitimate: tolerances, rounding mode, which rules
apply to which payment means. A single "percent agreement" number would have
hidden which disagreements mattered. Gating on the three directions above
keeps the build red for the failures that cost money -- a bad invoice sent, a
good one refused -- and leaves the cosmetic ones visible but quiet.

## Costs

The run needs a JDK and a pinned download of the artefacts and Saxon, so it is not part of
`npm test`; CI runs it as its own job. The corpus is derived from 19 invoices,
so it exercises the rules those invoices touch and no others.
