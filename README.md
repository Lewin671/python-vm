# python-compiler-ts
🐍 一个用 TypeScript 实现的 Python 编译器和解释器

## 项目简介

本项目旨在使用 TypeScript 实现一个完整的 Python 编译器，能够解析、编译和执行 Python 脚本。这是一个学习编译原理和 Python 语言特性的优秀项目。

## 功能特性

- 🚧 Python 词法分析器（Lexer）
- 🚧 Python 语法分析器（Parser）
- 🚧 抽象语法树（AST）生成
- 🚧 字节码编译器（开发中）
- 🚧 虚拟机执行器（开发中）
- 🚧 内置函数支持（开发中）

### 支持的 Python 特性

- [ ] 基本数据类型（int, float, str, bool）
- [ ] 变量声明和赋值
- [ ] 算术运算（+, -, *, /, %, **）
- [ ] 比较运算（==, !=, <, >, <=, >=）
- [ ] 逻辑运算（and, or, not）
- [ ] 条件语句（if/elif/else）
- [ ] 循环语句（for, while）
- [ ] 函数定义和调用
- [ ] 列表、元组、字典
- [ ] 类和对象

## 安装

```bash
# 克隆项目
git clone https://github.com/yourusername/python-compiler-ts.git
cd python-compiler-ts

# 安装依赖
npm install

# 构建项目
npm run build
```

## 使用方法

### 运行 Python 脚本

```bash
# 直接运行 Python 文件
npm start examples/hello.py

# 或使用 node
node dist/index.js examples/hello.py
```

### 作为库使用

```typescript
import { PythonCompiler } from './src/compiler';

const compiler = new PythonCompiler();
const code = `
print("Hello, World!")
x = 10
y = 20
print(x + y)
`;

const result = compiler.run(code);
console.log(result);
```

## 开发

```bash
# 开发模式（监听文件变化）
npm run dev

# 运行测试
npm test

# 运行测试（监听模式）
npm run test:watch

# 代码格式化
npm run format

# 代码检查
npm run lint
```

## 项目结构

```
python-compiler-ts/
├── src/
│   ├── lexer/          # 词法分析器
│   ├── parser/         # 语法分析器
│   ├── ast/            # AST 节点定义
│   ├── compiler/       # 编译器
│   ├── vm/             # 虚拟机
│   └── index.ts        # 入口文件
├── tests/              # 测试文件
├── examples/           # Python 示例脚本
└── README.md
```

## 示例

### Hello World

```python
# examples/hello.py
print("Hello, World!")
```

### 变量和运算

```python
# examples/math.py
x = 10
y = 20
result = x + y
print(f"Result: {result}")
```

### 函数

```python
# examples/function.py
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
```

## 技术栈

- TypeScript 5.x
- Node.js 18+
- Jest (测试框架)
- ESLint (代码检查)
- Prettier (代码格式化)

## 路线图

- [x] 项目初始化和框架搭建
- [ ] 实现词法分析器（Lexer）
- [ ] 实现语法分析器（Parser）
- [ ] 实现 AST 生成
- [ ] 实现字节码编译
- [ ] 实现虚拟机（VM）
- [ ] 支持基本数据类型
- [ ] 支持控制流语句
- [ ] 支持函数
- [ ] 支持类和对象
- [ ] 性能优化
- [ ] 完善文档

## 贡献

欢迎贡献代码、报告问题或提出建议！

## 许可证

MIT

## 参考资料

- [Python 官方文档](https://docs.python.org/)
- [Python 语言参考](https://docs.python.org/3/reference/)
- [编译原理龙书](https://en.wikipedia.org/wiki/Compilers:_Principles,_Techniques,_and_Tools)