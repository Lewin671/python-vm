# compiler-runtime: float('nan') rejected

- Date: 2026-01-16
- Stage: test
- Status: resolved

## Problem / Symptom

TypeScript VM throws ValueError "Invalid float" when running code that calls float('nan').

## Impact / Risk

Valid Python code using NaN literals or float('nan') cannot run; downstream semantics like NaN set behavior cannot be tested.

## Current Understanding

The runtime uses parseFloat and treats NaN as invalid, diverging from CPython which accepts float('nan').

## Next Steps

- Done: float() now accepts nan/inf tokens, handles no-arg calls, and comparisons respect NaN semantics.
- Optional: add a regression example that exercises NaN equality and set behavior.

## Evidence (optional)
- Tests: ./scripts/verify.sh (fails on examples/nan_set.py)
 - Tests: ./scripts/verify.sh (passes)
