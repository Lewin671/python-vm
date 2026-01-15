import { PythonCompiler } from '../src/compiler';
import * as fs from 'fs';
import * as path from 'path';

describe('PythonCompiler', () => {
  let compiler: PythonCompiler;

  beforeEach(() => {
    compiler = new PythonCompiler();
  });

  describe('Hello World', () => {
    it('should execute simple print statement', () => {
      const code = 'print("Hello, World!")';
      const result = compiler.run(code);
      expect(result).toBeUndefined(); // print 返回 undefined
    });

    it('should run hello.py example', () => {
      const filePath = path.join(__dirname, '../examples/hello.py');
      expect(() => {
        compiler.runFile(filePath);
      }).not.toThrow();
    });
  });

  describe('Variables and Arithmetic', () => {
    it('should handle variable assignment', () => {
      const code = `
x = 10
y = 20
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle basic arithmetic operations', () => {
      const code = `
x = 10
y = 20
result = x + y
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should run math.py example', () => {
      const filePath = path.join(__dirname, '../examples/math.py');
      expect(() => {
        compiler.runFile(filePath);
      }).not.toThrow();
    });
  });

  describe('Functions', () => {
    it('should handle function definition', () => {
      const code = `
def add(a, b):
    return a + b
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle function call', () => {
      const code = `
def add(a, b):
    return a + b

result = add(5, 3)
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle recursive functions', () => {
      const code = `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

result = fibonacci(5)
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should run fibonacci.py example', () => {
      const filePath = path.join(__dirname, '../examples/fibonacci.py');
      expect(() => {
        compiler.runFile(filePath);
      }).not.toThrow();
    });
  });

  describe('Control Flow', () => {
    it('should handle if statement', () => {
      const code = `
x = 10
if x > 0:
    print("positive")
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle if-elif-else statement', () => {
      const code = `
x = 0
if x > 0:
    print("positive")
elif x < 0:
    print("negative")
else:
    print("zero")
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should run conditions.py example', () => {
      const filePath = path.join(__dirname, '../examples/conditions.py');
      expect(() => {
        compiler.runFile(filePath);
      }).not.toThrow();
    });
  });

  describe('Loops', () => {
    it('should handle for loop with range', () => {
      const code = `
for i in range(5):
    print(i)
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle while loop', () => {
      const code = `
count = 0
while count < 5:
    print(count)
    count += 1
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle list iteration', () => {
      const code = `
numbers = [1, 2, 3, 4, 5]
for num in numbers:
    print(num)
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should run loops.py example', () => {
      const filePath = path.join(__dirname, '../examples/loops.py');
      expect(() => {
        compiler.runFile(filePath);
      }).not.toThrow();
    });
  });

  describe('Data Types', () => {
    it('should handle integers', () => {
      const code = 'x = 42';
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle floats', () => {
      const code = 'x = 3.14';
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle strings', () => {
      const code = 'x = "hello"';
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle booleans', () => {
      const code = 'x = True';
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle lists', () => {
      const code = 'x = [1, 2, 3, 4, 5]';
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });
  });

  describe('Operators', () => {
    it('should handle arithmetic operators', () => {
      const code = `
a = 10 + 5
b = 10 - 5
c = 10 * 5
d = 10 / 5
e = 10 % 3
f = 2 ** 3
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle comparison operators', () => {
      const code = `
a = 5 == 5
b = 5 != 3
c = 5 > 3
d = 5 < 10
e = 5 >= 5
f = 5 <= 5
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });

    it('should handle logical operators', () => {
      const code = `
a = True and False
b = True or False
c = not True
`;
      expect(() => {
        compiler.run(code);
      }).not.toThrow();
    });
  });
});
