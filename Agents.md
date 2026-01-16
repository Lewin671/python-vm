# Python 编译器架构设计指南

## 概述

本项目是一个用 TypeScript 实现的 Python 编译器和解释器。采用经典的编译器架构，分为四个主要阶段：**词法分析 → 语法分析 → 编译 → 执行**。本文档旨在指导开发者理解架构设计原则，确保代码的模块化和可维护性。

## 核心架构

```
源代码 (Python)
    ↓
  Lexer (词法分析)  → Tokens
    ↓
  Parser (语法分析)  → AST
    ↓
  Compiler (编译)    → ByteCode
    ↓
  VirtualMachine (执行) → 结果
```
