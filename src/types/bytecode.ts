/**
 * 字节码类型定义
 */
export interface ByteCode {
  instructions: Instruction[];
  constants: any[];
  names: string[];
  ast?: any;
}

export interface Instruction {
  opcode: OpCode;
  arg?: number;
}

export enum OpCode {
  // Loading and storing
  LOAD_CONST,
  LOAD_NAME,
  STORE_NAME,

  // Binary operations
  BINARY_ADD,
  BINARY_SUBTRACT,
  BINARY_MULTIPLY,
  BINARY_DIVIDE,
  BINARY_MODULO,
  BINARY_POWER,

  // Comparison operations
  COMPARE_EQ,
  COMPARE_NE,
  COMPARE_LT,
  COMPARE_GT,
  COMPARE_LE,
  COMPARE_GE,

  // Logical operations
  LOGICAL_AND,
  LOGICAL_OR,
  LOGICAL_NOT,

  // Function calls
  CALL_FUNCTION,
  RETURN_VALUE,

  // Print
  PRINT_ITEM,
  PRINT_NEWLINE,
}
