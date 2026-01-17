print("--- Tuple List Aug-Assign ---")
t = ([10],)
try:
    t[0] += [20]
except TypeError:
    print("Success: TypeError caught")
except Exception as e:
    print(f"Failure: Wrong error {type(e).__name__}")
else:
    print("Failure: No error raised")

print(f"State: {t}")