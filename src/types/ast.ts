export enum ASTNodeType {
  PROGRAM = 'Program',
  EXPRESSION_STATEMENT = 'ExpressionStatement',
  BINARY_OPERATION = 'BinaryOperation',
  UNARY_OPERATION = 'UnaryOperation',
  BOOL_OPERATION = 'BoolOperation',
  COMPARE = 'Compare',
  CALL = 'Call',
  ATTRIBUTE = 'Attribute',
  SUBSCRIPT = 'Subscript',
  IF_EXPRESSION = 'IfExpression',
  LIST_LITERAL = 'ListLiteral',
  TUPLE_LITERAL = 'TupleLiteral',
  DICT_LITERAL = 'DictLiteral',
  SET_LITERAL = 'SetLiteral',
  NUMBER_LITERAL = 'NumberLiteral',
  STRING_LITERAL = 'StringLiteral',
  BOOLEAN_LITERAL = 'BooleanLiteral',
  NONE_LITERAL = 'NoneLiteral',
  IDENTIFIER = 'Identifier',
  ASSIGNMENT = 'Assignment',
  AUG_ASSIGNMENT = 'AugAssignment',
  ASSERT_STATEMENT = 'AssertStatement',
  RAISE_STATEMENT = 'RaiseStatement',
  PASS_STATEMENT = 'PassStatement',
  BREAK_STATEMENT = 'BreakStatement',
  CONTINUE_STATEMENT = 'ContinueStatement',
  RETURN_STATEMENT = 'ReturnStatement',
  YIELD = 'Yield',
  GLOBAL_STATEMENT = 'GlobalStatement',
  NONLOCAL_STATEMENT = 'NonlocalStatement',
  DELETE_STATEMENT = 'DeleteStatement',
  IMPORT_STATEMENT = 'ImportStatement',
  IF_STATEMENT = 'IfStatement',
  WHILE_STATEMENT = 'WhileStatement',
  FOR_STATEMENT = 'ForStatement',
  TRY_STATEMENT = 'TryStatement',
  WITH_STATEMENT = 'WithStatement',
  FUNCTION_DEF = 'FunctionDef',
  CLASS_DEF = 'ClassDef',
  LAMBDA = 'Lambda',
  MATCH_STATEMENT = 'MatchStatement',
  MATCH_PATTERN_VALUE = 'MatchPatternValue',
  MATCH_PATTERN_WILDCARD = 'MatchPatternWildcard',
  MATCH_PATTERN_CAPTURE = 'MatchPatternCapture',
  MATCH_PATTERN_SEQUENCE = 'MatchPatternSequence',
  MATCH_PATTERN_OR = 'MatchPatternOr',
  LIST_COMP = 'ListComp',
  DICT_COMP = 'DictComp',
  SET_COMP = 'SetComp',
  GENERATOR_EXPR = 'GeneratorExpr',
  SLICE = 'Slice',
  STARRED = 'Starred',

  // Auxiliary types used in parser
  STAR_ARG = 'StarArg',
  KW_ARG = 'KwArg',
  KEYWORD_ARG = 'KeywordArg',
  VAR_ARG = 'VarArg',
  PARAM = 'Param',
  COMPREHENSION = 'Comprehension',
  KEY_VALUE = 'KeyValue',
}

export interface BaseASTNode<T extends ASTNodeType = ASTNodeType> {
  type: T;
  // Common metadata like source location can be added here
  lineno?: number;
  col_offset?: number;
}

export interface Program extends BaseASTNode<ASTNodeType.PROGRAM> {
  body: ASTNode[];
}

export interface ExpressionStatement extends BaseASTNode<ASTNodeType.EXPRESSION_STATEMENT> {
  expression: ASTNode;
}

export interface BinaryOperation extends BaseASTNode<ASTNodeType.BINARY_OPERATION> {
  left: ASTNode;
  right: ASTNode;
  operator: string;
}

export interface UnaryOperation extends BaseASTNode<ASTNodeType.UNARY_OPERATION> {
  operator: string;
  operand: ASTNode;
}

export interface BoolOperation extends BaseASTNode<ASTNodeType.BOOL_OPERATION> {
  operator: 'and' | 'or';
  values: ASTNode[];
}

export interface Compare extends BaseASTNode<ASTNodeType.COMPARE> {
  left: ASTNode;
  ops: string[];
  comparators: ASTNode[];
}

export interface Call extends BaseASTNode<ASTNodeType.CALL> {
  callee: ASTNode;
  args: ASTNode[];
}

