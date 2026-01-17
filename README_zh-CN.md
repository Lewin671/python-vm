# @lewin671/python-vm

[![License](https://img.shields.io/github/license/Lewin671/python-compiler-ts)](https://github.com/Lewin671/python-compiler-ts/blob/main/LICENSE)
[![NPM Version](https://img.shields.io/npm/v/@lewin671/python-vm)](https://www.npmjs.com/package/@lewin671/python-vm)

一个完全使用 TypeScript 实现的高性能 Python 编译器与虚拟机 (VM)。本项目旨在为 JavaScript 生态提供一个鲁棒且符合 Python 语义的执行环境，包含从源码到字节码的完整编译流水线。

[English](README.md)

## 🚀 项目亮点

- **先进的编译流水线**：超越简单的解释执行，实现了多阶段编译流程：源码 → Token 流 → AST (抽象语法树) → CFG (控制流图) → 线性字节码 → 虚拟机执行。
- **严格的 Python 语义**：精心实现的数据结构（`PyDict`, `PySet`, `PyList`）严格遵循 Python 关于等值性、哈希计算以及数值类型的规则（支持大整数 BigInt 和完整的 NaN 处理逻辑）。
- **全面的语言支持**：
  - **核心语法**：完整支持函数、类、闭包及装饰器。
  - **现代特性**：包括 `match` 语句（结构化模式匹配）、`with` 语句（上下文管理器）以及 `try/except/finally` 异常处理块。
  - **控制流**：支持生成器 (`yield`)、列表/字典/集合推导式，以及复杂的嵌套作用域（`global`, `nonlocal`）。
- **工程化实现**：配备了支持缩进逻辑的高精度词法分析器 (Lexer)、递归下降语法分析器 (Parser) 以及一个高效的基于栈的虚拟机 (VM)。

## 🛠 功能特性

### 编译器与虚拟机
- [x] **词法分析器 (Lexer)**：处理复杂的 Python 缩进/反缩进、f-strings 以及多行字面量。
- [x] **语法分析器 (Parser)**：生成的类型化 AST 覆盖了 Python 3.10+ 的绝大部分常用语法。
- [x] **控制流图构建器 (CFG Builder)**：在生成字节码前优化代码结构。
- [x] **字节码虚拟机**：支持局部/全局作用域管理、调用栈以及高效的指令集执行。
- [x] **异常系统**：提供完整的 Traceback 支持和符合 Python 规范的异常层级。

### 标准库与内置函数
- **数据类型**：`int` (任意精度), `float`, `str`, `bool`, `list`, `tuple`, `dict`, `set`, `None`。
- **迭代工具**：`range`, `enumerate`, `zip`, `reversed`, `map`, `filter`, `sorted`。
- **内置工具**：`abs`, `round`, `sum`, `min`, `max`, `isinstance`, `type`, `print`, `open`, `next`。

## 📦 安装使用

```bash
npm install @lewin671/python-vm
```

## 📖 使用指南

### 通过命令行运行

克隆仓库后，您可以直接运行 Python 文件：

```bash
npm run build
npm start -- examples/hello.py
```

### 在 TypeScript 项目中调用

```ts
import { PythonCompiler } from '@lewin671/python-vm';

const compiler = new PythonCompiler();

// 直接执行代码
const result = compiler.run(`
def greet(name):
    return f"Hello, {name}!"

result = [greet(x) for x in ["World", "TypeScript"]]
print(result)
`);

// 或者运行文件
// compiler.runFile('./script.py');
```

## 🧪 测试与正确性

正确性是本项目的核心指标。我们使用 **Vitest** 构建了庞大的测试套件，通过将虚拟机的输出与系统原生的 CPython 解释器进行对比，确保执行结果的一致性。

```bash
# 运行所有测试（需要本地安装 Python 3）
npm test
```

## ⚖️ 开源协议

本项目基于 MIT 协议开源 - 详见 [LICENSE](LICENSE) 文件。
