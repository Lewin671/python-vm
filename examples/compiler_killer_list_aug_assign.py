# Exploit: In Python, l += [x] modifies the list in-place, while l = l + [x] creates a new list.
l1 = [1]
l2 = l1
l1 += [2]
print(l1 is l2)
print(l1)
print(l2)
