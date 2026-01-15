# 集合操作
set1 = {1, 2, 3, 4, 5}
set2 = {4, 5, 6, 7, 8}

print("set1:", sorted(set1))
print("set2:", sorted(set2))

# 集合操作
print("Union:", sorted(set1 | set2))
print("Intersection:", sorted(set1 & set2))
print("Difference:", sorted(set1 - set2))
print("Symmetric difference:", sorted(set1 ^ set2))

# 集合方法
set3 = {1, 2, 3}
set3.add(4)
print("After add(4):", sorted(set3))

set3.update([5, 6])
print("After update:", sorted(set3))

set3.remove(1)
print("After remove(1):", sorted(set3))

# 集合成员检测
print("2 in set3:", 2 in set3)
print("10 not in set3:", 10 not in set3)

# 空集合
empty_set = set()
print("Empty set:", sorted(empty_set))

# 集合中的唯一元素
numbers = [1, 1, 2, 2, 3, 3, 4, 5]
unique = set(numbers)
print("Unique numbers:", sorted(unique))
