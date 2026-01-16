# Python Compiler Architecture (TypeScript)

## Overview

This project is a Python compiler + interpreter written in TypeScript.
It follows a classic 4-stage pipeline:

**Lex → Parse → Compile → Execute**

Goal: keep the system **modular, testable, and easy to extend.**

## Architecture

```
Python Source
     ↓
Lexer        → Tokens
     ↓
Parser       → AST
     ↓
Compiler     → Bytecode
     ↓
VM           → Result
```

Each stage must:

* Do one job only
* Have clear input/output types
* Avoid cross-stage coupling

## Engineering Rules

### 1. 500-Line Rule

* **Hard limit:** No `.ts` file over **500 lines**
* **Refactor early:** At **400 lines**, start splitting
* **Why:**

  * Easier to read and review
  * Faster debugging
  * Better AI/code-assist context

### 2. Modularity

* One file = one main responsibility
* No “god files”
* Shared logic goes into `utils/` or `common/`

### 3. Stage Isolation

* Lexer never touches AST
* Parser never emits bytecode
* Compiler never executes
* VM never parses

Each layer talks only through well-defined data structures.

### 4. Test by Stage

* Unit test each stage independently:

  * Lexer → tokens
  * Parser → AST
  * Compiler → bytecode
  * VM → runtime result
