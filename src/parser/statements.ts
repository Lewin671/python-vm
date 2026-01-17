import type { Parser } from './parser';
import { ASTNode, ASTNodeType, TokenType } from '../types';

export function parseExpressionStatement(this: Parser): ASTNode {
  return { type: ASTNodeType.EXPRESSION_STATEMENT, expression: this.parseExpression() };
}

export function parseExpressionList(this: Parser): ASTNode {
  const first = this.parseExpression();
  if (this.match(TokenType.COMMA)) {
    const elements: ASTNode[] = [first];
    while (this.match(TokenType.COMMA)) {
      this.consume();
      if (this.match(TokenType.NEWLINE) || this.match(TokenType.RPAREN) || this.match(TokenType.RBRACKET) || this.match(TokenType.RBRACE)) break;
      elements.push(this.parseExpression());
    }
    return { type: ASTNodeType.TUPLE_LITERAL, elements };
  }
  return first;
}

export function parseAssignmentOrExpression(this: Parser): ASTNode {
  const startPos = this.pos;
  let target: ASTNode | null = null;

  try {
    target = this.parseTarget();
  } catch (e) {
    // If parsing as target fails, it might be a valid expression statement
  }

  if (target) {
    if (this.match(TokenType.ASSIGN)) {
      this.consume();
      const value = this.parseExpressionList();
      return { type: ASTNodeType.ASSIGNMENT, targets: [target], value };
    }
    if (
      this.match(TokenType.OPERATOR) &&
      ['+=', '-=', '*=', '/=', '%=', '//=', '**='].includes(this.peek()?.value || '')
    ) {
      const op = this.consume().value;
      const value = this.parseExpressionList();
      return { type: ASTNodeType.AUG_ASSIGNMENT, target, operator: op, value };
    }
  }

  this.pos = startPos;
  return this.parseExpressionStatement();
}

export function parseBlock(this: Parser): ASTNode[] {
  this.expect(TokenType.NEWLINE);
  this.expect(TokenType.INDENT);
  const body: ASTNode[] = [];
  while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
    const stmt = this.parseStatement();
    body.push(stmt);
    this.skipNewlines();
  }
  this.expect(TokenType.DEDENT);
  return body;
}

export function parseIfStatement(this: Parser): ASTNode {
  this.expect(TokenType.KEYWORD, 'if');
  const test = this.parseExpression();
  this.expect(TokenType.COLON);
  const body = this.parseBlock();
  const elifs: Array<{ test: ASTNode; body: ASTNode[] }> = [];
  while (this.match(TokenType.KEYWORD, 'elif')) {
    this.consume();
    const elifTest = this.parseExpression();
    this.expect(TokenType.COLON);
    const elifBody = this.parseBlock();
    elifs.push({ test: elifTest, body: elifBody });
  }
  let orelse: ASTNode[] = [];
  if (this.match(TokenType.KEYWORD, 'else')) {
    this.consume();
    this.expect(TokenType.COLON);
    orelse = this.parseBlock();
  }
  return { type: ASTNodeType.IF_STATEMENT, test, body, elifs, orelse };
}

export function parseWhileStatement(this: Parser): ASTNode {
  this.expect(TokenType.KEYWORD, 'while');
  const test = this.parseExpression();
  this.expect(TokenType.COLON);
  const body = this.parseBlock();
  return { type: ASTNodeType.WHILE_STATEMENT, test, body };
}

export function parseForStatement(this: Parser): ASTNode {
  this.expect(TokenType.KEYWORD, 'for');
  const target = this.parseTarget();
  this.expect(TokenType.KEYWORD, 'in');
  const iter = this.parseExpression();
  this.expect(TokenType.COLON);
  const body = this.parseBlock();
  return { type: ASTNodeType.FOR_STATEMENT, target, iter, body };
}

export function parseFunctionParameters(this: Parser): ASTNode[] {
  const params: ASTNode[] = [];
  if (!this.match(TokenType.RPAREN)) {
    while (true) {
      if (this.match(TokenType.OPERATOR, '*')) {
        this.consume();
        const name = this.expect(TokenType.IDENTIFIER).value;
        params.push({ type: 'VarArg', name } as any);
      } else if (this.match(TokenType.OPERATOR, '**')) {
        this.consume();
        const name = this.expect(TokenType.IDENTIFIER).value;
        params.push({ type: 'KwArg', name } as any);
      } else if (this.match(TokenType.IDENTIFIER)) {
        const name = this.consume().value;
        let defaultValue: ASTNode | null = null;
        if (this.match(TokenType.ASSIGN)) {
          this.consume();
          defaultValue = this.parseExpression();
        }
        params.push({ type: 'Param', name, defaultValue } as any);
      }
      if (!this.match(TokenType.COMMA)) break;
      this.consume();
      if (this.match(TokenType.RPAREN)) break;
    }
  }
  return params;
}

