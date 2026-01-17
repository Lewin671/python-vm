# Iteration: Generator Lifecycle and Nested Yield Crash

## Case Tested
Testing `yield` expressions nested within `try...except...finally` blocks inside a generator, and the use of generator lifecycle methods `throw()` and `close()`.

## Adversarial Code
```python
def lifecycle_gen():
    try:
        yield "start"
    except ValueError:
        yield "caught"
    finally:
        print("cleaned up")

print("--- Test Throw ---")
g1 = lifecycle_gen()
print(next(g1))
print(g1.throw(ValueError))
try:
    next(g1)
except StopIteration:
    pass

print("\n--- Test Close ---")
g2 = lifecycle_gen()
print(next(g2))
g2.close()
print("closed")
```

## Outcome
### CPython Output
```
--- Test Throw ---
start
caught
cleaned up

--- Test Close ---
start
cleaned up
closed
```

### Compiler Failure
The compiler crashes with the following error:
`Error: Unsupported expression type: Yield`

Stack trace indicates the failure occurs in `VirtualMachine.evaluateExpression` called from `VirtualMachine.executeStatement` (handling `TryStatement` body) within `VirtualMachine.executeStatementGenerator`.

## Lessons Learned
- The compiler has a specialized generator executor (`executeStatementGenerator`), but it seems to fall back to the standard `executeStatement` for certain block-level statements like `TryStatement`.
- The standard `evaluateExpression` does not support `Yield` nodes, which are expected to be handled only within the generator execution context.
- When `Yield` is nested inside a statement that is not natively "generator-aware" in its implementation, the VM fails.
- Generator lifecycle methods like `throw()` and `close()` are also likely untested or unimplemented in this context.
