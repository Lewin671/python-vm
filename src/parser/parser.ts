import { Token, TokenType, ASTNode } from '../types';
import * as Expr from './expressions';
import * as Target from './targets';
import * as Stmt from './statements';

export class Parser {
  tokens: Token[];
  pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(offset: number = 0): Token | null {
    return this.pos + offset < this.tokens.length ? this.tokens[this.pos + offset] : null;
  }

  consume(): Token {
    if (this.pos >= this.tokens.length) throw new Error('Unexpected end of input');
    return this.tokens[this.pos++];
  }

  match(type: TokenType, value?: string): boolean {
    const token = this.peek();
    return !!token && token.type === type && (value === undefined || token.value === value);
  }

  expect(type: TokenType, value?: string): Token {
    const token = this.peek();
    if (!token) throw new Error(`Expected ${TokenType[type]}${value ? ` "${value}"` : ''}, but got end of input`);
    if (token.type !== type) {
      throw new Error(
        `Expected ${TokenType[type]}${value ? ` "${value}"` : ''}, but got ${TokenType[token.type]} "${token.value}" at line ${token.line}`
      );
    }
    if (value !== undefined && token.value !== value) {
      throw new Error(`Expected "${value}", but got "${token.value}" at line ${token.line}`);
    }
    return this.consume();
  }

  skipNewlines(): void {
    while (this.match(TokenType.NEWLINE)) {
      this.consume();
    }
  }

  // Expression parsing
  parseStringLiteral = Expr.parseStringLiteral;
  parseLiteral = Expr.parseLiteral;
  parseIdentifier = Expr.parseIdentifier;
  parseArguments = Expr.parseArguments;
  parseSlice = Expr.parseSlice;
  parsePatternAtom = Expr.parsePatternAtom;
  parsePattern = Expr.parsePattern;
  parseLambdaParameters = Expr.parseLambdaParameters;
  parseLambda = Expr.parseLambda;
  parseAtom = Expr.parseAtom;
  parsePostfix = Expr.parsePostfix;
  parsePostfixTarget = Target.parsePostfixTarget;
  parseTargetElement = Target.parseTargetElement;
  parseTarget = Target.parseTarget;
  parseUnary = Expr.parseUnary;
  parsePower = Expr.parsePower;
  parseFactor = Expr.parseFactor;
  parseTerm = Expr.parseTerm;
  parseShift = Expr.parseShift;
  parseBitAnd = Expr.parseBitAnd;
  parseBitXor = Expr.parseBitXor;
  parseBitOr = Expr.parseBitOr;
  parseComparison = Expr.parseComparison;
  parseNot = Expr.parseNot;
  parseAnd = Expr.parseAnd;
  parseOr = Expr.parseOr;
  parseIfExpression = Expr.parseIfExpression;
  parseExpression = Expr.parseExpression;
  parseExpressionNoIf = Expr.parseExpressionNoIf;
  parseComprehension = Expr.parseComprehension;

  // Statement parsing
  parseExpressionStatement = Stmt.parseExpressionStatement;
  parseExpressionList = Stmt.parseExpressionList;
  parseAssignmentOrExpression = Stmt.parseAssignmentOrExpression;
  parseBlock = Stmt.parseBlock;
  parseIfStatement = Stmt.parseIfStatement;
  parseWhileStatement = Stmt.parseWhileStatement;
  parseForStatement = Stmt.parseForStatement;
  parseFunctionParameters = Stmt.parseFunctionParameters;
  parseFunctionDef = Stmt.parseFunctionDef;
  parseClassDef = Stmt.parseClassDef;
  parseDecorators = Stmt.parseDecorators;
  parseTryStatement = Stmt.parseTryStatement;
  parseWithStatement = Stmt.parseWithStatement;
  parseMatchStatement = Stmt.parseMatchStatement;
  parseImportStatement = Stmt.parseImportStatement;
  parseStatement = Stmt.parseStatement;
  parseProgram = Stmt.parseProgram;

  parse(): ASTNode {
    return this.parseProgram();
  }
}
