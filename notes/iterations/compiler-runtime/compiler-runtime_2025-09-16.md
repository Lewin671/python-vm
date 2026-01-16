# compiler-runtime: Negative repeat handling

- Date: 2025-09-16
- Stage: test
- Status: resolved

## Problem / Symptom

RangeError: Invalid count value: -1 during binary * on strings/lists.

## Impact / Risk

Example execution fails when Python code repeats strings or lists with a negative count.

## Current Understanding

JavaScript String.repeat/Array(length) throw for negative counts, but Python returns empty sequences.

## Next Steps

Keep repeat behavior aligned with Python for other edge cases (e.g., non-integer counts).

## Evidence (optional)

- Tests: `scripts/verify.sh`
