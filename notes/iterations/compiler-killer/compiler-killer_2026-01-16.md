# compiler-killer: match-case parsing/execution

- Date: 2026-01-16
- Stage: test
- Status: resolved

## Problem / Symptom

`compiler_killer_match.py` failed to parse with `Unexpected token in expression: :` because `match`/`case` syntax was unsupported.

## Impact / Risk

Example suite failed; match-case examples could not run, blocking verification.

## Current Understanding

Added match-case support in lexer, parser, and VM with pattern handling for literals, captures, wildcards, list sequences, and OR patterns. Match executes first matching case, with optional guards evaluated using temporary bindings.

## Next Steps

None.

## Evidence (optional)
- Tests: `./scripts/verify.sh`
