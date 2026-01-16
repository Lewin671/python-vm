# compiler-killer: match-case parse failure

- Date: 2026-01-16
- Stage: test
- Status: open

## Problem / Symptom

Adding a Python 3.10 match-case example causes the TypeScript parser to throw `Unexpected token in expression: :` during tests.

## Impact / Risk

Any source using structural pattern matching cannot be parsed or executed by the TypeScript compiler, blocking real-world Python 3.10+ code.

## Current Understanding

The new example `examples/compiler_killer_match.py` triggers a parse error in `parseAtom` when the test harness runs all example files.

## Next Steps

- Decide whether to implement match-case parsing or explicitly reject it with a clearer error message.
- Add or update feature-support documentation to mark match-case as unsupported (if intentional).

## Evidence (optional)
- Tests: `npm test` fails in `tests/compiler.test.ts` with `Unexpected token in expression: :`.
