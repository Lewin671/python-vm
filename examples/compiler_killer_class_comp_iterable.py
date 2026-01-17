# Exploit Hypothesis: The outermost iterable of a comprehension should be evaluated in the enclosing scope. 
# In a class definition, this means it should be able to see class variables.
class A:
    val = "success"
    result = [x for x in [val]]
    print(result[0])
