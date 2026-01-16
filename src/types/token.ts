/**
 * Token 类型定义
 */
export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export enum TokenType {
  // Keywords
  KEYWORD,
  // Identifiers
  IDENTIFIER,
  // Literals
  NUMBER,
  STRING,
  BOOLEAN,
  NONE,
  // Operators
  OPERATOR,
  // Parentheses
  LPAREN,
  RPAREN,
  LBRACKET,
  RBRACKET,
  LBRACE,
  RBRACE,
  // Assignment
  ASSIGN,
  // Colon
  COLON,
  // Comma
  COMMA,
  DOT,
  AT,
  // End of file
  EOF,
  // Indentation
  INDENT,
  DEDENT,
  NEWLINE,
}
