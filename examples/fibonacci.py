# 斐波那契数列
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# 计算前10个斐波那契数
for i in range(10):
    result = fibonacci(i)
    print(f"fibonacci({i}) = {result}")
