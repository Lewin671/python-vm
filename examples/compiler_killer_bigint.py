# Exploit: bool is a subclass of int; indexing should treat True as 1
arr = [10, 20]
print(arr[True])
