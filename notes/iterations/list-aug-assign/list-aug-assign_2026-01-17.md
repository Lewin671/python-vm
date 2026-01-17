# Iteration: List Augmented Assignment Semantics
**Date:** 2026-01-17
**Target:** Python `+=` operator for lists (in-place modification)

## Exploit Hypothesis
In Python, the `+=` operator on a list is equivalent to `list.extend()`, meaning it modifies the list in-place. If the VM implements `l1 += l2` as `l1 = l1 + l2`, it will create a new list object, breaking the identity relationship with other references to the same list.

## Adversarial Code
```python
l1 = [1]
l2 = l1
l1 += [2]
print(l1 is l2)
print(l1)
print(l2)
```

## Outcome
- **CPython Output:** 
  ```
  True
  [1, 2]
  [1, 2]
  ```
- **Compiler Result:** `DIFF`
- **Actual Output:**
  ```
  False
  [1, 2]
  [1]
  ```

## Lessons Learned
Augmented assignment for mutable types must be handled carefully. For lists, `+=` is an in-place operation. The VM's bytecode or execution logic for `INPLACE_ADD` (or equivalent) should check the type of the left-hand side and perform in-place mutation if applicable, rather than always falling back to a binary addition and reassignment.

## Solution
(To be implemented) Update the VM's `aug-assign` logic to support in-place modification for lists.
