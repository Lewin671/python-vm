# python-compiler-ts

A Python compiler and interpreter implemented in TypeScript. The compiler currently packages the AST into a bytecode container that the VM executes.

[简体中文](README_zh-CN.md)

## Features

- [x] CLI entry point for running `.py` files
- [x] Lexer with indentation handling, numbers, strings (including f-strings), keywords, and operators
- [x] Parser that builds ASTs for statements and expressions (functions, classes, loops, comprehensions, exceptions, and more)
- [x] Bytecode compiler scaffold that passes ASTs to the VM
- [x] AST-based virtual machine with scopes, control flow, functions, classes, generators, context managers, and exceptions
- [x] Python data structures including lists, tuples, dicts, sets, slicing, and comprehensions
- [x] Built-ins:
  - Type/conversion: int, float, str, bool, list, tuple, set, type, isinstance
  - Iteration: range, enumerate, zip, sorted, reversed, map, filter, next
  - Math/util: abs, round, sum, min, max
  - I/O: print, open
- [x] Example scripts and Vitest suite that compare output against system Python

## Getting Started

### Requirements

- Node.js 18+
- npm
- Python 3 available on your PATH for tests (set `PYTHON=python3` if needed)

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

If the tests cannot find Python, set the environment variable before running them, for example: `export PYTHON=python3`.

### Run

```bash
npm run build
npm start -- examples/hello.py
```

Or run directly:

```bash
node dist/index.js examples/hello.py
```

### Use in TypeScript

```ts
import { PythonCompiler } from 'python-compiler-ts';

const compiler = new PythonCompiler();
const result = compiler.run('print("Hello from TypeScript")');

console.log(result);
```

## Project Structure

```
python-compiler-ts/
├── dist/                # Compiled output
├── examples/            # Sample Python programs used by tests
├── src/
│   ├── compiler.ts      # Public PythonCompiler API
│   ├── compiler_module/ # Bytecode compiler scaffold
│   ├── index.ts         # CLI entry + exports
│   ├── lexer/           # Tokenizer
│   ├── parser/          # AST parser
│   ├── types/           # Tokens, AST, bytecode types
│   └── vm/              # AST interpreter (virtual machine)
├── tests/               # Vitest suites comparing against CPython
├── package.json
└── tsconfig.json
```
