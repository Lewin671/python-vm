import { ASTNode, ASTNodeType, ByteCode, OpCode } from '../types';

/**
 * 编译器 - 将 AST 编译为字节码
 */
export class Compiler {
  compile(ast: ASTNode): ByteCode {
    if (ast.type !== ASTNodeType.PROGRAM) {
      throw new Error(`Expected Program node, got ${ast.type}`);
    }

    return {
      instructions: [],
      constants: [],
      names: [],
      ast
    };
  }
}