export interface Attribute extends BaseASTNode<ASTNodeType.ATTRIBUTE> {
  object: ASTNode;
  name: string;
}

export interface Subscript extends BaseASTNode<ASTNodeType.SUBSCRIPT> {
  object: ASTNode;
  index: ASTNode;
}

export interface IfExpression extends BaseASTNode<ASTNodeType.IF_EXPRESSION> {
  test: ASTNode;
  consequent: ASTNode;
  alternate: ASTNode;
}

export interface ListLiteral extends BaseASTNode<ASTNodeType.LIST_LITERAL> {
  elements: ASTNode[];
}

export interface TupleLiteral extends BaseASTNode<ASTNodeType.TUPLE_LITERAL> {
  elements: ASTNode[];
}

export interface DictLiteral extends BaseASTNode<ASTNodeType.DICT_LITERAL> {
  entries: { key: ASTNode; value: ASTNode }[];
}

export interface SetLiteral extends BaseASTNode<ASTNodeType.SET_LITERAL> {
  elements: ASTNode[];
}

export interface NumberLiteral extends BaseASTNode<ASTNodeType.NUMBER_LITERAL> {
  value: string | number;
}

export interface StringLiteral extends BaseASTNode<ASTNodeType.STRING_LITERAL> {
  value: string;
}

export interface BooleanLiteral extends BaseASTNode<ASTNodeType.BOOLEAN_LITERAL> {
  value: boolean;
}

export interface NoneLiteral extends BaseASTNode<ASTNodeType.NONE_LITERAL> {
  value: null;
}

export interface Identifier extends BaseASTNode<ASTNodeType.IDENTIFIER> {
  name: string;
}

export interface Assignment extends BaseASTNode<ASTNodeType.ASSIGNMENT> {
  targets: ASTNode[];
  value: ASTNode;
}

export interface AugAssignment extends BaseASTNode<ASTNodeType.AUG_ASSIGNMENT> {
  target: ASTNode;
  operator: string;
  value: ASTNode;
}

export interface AssertStatement extends BaseASTNode<ASTNodeType.ASSERT_STATEMENT> {
  test: ASTNode;
  message: ASTNode | null;
}

export interface RaiseStatement extends BaseASTNode<ASTNodeType.RAISE_STATEMENT> {
  exception: ASTNode | null;
}

export interface PassStatement extends BaseASTNode<ASTNodeType.PASS_STATEMENT> {
}

export interface BreakStatement extends BaseASTNode<ASTNodeType.BREAK_STATEMENT> {
}

export interface ContinueStatement extends BaseASTNode<ASTNodeType.CONTINUE_STATEMENT> {
}

export interface ReturnStatement extends BaseASTNode<ASTNodeType.RETURN_STATEMENT> {
  value: ASTNode | null;
}

export interface Yield extends BaseASTNode<ASTNodeType.YIELD> {
  value: ASTNode | null;
}

export interface GlobalStatement extends BaseASTNode<ASTNodeType.GLOBAL_STATEMENT> {
  names: string[];
}

export interface NonlocalStatement extends BaseASTNode<ASTNodeType.NONLOCAL_STATEMENT> {
  names: string[];
}

export interface DeleteStatement extends BaseASTNode<ASTNodeType.DELETE_STATEMENT> {
  targets?: ASTNode[]; // CFGBuilder uses targets
  target?: ASTNode;    // parser uses target
}

export interface ImportStatement extends BaseASTNode<ASTNodeType.IMPORT_STATEMENT> {
  names: { name: string; alias: string | null; asname?: string | null }[];
}

export interface IfStatement extends BaseASTNode<ASTNodeType.IF_STATEMENT> {
  test: ASTNode;
  body: ASTNode[];
  elifs: { test: ASTNode; body: ASTNode[] }[];
  orelse: ASTNode[];
}

export interface WhileStatement extends BaseASTNode<ASTNodeType.WHILE_STATEMENT> {
  test: ASTNode;
  body: ASTNode[];
}

export interface ForStatement extends BaseASTNode<ASTNodeType.FOR_STATEMENT> {
  target: ASTNode;
  iter: ASTNode;
  body: ASTNode[];
}

export interface TryStatement extends BaseASTNode<ASTNodeType.TRY_STATEMENT> {
  body: ASTNode[];
  handlers: { exceptionType: ASTNode | null; name: string | null; body: ASTNode[] }[];
  orelse: ASTNode[];
  finalbody: ASTNode[];
}

