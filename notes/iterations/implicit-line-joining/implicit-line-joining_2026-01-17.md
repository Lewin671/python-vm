# Iteration: Implicit Line Joining in Brackets
**Date:** 2026-01-17
**Target:** Python implicit line joining semantics

## Exploit Hypothesis
Python allows implicit line joining within balanced parentheses, brackets, and braces. A parser that strictly follows line-by-line execution without tracking bracket balance will fail to parse multi-line data structures.

## Adversarial Code
```python
l = [
    1,
    2
]
print(len(l))
print(l)
```

## Outcome
- **CPython Output:** 
  ```
  2
  [1, 2]
  ```
- **Compiler Result:** `FAIL`
- **Error:** `Error: Unexpected token type for literal: NEWLINE` at `Parser.parseLiteral (src/parser/expressions.ts:26:9)`

## Lessons Learned
The lexer or parser must be aware of bracket depth to correctly ignore `NEWLINE` tokens when they appear inside `()`, `[]`, or `{}`. This is a core part of Python's layout rules (PEP 8).

## Solution
(To be implemented) The lexer should probably track bracket depth and suppress `NEWLINE` tokens when depth > 0, or the parser should explicitly handle and skip `NEWLINE` tokens within these contexts.
