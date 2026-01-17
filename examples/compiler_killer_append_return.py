# list.append should be a callable method and return None.
# This VM crashes with "TypeError: object is not callable" or returns wrong values.
L = []
print(L.append(1))
print(L.append(2))
