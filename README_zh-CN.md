# python-compiler-ts

一个使用 TypeScript 实现的 Python 编译器与解释器。目前编译器会将 AST 打包到字节码容器中，由虚拟机执行。

[English](README.md)

## 功能特性

- [x] CLI 入口，用于运行 `.py` 文件
- [x] 具备缩进处理、数字/字符串（含 f-string）、关键字与运算符的词法分析器
- [x] 语法分析器生成 AST，覆盖函数、类、循环、推导式、异常等语句与表达式
- [x] 字节码编译器框架，将 AST 交给虚拟机执行
- [x] 基于 AST 的虚拟机，支持作用域、控制流、函数、类、生成器、上下文管理器与异常
- [x] Python 数据结构支持：list、tuple、dict、set、切片与推导式
- [x] 内置函数：
  - 类型/转换：int、float、str、bool、list、tuple、set、type、isinstance
  - 迭代相关：range、enumerate、zip、sorted、reversed、map、filter、next
  - 数值/工具：abs、round、sum、min、max
  - 输入输出：print、open
- [x] 示例脚本与 Vitest 测试，输出对比系统 Python

## 快速开始

### 环境要求

- Node.js 18+
- npm
- Python 3（运行测试需要，确保在 PATH 中；必要时设置 `PYTHON=python3`）

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build
```

### 测试

```bash
npm test
```

如果测试无法找到 Python，可先设置环境变量，例如：`export PYTHON=python3`。

### 运行

```bash
npm run build
npm start -- examples/hello.py
```

或直接运行：

```bash
node dist/index.js examples/hello.py
```

### 在 TypeScript 中调用

运行 `npm run build` 后，可以在 TypeScript 中这样调用：

```ts
import { PythonCompiler } from './dist';

const compiler = new PythonCompiler();
const result = compiler.run('print("Hello from TypeScript")');

console.log(result);
```

## 项目结构

```
python-compiler-ts/
├── dist/                # 编译输出
├── examples/            # 测试用 Python 示例
├── src/
│   ├── compiler.ts      # PythonCompiler 公共 API
│   ├── compiler_module/ # 字节码编译器框架
│   ├── index.ts         # CLI 入口 + 导出
│   ├── lexer/           # 词法分析器
│   ├── parser/          # 语法分析器
│   ├── types/           # Token/AST/字节码类型
│   └── vm/              # AST 解释执行器
├── tests/               # 与 CPython 对比的 Vitest 测试
├── package.json
└── tsconfig.json
```
