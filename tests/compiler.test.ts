import { PythonCompiler } from '../src/compiler';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const pythonCommandCandidates = [
  process.env.PYTHON,
  'python3',
  'python',
].filter(Boolean) as string[];

const runPython = (code: string): string => {
  let lastError: unknown;
  for (const cmd of pythonCommandCandidates) {
    try {
      return execFileSync(cmd, ['-c', code], { encoding: 'utf8' });
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to execute Python interpreter. Tried: ${pythonCommandCandidates.join(', ')}. ` +
      `Last error: ${String(lastError)}`
  );
};

const runPythonFile = (filePath: string): string => {
  const code = fs.readFileSync(filePath, 'utf8');
  return runPython(code);
};

const runCompilerWithOutput = (fn: () => void): string => {
  const outputChunks: string[] = [];
  const logSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    outputChunks.push(`${args.join(' ')}\n`);
  });
  const writeSpy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: any, encoding?: any, cb?: any) => {
      const normalized =
        typeof chunk === 'string' ? chunk : chunk.toString(encoding ?? 'utf8');
      outputChunks.push(normalized);
      if (typeof encoding === 'function') {
        encoding();
      } else if (typeof cb === 'function') {
        cb();
      }
      return true;
    });

  try {
    fn();
  } finally {
    logSpy.mockRestore();
    writeSpy.mockRestore();
  }

  return outputChunks.join('');
};

describe('PythonCompiler', () => {
  let compiler: PythonCompiler;

  beforeEach(() => {
    compiler = new PythonCompiler();
  });

  describe('Hello World', () => {
    it('should execute simple print statement', () => {
      const code = 'print("Hello, World!")';
      const expectedOutput = runPython(code);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.run(code);
      });
      expect(actualOutput).toBe(expectedOutput);
    });

    it('should run hello.py example', () => {
      const filePath = path.join(__dirname, '../examples/hello.py');
      const expectedOutput = runPythonFile(filePath);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.runFile(filePath);
      });
      expect(actualOutput).toBe(expectedOutput);
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
      const expectedOutput = runPythonFile(filePath);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.runFile(filePath);
      });
      expect(actualOutput).toBe(expectedOutput);
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
      const expectedOutput = runPythonFile(filePath);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.runFile(filePath);
      });
      expect(actualOutput).toBe(expectedOutput);
    });
  });

  describe('Control Flow', () => {
    it('should handle if statement', () => {
      const code = `
x = 10
if x > 0:
    print("positive")
`;
      const expectedOutput = runPython(code);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.run(code);
      });
      expect(actualOutput).toBe(expectedOutput);
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
      const expectedOutput = runPython(code);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.run(code);
      });
      expect(actualOutput).toBe(expectedOutput);
    });

    it('should run conditions.py example', () => {
      const filePath = path.join(__dirname, '../examples/conditions.py');
      const expectedOutput = runPythonFile(filePath);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.runFile(filePath);
      });
      expect(actualOutput).toBe(expectedOutput);
    });
  });

  describe('Loops', () => {
    it('should handle for loop with range', () => {
      const code = `
for i in range(5):
    print(i)
`;
      const expectedOutput = runPython(code);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.run(code);
      });
      expect(actualOutput).toBe(expectedOutput);
    });

    it('should handle while loop', () => {
      const code = `
count = 0
while count < 5:
    print(count)
    count += 1
`;
      const expectedOutput = runPython(code);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.run(code);
      });
      expect(actualOutput).toBe(expectedOutput);
    });

    it('should handle list iteration', () => {
      const code = `
numbers = [1, 2, 3, 4, 5]
for num in numbers:
    print(num)
`;
      const expectedOutput = runPython(code);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.run(code);
      });
      expect(actualOutput).toBe(expectedOutput);
    });

    it('should run loops.py example', () => {
      const filePath = path.join(__dirname, '../examples/loops.py');
      const expectedOutput = runPythonFile(filePath);
      const actualOutput = runCompilerWithOutput(() => {
        compiler.runFile(filePath);
      });
      expect(actualOutput).toBe(expectedOutput);
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
