def trace(val):
    print(f"load {val}")
    return val

print("--- Test 1: Success (1 < 2 < 3) ---")
# Expect: load 1, load 2, load 3, True
print(trace(1) < trace(2) < trace(3))

print("\n--- Test 2: Short-circuit (3 < 2 < 1) ---")
# Expect: load 3, load 2, False (1 is NEVER loaded)
print(trace(3) < trace(2) < trace(1))
