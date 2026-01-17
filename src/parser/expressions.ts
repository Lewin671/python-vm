
import type { Parser } from './parser';
import { ASTNode, ASTNodeType, TokenType } from '../types';

export function parseStringLiteral(this: Parser): ASTNode {
  let value = '';
  while (this.match(TokenType.STRING)) value += this.consume().value;
  return { type: ASTNodeType.STRING_LITERAL, value };
}

export function parseLiteral(this: Parser): ASTNode {
  const token = this.peek();
  if (!token) throw new Error('Expected literal');
  if (token.type === TokenType.NUMBER) {
    this.consume();
    return { type: ASTNodeType.NUMBER_LITERAL, value: token.value };
  }
  if (token.type === TokenType.STRING) return this.parseStringLiteral();
  if (token.type === TokenType.BOOLEAN) {
    this.consume();
    return { type: ASTNodeType.BOOLEAN_LITERAL, value: token.value === 'True' };
  }
  if (token.type === TokenType.NONE) {
    this.consume();
    return { type: ASTNodeType.NONE_LITERAL, value: null };
  }
  throw new Error(`Unexpected token type for literal: ${TokenType[token.type]}`);
}

export function parseIdentifier(this: Parser): ASTNode {
  const token = this.expect(TokenType.IDENTIFIER);
  return { type: ASTNodeType.IDENTIFIER, name: token.value };
}

export function parseArguments(this: Parser): ASTNode[] {
  const args: ASTNode[] = [];
  if (!this.match(TokenType.RPAREN)) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.match(TokenType.OPERATOR, '*') || this.match(TokenType.OPERATOR, '**')) {
        const op = this.consume().value;
        const value = this.parseExpression();
        args.push({ type: op === '*' ? 'StarArg' : 'KwArg', value } as ASTNode);
      } else if (this.match(TokenType.IDENTIFIER) && this.peek(1)?.type === TokenType.ASSIGN) {
        const name = this.consume().value;
        this.consume();
        const value = this.parseExpression();
        args.push({ type: 'KeywordArg', name, value } as ASTNode);
      } else {
        args.push(this.parseExpression());
      }
      if (!this.match(TokenType.COMMA)) break;
      this.consume();
      if (this.match(TokenType.RPAREN)) break;
    }
  }
  return args;
}

export function parseSlice(this: Parser): ASTNode {
  let start: ASTNode | null = null;
  let end: ASTNode | null = null;
  let step: ASTNode | null = null;
  if (!this.match(TokenType.COLON)) start = this.parseExpression();
  if (this.match(TokenType.COLON)) {
    this.consume();
    if (!this.match(TokenType.COLON) && !this.match(TokenType.RBRACKET)) end = this.parseExpression();
    if (this.match(TokenType.COLON)) {
      this.consume();
      if (!this.match(TokenType.RBRACKET)) step = this.parseExpression();
    }
    return { type: ASTNodeType.SLICE, start, end, step };
  }
  return start as ASTNode;
}

export function parsePatternAtom(this: Parser): ASTNode {
  if (this.match(TokenType.NUMBER) || this.match(TokenType.STRING) || this.match(TokenType.BOOLEAN) || this.match(TokenType.NONE)) {
    return { type: ASTNodeType.MATCH_PATTERN_VALUE, value: this.parseLiteral() } as ASTNode;
  }
  if (this.match(TokenType.IDENTIFIER)) {
    const name = this.consume().value;
    if (name === '_') return { type: ASTNodeType.MATCH_PATTERN_WILDCARD } as ASTNode;
    return { type: ASTNodeType.MATCH_PATTERN_CAPTURE, name } as ASTNode;
  }
  if (this.match(TokenType.LBRACKET)) {
    this.consume();
    const elements: ASTNode[] = [];
    if (!this.match(TokenType.RBRACKET)) {
      elements.push(this.parsePattern());
      while (this.match(TokenType.COMMA)) {
        this.consume();
        if (this.match(TokenType.RBRACKET)) break;
        elements.push(this.parsePattern());
      }
    }
    this.expect(TokenType.RBRACKET);
    return { type: ASTNodeType.MATCH_PATTERN_SEQUENCE, elements } as ASTNode;
  }
  throw new Error(`Unexpected token in pattern: ${this.peek()?.value}`);
}

