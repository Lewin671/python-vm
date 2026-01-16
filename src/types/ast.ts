/**
 * AST 节点类型定义
 */
export interface ASTNode {
  type: string;
  [key: string]: any;
}

export enum ASTNodeType {
  PROGRAM = 'Program',
  ASSIGNMENT = 'Assignment',
  AUG_ASSIGNMENT = 'AugAssignment',
  EXPRESSION_STATEMENT = 'ExpressionStatement',
  IF_STATEMENT = 'IfStatement',
  WHILE_STATEMENT = 'WhileStatement',
  FOR_STATEMENT = 'ForStatement',
  FUNCTION_DEF = 'FunctionDef',
  RETURN_STATEMENT = 'ReturnStatement',
  BREAK_STATEMENT = 'BreakStatement',
  CONTINUE_STATEMENT = 'ContinueStatement',
  PASS_STATEMENT = 'PassStatement',
  CLASS_DEF = 'ClassDef',
  TRY_STATEMENT = 'TryStatement',
  WITH_STATEMENT = 'WithStatement',
  ASSERT_STATEMENT = 'AssertStatement',
  RAISE_STATEMENT = 'RaiseStatement',
  GLOBAL_STATEMENT = 'GlobalStatement',
  NONLOCAL_STATEMENT = 'NonlocalStatement',
  DELETE_STATEMENT = 'DeleteStatement',

  BINARY_OPERATION = 'BinaryOperation',
  UNARY_OPERATION = 'UnaryOperation',
  NUMBER_LITERAL = 'NumberLiteral',
  STRING_LITERAL = 'StringLiteral',
  BOOLEAN_LITERAL = 'BooleanLiteral',
  NONE_LITERAL = 'NoneLiteral',
  LIST_LITERAL = 'ListLiteral',
  TUPLE_LITERAL = 'TupleLiteral',
  DICT_LITERAL = 'DictLiteral',
  SET_LITERAL = 'SetLiteral',
  IDENTIFIER = 'Identifier',
  ATTRIBUTE = 'Attribute',
  SUBSCRIPT = 'Subscript',
  SLICE = 'Slice',
  CALL = 'Call',
  COMPARE = 'Compare',
  BOOL_OPERATION = 'BoolOperation',
  IF_EXPRESSION = 'IfExpression',
  LAMBDA = 'Lambda',
  LIST_COMP = 'ListComp',
  DICT_COMP = 'DictComp',
  SET_COMP = 'SetComp',
  GENERATOR_EXPR = 'GeneratorExpr',
  YIELD = 'Yield',
}
