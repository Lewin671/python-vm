# Fix: Outermost Iterable of Comprehension Scope in Class Definitions

## Problem
In Python 3, comprehensions have their own scope, similar to nested functions. However, the outermost iterable of a comprehension (the `iter` in the first `clause`) is evaluated in the enclosing scope. When a comprehension is defined within a class scope, this outermost iterable should be able to see class variables.

In the previous implementation, the entire comprehension was evaluated using a new `compScope` which has the enclosing scope as its parent. Because `Scope.get` was designed to skip class scopes when looking up names in parent scopes (to mimic nested function behavior where class variables are not visible), the outermost iterable could not see class variables, leading to a `NameError`.

## Solution
1. Modified `evaluateComprehension` and `generateComprehension` in `src/vm/callable.ts` to accept an optional `outerScope` parameter.
2. Updated these functions to use `outerScope` ONLY for the first iterable (`clause.iter`) of the comprehension. All other parts (subsequent iterables, `if` conditions, and the result expression) continue to use the comprehension's own `scope`.
3. Updated `src/vm/expressions.ts` to pass the defining `scope` as the `outerScope` when evaluating `LIST_COMP`, `SET_COMP`, `DICT_COMP`, and `GENERATOR_EXPR`.

This correctly implements Python 3's scoping rules for comprehensions, where only the outermost iterable can access class variables when defined inside a class.

## Verification
- Ran `examples/compiler_killer_class_comp_iterable.py`, which now passes.
- All tests in `tests/compiler.test.ts` passed.