export function parsePattern(this: Parser): ASTNode {
  let pattern = this.parsePatternAtom();
  if (this.match(TokenType.OPERATOR, '|')) {
    const patterns: ASTNode[] = [pattern];
    while (this.match(TokenType.OPERATOR, '|')) {
      this.consume();
      patterns.push(this.parsePatternAtom());
    }
    pattern = { type: ASTNodeType.MATCH_PATTERN_OR, patterns } as ASTNode;
  }
  return pattern;
}

export function parseLambdaParameters(this: Parser): string[] {
  const params: string[] = [];
  if (this.match(TokenType.COLON)) return params;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (this.match(TokenType.OPERATOR, '*')) {
      this.consume();
      params.push(`*${this.expect(TokenType.IDENTIFIER).value}`);
    } else if (this.match(TokenType.OPERATOR, '**')) {
      this.consume();
      params.push(`**${this.expect(TokenType.IDENTIFIER).value}`);
    } else {
      const name = this.expect(TokenType.IDENTIFIER).value;
      if (this.match(TokenType.ASSIGN)) {
        this.consume();
        this.parseExpression();
      }
      params.push(name);
    }
    if (!this.match(TokenType.COMMA)) break;
    this.consume();
  }
  return params;
}

export function parseLambda(this: Parser): ASTNode {
  this.consume(); // lambda
  const params = this.parseLambdaParameters();
  this.expect(TokenType.COLON);
  const body = this.parseExpression();
  return { type: ASTNodeType.LAMBDA, params, body };
}

export function parseAtom(this: Parser): ASTNode {
  if (this.match(TokenType.LPAREN)) {
    this.consume();
    if (this.match(TokenType.RPAREN)) {
      this.consume();
      return { type: ASTNodeType.TUPLE_LITERAL, elements: [] };
    }
    const expr = this.parseExpression();
    if (this.match(TokenType.KEYWORD, 'for')) {
      const comprehension = this.parseComprehension(expr);
      this.expect(TokenType.RPAREN);
      return { type: ASTNodeType.GENERATOR_EXPR, expression: expr, comprehension };
    }
    if (this.match(TokenType.COMMA)) {
      const elements = [expr];
      while (this.match(TokenType.COMMA)) {
        this.consume();
        if (this.match(TokenType.RPAREN)) break;
        elements.push(this.parseExpression());
      }
      this.expect(TokenType.RPAREN);
      return { type: ASTNodeType.TUPLE_LITERAL, elements };
    }
    this.expect(TokenType.RPAREN);
    return expr;
  }
  if (this.match(TokenType.KEYWORD, 'yield')) {
    this.consume();
    const value = this.match(TokenType.NEWLINE) || this.match(TokenType.COMMA) || this.match(TokenType.RPAREN) ? null : this.parseExpression();
    return { type: ASTNodeType.YIELD, value };
  }
  if (this.match(TokenType.KEYWORD, 'lambda')) {
    return this.parseLambda();
  }
  if (this.match(TokenType.LBRACKET)) {
    this.consume();
    if (this.match(TokenType.RBRACKET)) {
      this.consume();
      return { type: ASTNodeType.LIST_LITERAL, elements: [] };
    }
    const first = this.parseExpression();
    if (this.match(TokenType.KEYWORD, 'for')) {
      const comprehension = this.parseComprehension(first);
      this.expect(TokenType.RBRACKET);
      return { type: ASTNodeType.LIST_COMP, expression: first, comprehension };
    }
    const elements = [first];
    while (this.match(TokenType.COMMA)) {
      this.consume();
      if (this.match(TokenType.RBRACKET)) break;
      elements.push(this.parseExpression());
    }
    this.expect(TokenType.RBRACKET);
    return { type: ASTNodeType.LIST_LITERAL, elements };
  }
  if (this.match(TokenType.LBRACE)) {
    this.consume();
    if (this.match(TokenType.RBRACE)) {
      this.consume();
      return { type: ASTNodeType.DICT_LITERAL, entries: [] };
    }
    const key = this.parseExpression();
    if (this.match(TokenType.COLON)) {
      this.consume();
      const value = this.parseExpression();
      if (this.match(TokenType.KEYWORD, 'for')) {
        const comprehension = this.parseComprehension({ type: 'KeyValue', key, value } as ASTNode);
        this.expect(TokenType.RBRACE);
        return { type: ASTNodeType.DICT_COMP, key, value, comprehension };
      }
      const entries = [{ key, value }];
      while (this.match(TokenType.COMMA)) {
        this.consume();
        if (this.match(TokenType.RBRACE)) break;
        const k = this.parseExpression();
        this.expect(TokenType.COLON);
        const v = this.parseExpression();
        entries.push({ key: k, value: v });
      }
      this.expect(TokenType.RBRACE);
      return { type: ASTNodeType.DICT_LITERAL, entries };
    }
    if (this.match(TokenType.KEYWORD, 'for')) {
      const comprehension = this.parseComprehension(key);
      this.expect(TokenType.RBRACE);
      return { type: ASTNodeType.SET_COMP, expression: key, comprehension };
    }
    const elements = [key];
    while (this.match(TokenType.COMMA)) {
      this.consume();
      if (this.match(TokenType.RBRACE)) break;
      elements.push(this.parseExpression());
    }
    this.expect(TokenType.RBRACE);
    return { type: ASTNodeType.SET_LITERAL, elements };
  }
  if (this.match(TokenType.IDENTIFIER)) {
    const name = this.consume().value;
    return { type: ASTNodeType.IDENTIFIER, name };
  }
  return this.parseLiteral();
}

