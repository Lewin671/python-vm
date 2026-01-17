# Exploit: Python should ignore newlines within brackets (implicit line joining).
l = [
    1,
    2
]
print(len(l))
print(l)
