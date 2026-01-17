/**
 * 字节码类型定义
 */
export interface ByteCode {
  instructions: Instruction[];
  constants: any[];
  names: string[];
  varnames: string[]; // 局部变量名
  argcount: number;   // 参数个数
  params?: any[];     // 参数定义
  filename?: string;
  name?: string;      // 函数名或代码块名
  globals?: string[];
  nonlocals?: string[];
}

export interface Instruction {
  opcode: OpCode;
  arg?: number;
  offset?: number;    // 指令在字节码序列中的偏移量
}

export enum OpCode {
  // Loading and storing
  LOAD_CONST,
  LOAD_NAME,
  STORE_NAME,
  DELETE_NAME,

  LOAD_FAST,   // 局部变量
  STORE_FAST,
  DELETE_FAST,

  LOAD_GLOBAL,
  STORE_GLOBAL,
  DELETE_GLOBAL,

  LOAD_ATTR,
  STORE_ATTR,
  DELETE_ATTR,

  LOAD_SUBSCR,
  STORE_SUBSCR,
  DELETE_SUBSCR,

  // Stack operations
  POP_TOP,
  DUP_TOP,
  DUP_TOP_TWO,
  ROT_TWO,
  ROT_THREE,

  // Binary operations
  BINARY_ADD,
  BINARY_SUBTRACT,
  BINARY_MULTIPLY,
  BINARY_DIVIDE,
  BINARY_FLOOR_DIVIDE,
  BINARY_MODULO,
  BINARY_POWER,
  BINARY_LSHIFT,
  BINARY_RSHIFT,
  BINARY_AND,
  BINARY_XOR,
  BINARY_OR,

  // In-place operations
  INPLACE_ADD,
  INPLACE_SUBTRACT,
  INPLACE_MULTIPLY,
  INPLACE_DIVIDE,
  INPLACE_FLOOR_DIVIDE,
  INPLACE_MODULO,
  INPLACE_POWER,
  INPLACE_LSHIFT,
  INPLACE_RSHIFT,
  INPLACE_AND,
  INPLACE_XOR,
  INPLACE_OR,

  // Unary operations
  UNARY_POSITIVE,
  UNARY_NEGATIVE,
  UNARY_NOT,
  UNARY_INVERT,

  // Comparison operations
  COMPARE_OP, // 使用 arg 表示具体的比较操作

  // Jump operations
  JUMP_FORWARD,
  JUMP_ABSOLUTE,
  POP_JUMP_IF_FALSE,
  POP_JUMP_IF_TRUE,
  JUMP_IF_FALSE_OR_POP,
  JUMP_IF_TRUE_OR_POP,

  // Collection literals
  BUILD_LIST,
  BUILD_TUPLE,
  BUILD_SET,
  BUILD_MAP,
  BUILD_SLICE,
  UNPACK_SEQUENCE,
  UNPACK_EX,
  BUILD_CONST_KEY_MAP,

  // Container operations
  LIST_APPEND,
  SET_ADD,
  MAP_ADD,

  // Function calls and returns
  CALL_FUNCTION,
  CALL_FUNCTION_KW,
  CALL_FUNCTION_EX,
  MAKE_FUNCTION,
  RETURN_VALUE,
  YIELD_VALUE,

  // Iterators
  GET_ITER,
  FOR_ITER,

  // Exceptions and Context Managers
  SETUP_FINALLY,
  SETUP_WITH,
  WITH_EXCEPT_START,
  POP_BLOCK,
  RAISE_VARARGS,

  // Imports
  IMPORT_NAME,
  IMPORT_FROM,
  IMPORT_STAR,

  // Classes
  LOAD_BUILD_CLASS,

  // Print (Legacy/Helper)
  PRINT_ITEM,
  PRINT_NEWLINE,

  // Internal helpers
  EVAL_AST,
}

export enum CompareOp {
  LT = 0,
  LE = 1,
  EQ = 2,
  NE = 3,
  GT = 4,
  GE = 5,
  IN = 6,
  NOT_IN = 7,
  IS = 8,
  IS_NOT = 9,
}
