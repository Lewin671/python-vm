# 条件语句示例
def check_number(num):
    if num > 0:
        print(f"{num} is positive")
    elif num < 0:
        print(f"{num} is negative")
    else:
        print(f"{num} is zero")

# 测试不同的数字
check_number(10)
check_number(-5)
check_number(0)