export function parseFunctionDef(this: Parser, decorators: ASTNode[] = []): ASTNode {
  this.expect(TokenType.KEYWORD, 'def');
  const name = this.expect(TokenType.IDENTIFIER).value;
  this.expect(TokenType.LPAREN);
  const params = this.parseFunctionParameters();
  this.expect(TokenType.RPAREN);
  this.expect(TokenType.COLON);
  const body = this.parseBlock();
  return { type: ASTNodeType.FUNCTION_DEF, name, params, body, decorators };
}

export function parseClassDef(this: Parser, decorators: ASTNode[] = []): ASTNode {
  this.expect(TokenType.KEYWORD, 'class');
  const name = this.expect(TokenType.IDENTIFIER).value;
  let bases: ASTNode[] = [];
  if (this.match(TokenType.LPAREN)) {
    this.consume();
    if (!this.match(TokenType.RPAREN)) {
      bases.push(this.parseExpression());
      while (this.match(TokenType.COMMA)) {
        this.consume();
        if (this.match(TokenType.RPAREN)) break;
        bases.push(this.parseExpression());
      }
    }
    this.expect(TokenType.RPAREN);
  }
  this.expect(TokenType.COLON);
  const body = this.parseBlock();
  return { type: ASTNodeType.CLASS_DEF, name, bases, body, decorators };
}

export function parseDecorators(this: Parser): ASTNode[] {
  const decorators: ASTNode[] = [];
  while (this.match(TokenType.AT)) {
    this.consume();
    const decorator = this.parseExpression();
    decorators.push(decorator);
    this.expect(TokenType.NEWLINE);
  }
  return decorators;
}

export function parseTryStatement(this: Parser): ASTNode {
  this.expect(TokenType.KEYWORD, 'try');
  this.expect(TokenType.COLON);
  const body = this.parseBlock();
  const handlers: Array<{ exceptionType: ASTNode | null; name: string | null; body: ASTNode[] }> = [];
  while (this.match(TokenType.KEYWORD, 'except')) {
    this.consume();
    let exceptionType: ASTNode | null = null;
    let name: string | null = null;
    if (!this.match(TokenType.COLON)) {
      exceptionType = this.parseExpression();
      if (this.match(TokenType.KEYWORD, 'as')) {
        this.consume();
        name = this.expect(TokenType.IDENTIFIER).value;
      }
    }
    this.expect(TokenType.COLON);
    const handlerBody = this.parseBlock();
    handlers.push({ exceptionType, name, body: handlerBody });
  }
  let orelse: ASTNode[] = [];
  if (this.match(TokenType.KEYWORD, 'else')) {
    this.consume();
    this.expect(TokenType.COLON);
    orelse = this.parseBlock();
  }
  let finalbody: ASTNode[] = [];
  if (this.match(TokenType.KEYWORD, 'finally')) {
    this.consume();
    this.expect(TokenType.COLON);
    finalbody = this.parseBlock();
  }
  return { type: ASTNodeType.TRY_STATEMENT, body, handlers, orelse, finalbody };
}

export function parseWithStatement(this: Parser): ASTNode {
  this.expect(TokenType.KEYWORD, 'with');
  const items: any[] = [];
  while (true) {
    const context = this.parseExpression();
    let target: ASTNode | null = null;
    if (this.match(TokenType.KEYWORD, 'as')) {
      this.consume();
      target = this.parseTarget();
    }
    items.push({ context, target });
    if (!this.match(TokenType.COMMA)) break;
    this.consume();
  }
  this.expect(TokenType.COLON);
  const body = this.parseBlock();
  return { type: ASTNodeType.WITH_STATEMENT, items, body };
}

export function parseMatchStatement(this: Parser): ASTNode {
  this.expect(TokenType.KEYWORD, 'match');
  const subject = this.parseExpression();
  this.expect(TokenType.COLON);
  this.expect(TokenType.NEWLINE);
  this.expect(TokenType.INDENT);
  const cases: Array<{ pattern: ASTNode; guard: ASTNode | null; body: ASTNode[] }> = [];
  while (!this.match(TokenType.DEDENT) && !this.match(TokenType.EOF)) {
    this.expect(TokenType.KEYWORD, 'case');
    const pattern = this.parsePattern();
    let guard: ASTNode | null = null;
    if (this.match(TokenType.KEYWORD, 'if')) {
      this.consume();
      guard = this.parseExpression();
    }
    this.expect(TokenType.COLON);
    const body = this.parseBlock();
    cases.push({ pattern, guard, body });
  }
  this.expect(TokenType.DEDENT);
  return { type: ASTNodeType.MATCH_STATEMENT, subject, cases };
}

export function parseImportStatement(this: Parser): ASTNode {
  this.expect(TokenType.KEYWORD, 'import');
  const names: Array<{ name: string; alias: string | null }> = [];
  const parseName = () => {
    let name = this.expect(TokenType.IDENTIFIER).value;
    while (this.match(TokenType.DOT)) {
      this.consume();
      name += `.${this.expect(TokenType.IDENTIFIER).value}`;
    }
    let alias: string | null = null;
    if (this.match(TokenType.KEYWORD, 'as')) {
      this.consume();
      alias = this.expect(TokenType.IDENTIFIER).value;
    }
    names.push({ name, alias });
  };
  parseName();
  while (this.match(TokenType.COMMA)) {
    this.consume();
    parseName();
  }
  return { type: ASTNodeType.IMPORT_STATEMENT, names };
}