export function parsePostfix(this: Parser): ASTNode {
  let expr = this.parseAtom();
  while (
    this.match(TokenType.LPAREN) ||
    this.match(TokenType.LBRACKET) ||
    (this.match(TokenType.DOT) && this.peek(1)?.type === TokenType.IDENTIFIER)
  ) {
    if (this.match(TokenType.LPAREN)) {
      this.consume();
      const args = this.parseArguments();
      this.expect(TokenType.RPAREN);
      expr = { type: ASTNodeType.CALL, callee: expr, args };
    } else if (this.match(TokenType.LBRACKET)) {
      this.consume();
      const index = this.parseSlice();
      this.expect(TokenType.RBRACKET);
      expr = { type: ASTNodeType.SUBSCRIPT, object: expr, index };
    } else if (this.match(TokenType.DOT)) {
      this.consume();
      const name = this.expect(TokenType.IDENTIFIER).value;
      expr = { type: ASTNodeType.ATTRIBUTE, object: expr, name };
    }
  }
  return expr;
}

export function parseUnary(this: Parser): ASTNode {
  if (this.match(TokenType.OPERATOR, '+') || this.match(TokenType.OPERATOR, '-') || this.match(TokenType.OPERATOR, '~')) {
    const operator = this.consume().value;
    const operand = this.parseUnary();
    return { type: ASTNodeType.UNARY_OPERATION, operator, operand };
  }
  if (this.match(TokenType.KEYWORD) && this.peek()?.value === 'not') {
    this.consume();
    const operand = this.parseUnary();
    return { type: ASTNodeType.UNARY_OPERATION, operator: 'not', operand };
  }
  return this.parsePostfix();
}

export function parsePower(this: Parser): ASTNode {
  let left = this.parseUnary();
  if (this.match(TokenType.OPERATOR, '**')) {
    this.consume();
    const right = this.parsePower();
    left = { type: ASTNodeType.BINARY_OPERATION, operator: '**', left, right };
  }
  return left;
}

export function parseFactor(this: Parser): ASTNode {
  let left = this.parsePower();
  while (this.match(TokenType.OPERATOR, '*') || this.match(TokenType.OPERATOR, '/') || this.match(TokenType.OPERATOR, '//') || this.match(TokenType.OPERATOR, '%')) {
    const operator = this.consume().value;
    const right = this.parsePower();
    left = { type: ASTNodeType.BINARY_OPERATION, operator, left, right };
  }
  return left;
}

export function parseTerm(this: Parser): ASTNode {
  let left = this.parseFactor();
  while (this.match(TokenType.OPERATOR, '+') || this.match(TokenType.OPERATOR, '-')) {
    const operator = this.consume().value;
    const right = this.parseFactor();
    left = { type: ASTNodeType.BINARY_OPERATION, operator, left, right };
  }
  return left;
}

export function parseShift(this: Parser): ASTNode {
  let left = this.parseTerm();
  while (this.match(TokenType.OPERATOR, '<<') || this.match(TokenType.OPERATOR, '>>')) {
    const operator = this.consume().value;
    const right = this.parseTerm();
    left = { type: ASTNodeType.BINARY_OPERATION, operator, left, right };
  }
  return left;
}

export function parseBitAnd(this: Parser): ASTNode {
  let left = this.parseShift();
  while (this.match(TokenType.OPERATOR, '&')) {
    this.consume();
    const right = this.parseShift();
    left = { type: ASTNodeType.BINARY_OPERATION, operator: '&', left, right };
  }
  return left;
}

