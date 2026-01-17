# Exploit: Parser misidentifies expression statements starting with '[' as assignment targets.
[x for x in [1, 2, 3]]
print("Success")