# floor-division: Python modulo semantics for negatives

- Date: 2026-01-16
- Stage: test
- Status: resolved

## Problem / Symptom

Floor-division example failed recomposition: `x = -3` produced `x % 2 == -1` and `(x // 2) * 2 + (x % 2) == -5`.

## Impact / Risk

Modulo on negative operands followed JavaScript remainder semantics, breaking Python identity `a == (a // b) * b + (a % b)`.

## Current Understanding

Python defines `%` using floor division: `a - floor(a / b) * b`. VM `%` used `left % right` and needed to align with Python semantics, including float operand handling.

## Next Steps

None.

## Related Iterations (optional)
- Linked issues from other stages:

## Evidence (optional)
- Logs:
- Tests: `scripts/verify.sh`
- Diffs/Commits:
