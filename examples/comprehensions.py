# 列表推导式
numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# 简单推导式
squares = [x**2 for x in numbers]
print("Squares:", squares)

# 带条件的推导式
evens = [x for x in numbers if x % 2 == 0]
print("Even numbers:", evens)

# 嵌套推导式
matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
flattened = [x for row in matrix for x in row]
print("Flattened:", flattened)

# 字典推导式
word = "hello"
char_count = {char: word.count(char) for char in word}
print("Character count:", char_count)

# 集合推导式
unique_chars = {char for char in "programming"}
print("Unique chars:", sorted(unique_chars))

# 生成器表达式
gen = (x**2 for x in range(5))
print("Generator:", list(gen))
