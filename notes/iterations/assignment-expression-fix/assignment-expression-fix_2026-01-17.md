# Iteration: Assignment or Expression Parser Fix and Implicit Line Joining

## Date: 2026-01-17

## Problems Encountered
1. **Parser Misidentification**: The parser's `parseAssignmentOrExpression` method would call `parseTarget` first. If the statement was an expression that started like a target but wasn't one (e.g., a list comprehension `[x for x in y]`), `parseTarget` would throw an error instead of allowing the parser to backtrack and try `parseExpressionStatement`.
2. **Implicit Line Joining**: The lexer was emitting `NEWLINE`, `INDENT`, and `DEDENT` tokens even inside brackets `[]`, parentheses `()`, and braces `{}`. In Python, these tokens should be suppressed within brackets to allow expressions to span multiple lines.

## Fixes Implemented
1. **Parser Refinement**:
    - Modified `parseAssignmentOrExpression` in `src/parser/statements.ts`.
    - Wrapped the `parseTarget` call in a `try-catch` block.
    - If `parseTarget` fails, it now catches the error and backtracks to the beginning of the statement to try parsing it as an expression statement.
    - Ensured that errors occurring *after* an assignment operator is matched are still allowed to propagate.

2. **Lexer Refinement**:
    - Modified `tokenize` in `src/lexer/lexer.ts`.
    - Added a `bracketLevel` counter to track nesting of `(`, `[`, `{`.
    - Suppressed `NEWLINE` tokens and `INDENT`/`DEDENT` emission when `bracketLevel > 0`.
    - This implements Python's implicit line joining rule.

## Verification Results
- All tests in `tests/compiler.test.ts` passed.
- `scripts/verify.sh` completed successfully.
