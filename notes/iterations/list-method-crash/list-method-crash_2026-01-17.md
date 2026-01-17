# Iteration: List/Set Method Return Value Fix (2026-01-17)

## Problem
Several Python list and set methods that should return `None` were returning their JavaScript counterparts' return values:
- `list.append(x)` was returning the new length of the array (from `Array.prototype.push`).
- `set.add(x)`, `set.update(iterable)`, and `set.remove(x)` were returning the set itself (from `Set.prototype.add` or similar) or other non-`None` values.

This caused failures in `examples/compiler_killer_append_return.py` and `examples/compiler_killer_list_append_return.py`.

## Solution
Modified `src/vm/operations.ts` within the `getAttribute` function to wrap the problematic methods. The wrappers now execute the mutation and then explicitly return `null` (which represents `None` in this VM implementation).

### Changes in `src/vm/operations.ts`:
- **List Methods:**
  - `append`: Wrapped `obj.push(value)` to return `null`.
- **Set Methods:**
  - `add`: Wrapped `obj.add(value)` to return `null`.
  - `update`: Added `return null` after iterating and adding items.
  - `remove`: Wrapped `obj.delete(value)` to return `null`.

## Verification Results
- Ran `scripts/verify.sh`.
- All tests in `tests/compiler.test.ts` passed, including all 40+ example files in `examples/`.
- Specifically, `compiler_killer_append_return.py` and `compiler_killer_list_append_return.py` now match Python's output.