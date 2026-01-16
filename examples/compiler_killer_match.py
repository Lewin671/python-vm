def classify(value):
    match value:
        case 0 | 1:
            return "small"
        case [a, b]:
            return a + b
        case _:
            return "other"


print(classify([2, 3]))
print(classify(1))
print(classify("x"))
