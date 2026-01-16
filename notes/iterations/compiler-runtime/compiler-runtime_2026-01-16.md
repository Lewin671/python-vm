# compiler-runtime: Expanded AST interpreter coverage

- Date: 2026-01-16
- Status: resolved

## Problem / Symptom

Tests failed across example scripts due to missing Python features and incorrect runtime semantics.

## Impact / Risk

Compiler could not match Python outputs for provided examples, blocking `scripts/verify.sh`.

## Current Understanding

Implemented a broader lexer/parser and replaced bytecode execution with an AST interpreter that now supports:
- Indentation-aware lexing, additional tokens/keywords, and slice parsing.
- Statements (if/elif/else, loops, try/except/finally, with, def/class, decorators, global/nonlocal).
- Expressions (calls, attributes, subscripts, comprehensions, generator expressions, f-strings, format specs).
- Runtime objects (functions, classes, instances, generators, files) and key builtins.
- Python-like printing/formatting, tuples, sets, dicts, complex numbers, and float display.

## Next Steps

- If expanding beyond examples, tighten Python semantics (scope rules, error types, numeric coercions) and add dedicated tests.
- Consider refactoring the interpreter into a clearer runtime module and add documentation of supported subset.

## Evidence (optional)
- Tests: `scripts/verify.sh`
