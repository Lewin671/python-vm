# 项目设置和测试说明

## 项目概览

这是一个用 TypeScript 实现的 Python 编译器项目。目前编译器核心功能尚未完全实现，使用方法壳来定义接口。

## 当前状态

### ✅ 已完成
- 项目结构搭建
- 配置文件（TypeScript, Jest, ESLint, Prettier）
- 编译器接口定义（方法壳）
- 完整的测试用例
- Python 示例脚本（可在 shell 中正常运行）

### 🚧 待实现
- 词法分析器（Tokenizer）
- 语法分析器（Parser）
- 编译器（Compiler）
- 虚拟机（VM）

## 快速开始

### 安装依赖
```bash
npm install
```

### 编译项目
```bash
npm run build
```

### 运行测试
```bash
npm test
```

**注意：** 测试预期会失败，因为编译器核心功能尚未实现。所有 24 个测试都会报错：
```
Error: Tokenizer not implemented yet
```

这是正常的！这表明：
1. 测试框架正常工作
2. 测试用例正确配置
3. 编译器接口定义完整
4. 现在可以开始实现各个模块

## 验证 Python 脚本

所有示例 Python 脚本都可以在 shell 中正常运行：

```bash
# Hello World
python3 examples/hello.py

# 数学运算
python3 examples/math.py

# 斐波那契数列
python3 examples/fibonacci.py

# 条件语句
python3 examples/conditions.py

# 循环
python3 examples/loops.py
```

## 项目结构

```
python-compiler-ts/
├── src/
│   ├── compiler.ts       # 编译器主类（方法壳）
│   └── index.ts          # CLI 入口
├── tests/
│   └── compiler.test.ts  # 24 个测试用例
├── examples/             # Python 示例脚本
│   ├── hello.py         # Hello World
│   ├── math.py          # 数学运算
│   ├── fibonacci.py     # 递归函数
│   ├── conditions.py    # 条件语句
│   └── loops.py         # 循环语句
├── dist/                # 编译输出（npm run build）
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

## 测试覆盖范围

测试用例涵盖以下 Python 特性：

1. **Hello World** (2 tests)
   - 简单的 print 语句
   - 运行 hello.py 文件

2. **变量和算术运算** (3 tests)
   - 变量赋值
   - 基本算术运算
   - 运行 math.py 文件

3. **函数** (4 tests)
   - 函数定义
   - 函数调用
   - 递归函数
   - 运行 fibonacci.py 文件

4. **控制流** (3 tests)
   - if 语句
   - if-elif-else 语句
   - 运行 conditions.py 文件

5. **循环** (4 tests)
   - for 循环（range）
   - while 循环
   - 列表迭代
   - 运行 loops.py 文件

6. **数据类型** (5 tests)
   - 整数
   - 浮点数
   - 字符串
   - 布尔值
   - 列表

7. **运算符** (3 tests)
   - 算术运算符（+, -, *, /, %, **）
   - 比较运算符（==, !=, <, >, <=, >=）
   - 逻辑运算符（and, or, not）

**总计：24 个测试用例，全部预期失败**

## 下一步

1. 实现 `tokenize()` 方法 - 词法分析
2. 实现 `parse()` 方法 - 语法分析
3. 实现 `compile()` 方法 - 编译到字节码
4. 实现 `execute()` 方法 - 虚拟机执行
5. 逐步通过测试用例

## 开发命令

```bash
# 开发模式（监听文件变化）
npm run dev

# 运行测试（监听模式）
npm run test:watch

# 测试覆盖率
npm run test:coverage

# 代码检查
npm run lint

# 代码格式化
npm run format
```

## 贡献指南

1. 从简单的功能开始实现（如：整数字面量、变量赋值）
2. 确保每次实现后运行测试
3. 逐步增加复杂度
4. 保持代码整洁和文档更新

祝你编码愉快！🚀