export function parseBitXor(this: Parser): ASTNode {
  let left = this.parseBitAnd();
  while (this.match(TokenType.OPERATOR, '^')) {
    this.consume();
    const right = this.parseBitAnd();
    left = { type: ASTNodeType.BINARY_OPERATION, operator: '^', left, right };
  }
  return left;
}

export function parseBitOr(this: Parser): ASTNode {
  let left = this.parseBitXor();
  while (this.match(TokenType.OPERATOR, '|')) {
    this.consume();
    const right = this.parseBitXor();
    left = { type: ASTNodeType.BINARY_OPERATION, operator: '|', left, right };
  }
  return left;
}

export function parseComparison(this: Parser): ASTNode {
  const left = this.parseBitOr();
  const operators: string[] = [];
  const comparators: ASTNode[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (this.match(TokenType.KEYWORD, 'not') && this.peek(1)?.type === TokenType.KEYWORD && this.peek(1)?.value === 'in') {
      this.consume();
      this.consume();
      operators.push('not in');
      comparators.push(this.parseBitOr());
      continue;
    }
    if (this.match(TokenType.KEYWORD, 'is') && this.peek(1)?.type === TokenType.KEYWORD && this.peek(1)?.value === 'not') {
      this.consume();
      this.consume();
      operators.push('is not');
      comparators.push(this.parseBitOr());
      continue;
    }
    if (
      this.match(TokenType.OPERATOR, '==') ||
      this.match(TokenType.OPERATOR, '!=') ||
      this.match(TokenType.OPERATOR, '<') ||
      this.match(TokenType.OPERATOR, '>') ||
      this.match(TokenType.OPERATOR, '<=') ||
      this.match(TokenType.OPERATOR, '>=') ||
      this.match(TokenType.KEYWORD, 'in') ||
      this.match(TokenType.KEYWORD, 'is')
    ) {
      operators.push(this.consume().value);
      comparators.push(this.parseBitOr());
      continue;
    }
    break;
  }
  if (operators.length === 0) return left;
  return { type: ASTNodeType.COMPARE, left, ops: operators, comparators };
}

export function parseNot(this: Parser): ASTNode {
  if (this.match(TokenType.KEYWORD, 'not')) {
    this.consume();
    const operand = this.parseNot();
    return { type: ASTNodeType.UNARY_OPERATION, operator: 'not', operand };
  }
  return this.parseComparison();
}

export function parseAnd(this: Parser): ASTNode {
  let left = this.parseNot();
  while (this.match(TokenType.KEYWORD, 'and')) {
    this.consume();
    const right = this.parseNot();
    left = { type: ASTNodeType.BOOL_OPERATION, operator: 'and', values: [left, right] };
  }
  return left;
}

export function parseOr(this: Parser): ASTNode {
  let left = this.parseAnd();
  while (this.match(TokenType.KEYWORD, 'or')) {
    this.consume();
    const right = this.parseAnd();
    left = { type: ASTNodeType.BOOL_OPERATION, operator: 'or', values: [left, right] };
  }
  return left;
}

export function parseIfExpression(this: Parser): ASTNode {
  const expr = this.parseOr();
  if (this.match(TokenType.KEYWORD, 'if')) {
    this.consume();
    const test = this.parseOr();
    this.expect(TokenType.KEYWORD, 'else');
    const alternate = this.parseIfExpression();
    return { type: ASTNodeType.IF_EXPRESSION, test, consequent: expr, alternate };
  }
  return expr;
}

export function parseExpression(this: Parser): ASTNode {
  return this.parseIfExpression();
}

export function parseExpressionNoIf(this: Parser): ASTNode {
  return this.parseOr();
}

export function parseComprehension(this: Parser, expression: ASTNode): ASTNode {
  const clauses: Array<{ target: ASTNode; iter: ASTNode; ifs: ASTNode[] }> = [];
  while (this.match(TokenType.KEYWORD, 'for')) {
    this.consume();
    const target = this.parseTarget();
    this.expect(TokenType.KEYWORD, 'in');
    const iter = this.parseExpressionNoIf();
    const ifs: ASTNode[] = [];
    while (this.match(TokenType.KEYWORD, 'if')) {
      this.consume();
      ifs.push(this.parseExpression());
    }
    clauses.push({ target, iter, ifs });
  }
  return { type: 'Comprehension', clauses, expression } as ASTNode;
}