export function parseStatement(this: Parser): ASTNode {
  this.skipNewlines();
  if (this.match(TokenType.AT)) {
    const decorators = this.parseDecorators();
    if (this.match(TokenType.KEYWORD, 'async')) {
      this.consume();
      if (!this.match(TokenType.KEYWORD, 'def')) throw new Error('async must be followed by def');
      const node = this.parseFunctionDef(decorators);
      (node as any).isAsync = true;
      return node;
    }
    if (this.match(TokenType.KEYWORD, 'def')) return this.parseFunctionDef(decorators);
    if (this.match(TokenType.KEYWORD, 'class')) return this.parseClassDef(decorators);
    throw new Error('Decorator must be followed by def or class');
  }
  if (this.match(TokenType.KEYWORD, 'async')) {
    this.consume();
    if (!this.match(TokenType.KEYWORD, 'def')) throw new Error('async must be followed by def');
    const node = this.parseFunctionDef();
    (node as any).isAsync = true;
    return node;
  }
  if (this.match(TokenType.KEYWORD, 'import')) return this.parseImportStatement();
  if (this.match(TokenType.KEYWORD, 'def')) return this.parseFunctionDef();
  if (this.match(TokenType.KEYWORD, 'class')) return this.parseClassDef();
  if (this.match(TokenType.KEYWORD, 'if')) return this.parseIfStatement();
  if (this.match(TokenType.KEYWORD, 'for')) return this.parseForStatement();
  if (this.match(TokenType.KEYWORD, 'while')) return this.parseWhileStatement();
  if (this.match(TokenType.KEYWORD, 'try')) return this.parseTryStatement();
  if (this.match(TokenType.KEYWORD, 'with')) return this.parseWithStatement();
  if (this.match(TokenType.KEYWORD, 'match')) return this.parseMatchStatement();
  if (this.match(TokenType.KEYWORD, 'return')) {
    this.consume();
    const value = this.match(TokenType.NEWLINE) ? null : this.parseExpressionList();
    return { type: ASTNodeType.RETURN_STATEMENT, value };
  }
  if (this.match(TokenType.KEYWORD, 'break')) {
    this.consume();
    return { type: ASTNodeType.BREAK_STATEMENT };
  }
  if (this.match(TokenType.KEYWORD, 'continue')) {
    this.consume();
    return { type: ASTNodeType.CONTINUE_STATEMENT };
  }
  if (this.match(TokenType.KEYWORD, 'pass')) {
    this.consume();
    return { type: ASTNodeType.PASS_STATEMENT };
  }
  if (this.match(TokenType.KEYWORD, 'assert')) {
    this.consume();
    const test = this.parseExpression();
    let message: ASTNode | null = null;
    if (this.match(TokenType.COMMA)) {
      this.consume();
      message = this.parseExpression();
    }
    return { type: ASTNodeType.ASSERT_STATEMENT, test, message };
  }
  if (this.match(TokenType.KEYWORD, 'raise')) {
    this.consume();
    const exc = this.match(TokenType.NEWLINE) ? null : this.parseExpression();
    return { type: ASTNodeType.RAISE_STATEMENT, exception: exc };
  }
  if (this.match(TokenType.KEYWORD, 'global')) {
    this.consume();
    const names: string[] = [];
    names.push(this.expect(TokenType.IDENTIFIER).value);
    while (this.match(TokenType.COMMA)) {
      this.consume();
      names.push(this.expect(TokenType.IDENTIFIER).value);
    }
    return { type: ASTNodeType.GLOBAL_STATEMENT, names };
  }
  if (this.match(TokenType.KEYWORD, 'nonlocal')) {
    this.consume();
    const names: string[] = [];
    names.push(this.expect(TokenType.IDENTIFIER).value);
    while (this.match(TokenType.COMMA)) {
      this.consume();
      names.push(this.expect(TokenType.IDENTIFIER).value);
    }
    return { type: ASTNodeType.NONLOCAL_STATEMENT, names };
  }
  if (this.match(TokenType.KEYWORD, 'del')) {
    this.consume();
    const target = this.parseExpression();
    return { type: ASTNodeType.DELETE_STATEMENT, target };
  }
  return this.parseAssignmentOrExpression();
}

export function parseProgram(this: Parser): ASTNode {
  const body: ASTNode[] = [];
  this.skipNewlines();
  while (this.pos < this.tokens.length && !this.match(TokenType.EOF)) {
    const stmt = this.parseStatement();
    body.push(stmt);
    this.skipNewlines();
  }
  this.expect(TokenType.EOF);
  return { type: ASTNodeType.PROGRAM, body };
}