export interface WithStatement extends BaseASTNode<ASTNodeType.WITH_STATEMENT> {
  items: { context: ASTNode; target: ASTNode | null }[];
  body: ASTNode[];
}

export interface FunctionDef extends BaseASTNode<ASTNodeType.FUNCTION_DEF> {
  name: string;
  params: ASTNode[];
  body: ASTNode[];
  decorators: ASTNode[];
  isAsync?: boolean;
}

export interface ClassDef extends BaseASTNode<ASTNodeType.CLASS_DEF> {
  name: string;
  bases: ASTNode[];
  body: ASTNode[];
  decorators: ASTNode[];
}

export interface Lambda extends BaseASTNode<ASTNodeType.LAMBDA> {
  params: string[];
  body: ASTNode;
}

export interface MatchStatement extends BaseASTNode<ASTNodeType.MATCH_STATEMENT> {
  subject: ASTNode;
  cases: { pattern: ASTNode; guard: ASTNode | null; body: ASTNode[] }[];
}

export interface MatchPatternValue extends BaseASTNode<ASTNodeType.MATCH_PATTERN_VALUE> {
  value: ASTNode;
}

export interface MatchPatternWildcard extends BaseASTNode<ASTNodeType.MATCH_PATTERN_WILDCARD> {
}

export interface MatchPatternCapture extends BaseASTNode<ASTNodeType.MATCH_PATTERN_CAPTURE> {
  name: string;
}

export interface MatchPatternSequence extends BaseASTNode<ASTNodeType.MATCH_PATTERN_SEQUENCE> {
  elements: ASTNode[];
}

export interface MatchPatternOr extends BaseASTNode<ASTNodeType.MATCH_PATTERN_OR> {
  patterns: ASTNode[];
}

export interface ListComp extends BaseASTNode<ASTNodeType.LIST_COMP | ASTNodeType.SET_COMP | ASTNodeType.GENERATOR_EXPR> {
  expression: ASTNode;
  comprehension: ASTNode;
}

export interface DictComp extends BaseASTNode<ASTNodeType.DICT_COMP> {
  key: ASTNode;
  value: ASTNode;
  comprehension: ASTNode;
}

export interface Slice extends BaseASTNode<ASTNodeType.SLICE> {
  start: ASTNode | null;
  end: ASTNode | null;
  step: ASTNode | null;
}

export interface Starred extends BaseASTNode<ASTNodeType.STARRED> {
  target: ASTNode;
}

// Auxiliary Nodes
export interface StarArg extends BaseASTNode<ASTNodeType.STAR_ARG> {
  value: ASTNode;
}

export interface KwArg extends BaseASTNode<ASTNodeType.KW_ARG> {
  value?: ASTNode; // For call
  name?: string;  // For param
}

export interface KeywordArg extends BaseASTNode<ASTNodeType.KEYWORD_ARG> {
  name: string;
  value: ASTNode;
}

export interface VarArg extends BaseASTNode<ASTNodeType.VAR_ARG> {
  name: string;
}

export interface Param extends BaseASTNode<ASTNodeType.PARAM> {
  name: string;
  defaultValue: ASTNode | null;
}

export interface Comprehension extends BaseASTNode<ASTNodeType.COMPREHENSION> {
  clauses: { target: ASTNode; iter: ASTNode; ifs: ASTNode[] }[];
  expression: ASTNode;
}

export interface KeyValue extends BaseASTNode<ASTNodeType.KEY_VALUE> {
  key: ASTNode;
  value: ASTNode;
}

export type ASTNode =
  | Program
  | ExpressionStatement
  | BinaryOperation
  | UnaryOperation
  | BoolOperation
  | Compare
  | Call
  | Attribute
  | Subscript
  | IfExpression
  | ListLiteral
  | TupleLiteral
  | DictLiteral
  | SetLiteral
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NoneLiteral
  | Identifier
  | Assignment
  | AugAssignment
  | AssertStatement
  | RaiseStatement
  | PassStatement
  | BreakStatement
  | ContinueStatement
  | ReturnStatement
  | Yield
  | GlobalStatement
  | NonlocalStatement
  | DeleteStatement
  | ImportStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | TryStatement
  | WithStatement
  | FunctionDef
  | ClassDef
  | Lambda
  | MatchStatement
  | MatchPatternValue
  | MatchPatternWildcard
  | MatchPatternCapture
  | MatchPatternSequence
  | MatchPatternOr
  | ListComp
  | DictComp
  | Slice
  | Starred
  | StarArg
  | KwArg
  | KeywordArg
  | VarArg
  | Param
  | Comprehension
  | KeyValue;
