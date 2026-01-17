# @lewin671/python-vm

[![License](https://img.shields.io/github/license/Lewin671/python-compiler-ts)](https://github.com/Lewin671/python-compiler-ts/blob/main/LICENSE)
[![NPM Version](https://img.shields.io/npm/v/@lewin671/python-vm)](https://www.npmjs.com/package/@lewin671/python-vm)

A high-performance Python compiler and Virtual Machine (VM) implemented entirely in TypeScript. This project aims to provide a robust, Python-compliant execution environment within the JavaScript ecosystem, featuring a complete compilation pipeline from source code to bytecode.

[简体中文](README_zh-CN.md)

## 🚀 Key Highlights

- **Advanced Compilation Pipeline**: Moves beyond simple interpretation by implementing a multi-stage pipeline: Source → Tokens → AST → Control Flow Graph (CFG) → Linear Bytecode → VM.
- **Python-Strict Semantics**: Carefully implemented data structures (`PyDict`, `PySet`, `PyList`) that strictly follow Python's rules for equality, hashing, and numeric types (including BigInt for arbitrary-precision integers and NaN handling).
- **Comprehensive Language Support**:
  - **Core**: Full support for functions, classes, closures, and decorators.
  - **Modern Features**: Includes `match` statements (Structural Pattern Matching), `with` statements (Context Managers), and `try/except/finally` blocks.
  - **Control Flow**: Robust handling of generators (`yield`), list/dict/set comprehensions, and nested scopes (`global`, `nonlocal`).
- **Production-Ready Tooling**: Includes a high-fidelity Lexer with indentation/dedentation logic, a recursive descent Parser, and a stack-based VM.

## 🛠 Features

### Compiler & VM
- [x] **Lexer**: Handles complex Python indentation, f-strings, and multi-line literals.
- [x] **Parser**: Generates a typed AST supporting a wide subset of Python 3.10+ syntax.
- [x] **CFG Builder**: Optimizes code structures into a Control Flow Graph before bytecode generation.
- [x] **Bytecode Virtual Machine**: A stack-based execution engine with local/global scope management.
- [x] **Exception System**: Full traceback support and Python-compliant exception hierarchy.

### Standard Library & Built-ins
- **Data Types**: `int`, `float`, `str`, `bool`, `list`, `tuple`, `dict`, `set`, `None`.
- **Iteration**: `range`, `enumerate`, `zip`, `reversed`, `map`, `filter`, `sorted`.
- **Utilities**: `abs`, `round`, `sum`, `min`, `max`, `isinstance`, `type`, `print`, `open`, `next`.

## 📦 Installation

```bash
npm install @lewin671/python-vm
```

## 📖 Usage

### Running via CLI

After cloning the repository, you can run Python files directly:

```bash
npm run build
npm start -- examples/hello.py
```

### Using in your TypeScript project

```ts
import { PythonCompiler } from '@lewin671/python-vm';

const compiler = new PythonCompiler();

// Execute code directly
const result = compiler.run(`
def greet(name):
    return f"Hello, {name}!"

result = [greet(x) for x in ["World", "TypeScript"]]
print(result)
`);

// Or run a file
// compiler.runFile('./script.py');
```

## 🧪 Testing and Correctness

Correctness is a top priority. The project includes an extensive test suite using **Vitest** that compares the VM output against the system's CPython interpreter for parity.

```bash
# Run all tests (requires Python 3 installed locally)
npm test
```

## ⚖️ License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
