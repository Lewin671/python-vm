# Iteration: Class Comprehension Outermost Iterable Scope

## Case Tested
Testing whether class variables are accessible in the outermost iterable of a comprehension defined within a class.

```python
class A:
    val = "success"
    result = [x for x in [val]]
    print(result[0])
```

## Outcome
- **CPython**: Prints "success"
- **TS Compiler**: Fails with `NameError: name 'val' is not defined`

## Analysis
The TS implementation creates a new `Scope` for the comprehension with the class scope as its parent. When looking up names in `Scope.get`, it specifically skips parents that are marked as `isClassScope`. While this is correct for the body of the comprehension (and for nested functions), Python semantics specify that the outermost iterable of a comprehension is evaluated in the *enclosing* scope, which in this case is the class scope. The TS VM evaluates the outermost iterable in the comprehension's scope, causing it to skip the class scope and fail to find `val`.

## Learnings
- Comprehension evaluation needs to distinguish between the outermost iterable and the rest of the comprehension.
- `Scope.get`'s logic for skipping class scopes is correct for nested functions but must be handled carefully when entering new scopes created by comprehensions.
