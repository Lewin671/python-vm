/**
 * Python Compiler - 主入口
 * 用于编译和执行 Python 代码
 */

import { Lexer } from './lexer';
import { Parser } from './parser';
import { Compiler } from './compiler';
import { PyValue, VirtualMachine } from './vm';
import * as path from 'path';

export class PythonCompiler {
  /**
   * 编译并运行 Python 代码
   * @param code Python 源代码
   * @returns 执行结果
   */
  run(code: string): PyValue {
    // 1. 词法分析
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();

    // 2. 语法分析
    const parser = new Parser(tokens);
    const ast = parser.parse();

    // 3. 编译到字节码
    const compiler = new Compiler();
    const bytecode = compiler.compile(ast);

    // 4. 执行字节码
    const vm = new VirtualMachine([process.cwd()]);
    const result = vm.execute(bytecode);

    return result;
  }

  /**
   * 运行 Python 文件
   * @param filePath 文件路径
   * @returns 执行结果
   */
  runFile(filePath: string): PyValue {
    const fs = require('fs');
    const code = fs.readFileSync(filePath, 'utf-8');
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const compiler = new Compiler();
    const bytecode = compiler.compile(ast);
    const vm = new VirtualMachine([path.dirname(filePath), process.cwd()]);
    return vm.execute(bytecode);
  }
}

// 重新导出类型，供外部使用
export * from './types';
