def lifecycle_gen():
    try:
        yield "start"
    except ValueError:
        yield "caught"
    finally:
        print("cleaned up")

print("--- Test Throw ---")
g1 = lifecycle_gen()
print(next(g1))
print(g1.throw(ValueError))
try:
    next(g1)
except StopIteration:
    pass

print("\n--- Test Close ---")
g2 = lifecycle_gen()
print(next(g2))
g2.close()
print("closed")