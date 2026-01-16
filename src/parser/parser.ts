import { Token, TokenType, ASTNode, ASTNodeType } from '../types';

/**
 * 语法分析器 - 将 token 流转换为 AST
 */
export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ASTNode {
    const peek = (offset: number = 0): Token | null => {
      return this.pos + offset < this.tokens.length ? this.tokens[this.pos + offset] : null;
    };

    const consume = (): Token => {
      if (this.pos >= this.tokens.length) {
        throw new Error('Unexpected end of input');
      }
      return this.tokens[this.pos++];
    };

    const match = (type: TokenType, value?: string): boolean => {
      const token = peek();
      if (!token) return false;
      if (token.type !== type) return false;
      if (value !== undefined && token.value !== value) return false;
      return true;
    };

    const expect = (type: TokenType, value?: string): Token => {
      const token = peek();
      if (!token) {
        throw new Error(`Expected ${TokenType[type]}${value ? ` "${value}"` : ''}, but got end of input`);
      }
      if (token.type !== type) {
        throw new Error(`Expected ${TokenType[type]}${value ? ` "${value}"` : ''}, but got ${TokenType[token.type]} "${token.value}" at line ${token.line}`);
      }
      if (value !== undefined && token.value !== value) {
        throw new Error(`Expected "${value}", but got "${token.value}" at line ${token.line}`);
      }
      return consume();
    };

    const skipNewlines = () => {
      while (match(TokenType.NEWLINE)) {
        consume();
      }
    };

    const parseStringLiteral = (): ASTNode => {
      let value = '';
      while (match(TokenType.STRING)) {
        const token = consume();
        value += token.value;
      }
      return {
        type: ASTNodeType.STRING_LITERAL,
        value
      };
    };

    const parseLiteral = (): ASTNode => {
      const token = peek();
      if (!token) throw new Error('Expected literal');

      if (token.type === TokenType.NUMBER) {
        consume();
        return {
          type: ASTNodeType.NUMBER_LITERAL,
          value: token.value
        };
      }
      if (token.type === TokenType.STRING) {
        return parseStringLiteral();
      }
      if (token.type === TokenType.BOOLEAN) {
        consume();
        return {
          type: ASTNodeType.BOOLEAN_LITERAL,
          value: token.value === 'True'
        };
      }
      if (token.type === TokenType.NONE) {
        consume();
        return {
          type: ASTNodeType.NONE_LITERAL,
          value: null
        };
      }

      throw new Error(`Unexpected token type for literal: ${TokenType[token.type]}`);
    };

    const parseIdentifier = (): ASTNode => {
      const token = expect(TokenType.IDENTIFIER);
      return {
        type: ASTNodeType.IDENTIFIER,
        name: token.value
      };
    };

    const parseArguments = (): ASTNode[] => {
      const args: ASTNode[] = [];
      if (!match(TokenType.RPAREN)) {
        while (true) {
          if (match(TokenType.OPERATOR, '*') || match(TokenType.OPERATOR, '**')) {
            const op = consume().value;
            const value = parseExpression();
            args.push({ type: op === '*' ? 'StarArg' : 'KwArg', value });
          } else if (match(TokenType.IDENTIFIER) && peek(1)?.type === TokenType.ASSIGN) {
            const name = consume().value;
            consume();
            const value = parseExpression();
            args.push({ type: 'KeywordArg', name, value });
          } else {
            args.push(parseExpression());
          }
          if (!match(TokenType.COMMA)) break;
          consume();
          if (match(TokenType.RPAREN)) break;
        }
      }
      return args;
    };

    const parseSlice = (): ASTNode => {
      let start: ASTNode | null = null;
      let end: ASTNode | null = null;
      let step: ASTNode | null = null;

      if (!match(TokenType.COLON)) {
        start = parseExpression();
      }
      if (match(TokenType.COLON)) {
        consume();
        if (!match(TokenType.COLON) && !match(TokenType.RBRACKET)) {
          end = parseExpression();
        }
        if (match(TokenType.COLON)) {
          consume();
          if (!match(TokenType.RBRACKET)) {
            step = parseExpression();
          }
        }
        return {
          type: ASTNodeType.SLICE,
          start,
          end,
          step
        };
      }

      return start as ASTNode;
    };

    const parseAtom = (): ASTNode => {
      if (match(TokenType.NUMBER) || match(TokenType.STRING) || match(TokenType.BOOLEAN) || match(TokenType.NONE)) {
        return parseLiteral();
      }

      if (match(TokenType.IDENTIFIER)) {
        return parseIdentifier();
      }

      if (match(TokenType.KEYWORD, 'lambda')) {
        consume();
        const params: string[] = [];
        if (!match(TokenType.COLON)) {
          const first = expect(TokenType.IDENTIFIER);
          params.push(first.value);
          while (match(TokenType.COMMA)) {
            consume();
            params.push(expect(TokenType.IDENTIFIER).value);
          }
        }
        expect(TokenType.COLON);
        const body = parseExpression();
        return {
          type: ASTNodeType.LAMBDA,
          params,
          body
        };
      }

      if (match(TokenType.KEYWORD, 'yield')) {
        consume();
        const value = match(TokenType.NEWLINE) || match(TokenType.COMMA) || match(TokenType.RPAREN) ? null : parseExpression();
        return {
          type: ASTNodeType.YIELD,
          value
        };
      }

      if (match(TokenType.LPAREN)) {
        consume();
        if (match(TokenType.RPAREN)) {
          consume();
          return { type: ASTNodeType.TUPLE_LITERAL, elements: [] };
        }
        const first = parseExpression();
        if (match(TokenType.KEYWORD, 'for')) {
          const comp = parseComprehension(first);
          expect(TokenType.RPAREN);
          return { type: ASTNodeType.GENERATOR_EXPR, expression: first, comprehension: comp };
        }
        if (match(TokenType.COMMA)) {
          const elements: ASTNode[] = [first];
          while (match(TokenType.COMMA)) {
            consume();
            if (match(TokenType.RPAREN)) break;
            elements.push(parseExpression());
          }
          expect(TokenType.RPAREN);
          return { type: ASTNodeType.TUPLE_LITERAL, elements };
        }
        expect(TokenType.RPAREN);
        return first;
      }

      if (match(TokenType.LBRACKET)) {
        consume();
        if (match(TokenType.RBRACKET)) {
          consume();
          return { type: ASTNodeType.LIST_LITERAL, elements: [] };
        }
        const first = parseExpression();
        if (match(TokenType.KEYWORD, 'for')) {
          const comp = parseComprehension(first);
          expect(TokenType.RBRACKET);
          return { type: ASTNodeType.LIST_COMP, expression: first, comprehension: comp };
        }
        const elements: ASTNode[] = [first];
        while (match(TokenType.COMMA)) {
          consume();
          if (match(TokenType.RBRACKET)) break;
          elements.push(parseExpression());
        }
        expect(TokenType.RBRACKET);
        return { type: ASTNodeType.LIST_LITERAL, elements };
      }

      if (match(TokenType.LBRACE)) {
        consume();
        if (match(TokenType.RBRACE)) {
          consume();
          return { type: ASTNodeType.DICT_LITERAL, entries: [] };
        }
        const first = parseExpression();
        if (match(TokenType.COLON)) {
          consume();
          const value = parseExpression();
          if (match(TokenType.KEYWORD, 'for')) {
            const comp = parseComprehension({ type: ASTNodeType.TUPLE_LITERAL, elements: [first, value] });
            expect(TokenType.RBRACE);
            return { type: ASTNodeType.DICT_COMP, key: first, value, comprehension: comp };
          }
          const entries: Array<{ key: ASTNode; value: ASTNode }> = [{ key: first, value }];
          while (match(TokenType.COMMA)) {
            consume();
            if (match(TokenType.RBRACE)) break;
            const key = parseExpression();
            expect(TokenType.COLON);
            const val = parseExpression();
            entries.push({ key, value: val });
          }
          expect(TokenType.RBRACE);
          return { type: ASTNodeType.DICT_LITERAL, entries };
        }
        if (match(TokenType.KEYWORD, 'for')) {
          const comp = parseComprehension(first);
          expect(TokenType.RBRACE);
          return { type: ASTNodeType.SET_COMP, expression: first, comprehension: comp };
        }
        const elements: ASTNode[] = [first];
        while (match(TokenType.COMMA)) {
          consume();
          if (match(TokenType.RBRACE)) break;
          elements.push(parseExpression());
        }
        expect(TokenType.RBRACE);
        return { type: ASTNodeType.SET_LITERAL, elements };
      }

      throw new Error(`Unexpected token in expression: ${peek()?.value}`);
    };

    const parsePostfix = (): ASTNode => {
      let expr = parseAtom();

      while (true) {
        if (match(TokenType.DOT)) {
          consume();
          const name = expect(TokenType.IDENTIFIER).value;
          expr = { type: ASTNodeType.ATTRIBUTE, object: expr, name };
          continue;
        }
        if (match(TokenType.LPAREN)) {
          consume();
          const args = parseArguments();
          expect(TokenType.RPAREN);
          expr = { type: ASTNodeType.CALL, callee: expr, args };
          continue;
        }
        if (match(TokenType.LBRACKET)) {
          consume();
          if (match(TokenType.RBRACKET)) {
            throw new Error('Empty subscript');
          }
          const slice = parseSlice();
          expect(TokenType.RBRACKET);
          expr = { type: ASTNodeType.SUBSCRIPT, object: expr, index: slice };
          continue;
        }
        break;
      }

      return expr;
    };

    const parsePostfixTarget = (): ASTNode => {
      let expr = parseAtom();
      while (true) {
        if (match(TokenType.DOT)) {
          consume();
          const name = expect(TokenType.IDENTIFIER).value;
          expr = { type: ASTNodeType.ATTRIBUTE, object: expr, name };
          continue;
        }
        if (match(TokenType.LBRACKET)) {
          consume();
          const slice = parseSlice();
          expect(TokenType.RBRACKET);
          expr = { type: ASTNodeType.SUBSCRIPT, object: expr, index: slice };
          continue;
        }
        break;
      }
      return expr;
    };

    const parseTarget = (): ASTNode => {
      const first = parsePostfixTarget();
      if (match(TokenType.COMMA)) {
        const elements: ASTNode[] = [first];
        while (match(TokenType.COMMA)) {
          consume();
          if (match(TokenType.NEWLINE) || match(TokenType.COLON)) break;
          elements.push(parsePostfixTarget());
        }
        return { type: ASTNodeType.TUPLE_LITERAL, elements };
      }
      return first;
    };

    const parseUnary = (): ASTNode => {
      if (match(TokenType.OPERATOR, '+') || match(TokenType.OPERATOR, '-') || match(TokenType.OPERATOR, '~')) {
        const op = consume().value;
        return { type: ASTNodeType.UNARY_OPERATION, operator: op, operand: parseUnary() };
      }
      if (match(TokenType.KEYWORD, 'not')) {
        consume();
        return { type: ASTNodeType.UNARY_OPERATION, operator: 'not', operand: parseUnary() };
      }
      return parsePostfix();
    };

    const parsePower = (): ASTNode => {
      let left = parseUnary();
      if (match(TokenType.OPERATOR, '**')) {
        consume();
        const right = parsePower();
        left = { type: ASTNodeType.BINARY_OPERATION, operator: '**', left, right };
      }
      return left;
    };

    const parseFactor = (): ASTNode => {
      let left = parsePower();
      while (match(TokenType.OPERATOR, '*') || match(TokenType.OPERATOR, '/') || match(TokenType.OPERATOR, '//') || match(TokenType.OPERATOR, '%')) {
        const op = consume().value;
        const right = parsePower();
        left = { type: ASTNodeType.BINARY_OPERATION, operator: op, left, right };
      }
      return left;
    };

    const parseTerm = (): ASTNode => {
      let left = parseFactor();
      while (match(TokenType.OPERATOR, '+') || match(TokenType.OPERATOR, '-')) {
        const op = consume().value;
        const right = parseFactor();
        left = { type: ASTNodeType.BINARY_OPERATION, operator: op, left, right };
      }
      return left;
    };

    const parseShift = (): ASTNode => {
      let left = parseTerm();
      while (match(TokenType.OPERATOR, '<<') || match(TokenType.OPERATOR, '>>')) {
        const op = consume().value;
        const right = parseTerm();
        left = { type: ASTNodeType.BINARY_OPERATION, operator: op, left, right };
      }
      return left;
    };

    const parseBitAnd = (): ASTNode => {
      let left = parseShift();
      while (match(TokenType.OPERATOR, '&')) {
        consume();
        const right = parseShift();
        left = { type: ASTNodeType.BINARY_OPERATION, operator: '&', left, right };
      }
      return left;
    };

    const parseBitXor = (): ASTNode => {
      let left = parseBitAnd();
      while (match(TokenType.OPERATOR, '^')) {
        consume();
        const right = parseBitAnd();
        left = { type: ASTNodeType.BINARY_OPERATION, operator: '^', left, right };
      }
      return left;
    };

    const parseBitOr = (): ASTNode => {
      let left = parseBitXor();
      while (match(TokenType.OPERATOR, '|')) {
        consume();
        const right = parseBitXor();
        left = { type: ASTNodeType.BINARY_OPERATION, operator: '|', left, right };
      }
      return left;
    };

    const parseComparison = (): ASTNode => {
      let left = parseBitOr();
      const ops: string[] = [];
      const comparators: ASTNode[] = [];

      while (match(TokenType.OPERATOR) || match(TokenType.KEYWORD)) {
        if (match(TokenType.KEYWORD, 'not') && peek(1)?.type === TokenType.KEYWORD && peek(1)?.value === 'in') {
          consume();
          consume();
          ops.push('not in');
          comparators.push(parseBitOr());
          continue;
        }
        if (match(TokenType.KEYWORD, 'is') && peek(1)?.type === TokenType.KEYWORD && peek(1)?.value === 'not') {
          consume();
          consume();
          ops.push('is not');
          comparators.push(parseBitOr());
          continue;
        }
        if (match(TokenType.OPERATOR, '==') || match(TokenType.OPERATOR, '!=') ||
            match(TokenType.OPERATOR, '<') || match(TokenType.OPERATOR, '>') ||
            match(TokenType.OPERATOR, '<=') || match(TokenType.OPERATOR, '>=') ||
            match(TokenType.KEYWORD, 'in') || match(TokenType.KEYWORD, 'is')) {
          const op = consume().value;
          ops.push(op);
          comparators.push(parseBitOr());
          continue;
        }
        break;
      }

      if (ops.length === 0) {
        return left;
      }
      return { type: ASTNodeType.COMPARE, left, ops, comparators };
    };

    const parseNot = (): ASTNode => {
      if (match(TokenType.KEYWORD, 'not')) {
        consume();
        return { type: ASTNodeType.UNARY_OPERATION, operator: 'not', operand: parseNot() };
      }
      return parseComparison();
    };

    const parseAnd = (): ASTNode => {
      let left = parseNot();
      while (match(TokenType.KEYWORD, 'and')) {
        consume();
        const right = parseNot();
        left = { type: ASTNodeType.BOOL_OPERATION, operator: 'and', values: [left, right] };
      }
      return left;
    };

    const parseOr = (): ASTNode => {
      let left = parseAnd();
      while (match(TokenType.KEYWORD, 'or')) {
        consume();
        const right = parseAnd();
        left = { type: ASTNodeType.BOOL_OPERATION, operator: 'or', values: [left, right] };
      }
      return left;
    };

    const parseIfExpression = (): ASTNode => {
      const expr = parseOr();
      if (match(TokenType.KEYWORD, 'if')) {
        consume();
        const test = parseOr();
        expect(TokenType.KEYWORD, 'else');
        const alternate = parseIfExpression();
        return { type: ASTNodeType.IF_EXPRESSION, test, consequent: expr, alternate };
      }
      return expr;
    };

    const parseExpression = (): ASTNode => parseIfExpression();
    const parseExpressionNoIf = (): ASTNode => parseOr();

    const parseComprehension = (expression: ASTNode): ASTNode => {
      const clauses: Array<{ target: ASTNode; iter: ASTNode; ifs: ASTNode[] }> = [];
      while (match(TokenType.KEYWORD, 'for')) {
        consume();
        const target = parseTarget();
        expect(TokenType.KEYWORD, 'in');
        const iter = parseExpressionNoIf();
        const ifs: ASTNode[] = [];
        while (match(TokenType.KEYWORD, 'if')) {
          consume();
          ifs.push(parseExpression());
        }
        clauses.push({ target, iter, ifs });
      }
      return { type: 'Comprehension', clauses, expression };
    };

    const parseExpressionStatement = (): ASTNode => {
      const expr = parseExpression();
      return { type: ASTNodeType.EXPRESSION_STATEMENT, expression: expr };
    };

    const parseExpressionList = (): ASTNode => {
      const first = parseExpression();
      if (match(TokenType.COMMA)) {
        const elements: ASTNode[] = [first];
        while (match(TokenType.COMMA)) {
          consume();
          if (match(TokenType.NEWLINE) || match(TokenType.RPAREN) || match(TokenType.RBRACKET) || match(TokenType.RBRACE)) break;
          elements.push(parseExpression());
        }
        return { type: ASTNodeType.TUPLE_LITERAL, elements };
      }
      return first;
    };

    const parseAssignmentOrExpression = (): ASTNode => {
      const startPos = this.pos;
      const target = parseTarget();
      if (match(TokenType.ASSIGN)) {
        consume();
        const value = parseExpressionList();
        return { type: ASTNodeType.ASSIGNMENT, targets: [target], value };
      }
      if (match(TokenType.OPERATOR) && ['+=', '-=', '*=', '/=', '%=', '//=', '**='].includes(peek()?.value || '')) {
        const op = consume().value;
        const value = parseExpressionList();
        return { type: ASTNodeType.AUG_ASSIGNMENT, target, operator: op, value };
      }
      this.pos = startPos;
      const expr = parseExpression();
      return { type: ASTNodeType.EXPRESSION_STATEMENT, expression: expr };
    };

    const parseBlock = (): ASTNode[] => {
      expect(TokenType.NEWLINE);
      expect(TokenType.INDENT);
      const body: ASTNode[] = [];
      while (!match(TokenType.DEDENT) && !match(TokenType.EOF)) {
        const stmt = parseStatement();
        body.push(stmt);
        skipNewlines();
      }
      expect(TokenType.DEDENT);
      return body;
    };

    const parseIfStatement = (): ASTNode => {
      expect(TokenType.KEYWORD, 'if');
      const test = parseExpression();
      expect(TokenType.COLON);
      const body = parseBlock();
      const elifs: Array<{ test: ASTNode; body: ASTNode[] }> = [];
      while (match(TokenType.KEYWORD, 'elif')) {
        consume();
        const elifTest = parseExpression();
        expect(TokenType.COLON);
        const elifBody = parseBlock();
        elifs.push({ test: elifTest, body: elifBody });
      }
      let orelse: ASTNode[] = [];
      if (match(TokenType.KEYWORD, 'else')) {
        consume();
        expect(TokenType.COLON);
        orelse = parseBlock();
      }
      return { type: ASTNodeType.IF_STATEMENT, test, body, elifs, orelse };
    };

    const parseWhileStatement = (): ASTNode => {
      expect(TokenType.KEYWORD, 'while');
      const test = parseExpression();
      expect(TokenType.COLON);
      const body = parseBlock();
      return { type: ASTNodeType.WHILE_STATEMENT, test, body };
    };

    const parseForStatement = (): ASTNode => {
      expect(TokenType.KEYWORD, 'for');
      const target = parseTarget();
      expect(TokenType.KEYWORD, 'in');
      const iter = parseExpression();
      expect(TokenType.COLON);
      const body = parseBlock();
      return { type: ASTNodeType.FOR_STATEMENT, target, iter, body };
    };

    const parseFunctionParameters = (): ASTNode[] => {
      const params: ASTNode[] = [];
      if (match(TokenType.RPAREN)) {
        return params;
      }
      while (true) {
        if (match(TokenType.OPERATOR, '*') || match(TokenType.OPERATOR, '**')) {
          const op = consume().value;
          const name = expect(TokenType.IDENTIFIER).value;
          params.push({ type: op === '*' ? 'VarArg' : 'KwArg', name });
        } else {
          const name = expect(TokenType.IDENTIFIER).value;
          let defaultValue: ASTNode | null = null;
          if (match(TokenType.ASSIGN)) {
            consume();
            defaultValue = parseExpression();
          }
          params.push({ type: 'Param', name, defaultValue });
        }
        if (!match(TokenType.COMMA)) break;
        consume();
        if (match(TokenType.RPAREN)) break;
      }
      return params;
    };

    const parseFunctionDef = (decorators: ASTNode[] = []): ASTNode => {
      expect(TokenType.KEYWORD, 'def');
      const name = expect(TokenType.IDENTIFIER).value;
      expect(TokenType.LPAREN);
      const params = parseFunctionParameters();
      expect(TokenType.RPAREN);
      expect(TokenType.COLON);
      const body = parseBlock();
      return { type: ASTNodeType.FUNCTION_DEF, name, params, body, decorators };
    };

    const parseClassDef = (decorators: ASTNode[] = []): ASTNode => {
      expect(TokenType.KEYWORD, 'class');
      const name = expect(TokenType.IDENTIFIER).value;
      let bases: ASTNode[] = [];
      if (match(TokenType.LPAREN)) {
        consume();
        if (!match(TokenType.RPAREN)) {
          bases.push(parseExpression());
          while (match(TokenType.COMMA)) {
            consume();
            if (match(TokenType.RPAREN)) break;
            bases.push(parseExpression());
          }
        }
        expect(TokenType.RPAREN);
      }
      expect(TokenType.COLON);
      const body = parseBlock();
      return { type: ASTNodeType.CLASS_DEF, name, bases, body, decorators };
    };

    const parseDecorators = (): ASTNode[] => {
      const decorators: ASTNode[] = [];
      while (match(TokenType.AT)) {
        consume();
        const expr = parseExpression();
        decorators.push(expr);
        expect(TokenType.NEWLINE);
        skipNewlines();
      }
      return decorators;
    };

    const parseTryStatement = (): ASTNode => {
      expect(TokenType.KEYWORD, 'try');
      expect(TokenType.COLON);
      const body = parseBlock();
      const handlers: ASTNode[] = [];
      while (match(TokenType.KEYWORD, 'except')) {
        consume();
        let exceptionType: ASTNode | null = null;
        let name: string | null = null;
        if (!match(TokenType.COLON)) {
          exceptionType = parseExpression();
          if (match(TokenType.KEYWORD, 'as')) {
            consume();
            name = expect(TokenType.IDENTIFIER).value;
          }
        }
        expect(TokenType.COLON);
        const handlerBody = parseBlock();
        handlers.push({ type: 'ExceptHandler', exceptionType, name, body: handlerBody });
      }
      let orelse: ASTNode[] = [];
      if (match(TokenType.KEYWORD, 'else')) {
        consume();
        expect(TokenType.COLON);
        orelse = parseBlock();
      }
      let finalbody: ASTNode[] = [];
      if (match(TokenType.KEYWORD, 'finally')) {
        consume();
        expect(TokenType.COLON);
        finalbody = parseBlock();
      }
      return { type: ASTNodeType.TRY_STATEMENT, body, handlers, orelse, finalbody };
    };

    const parseWithStatement = (): ASTNode => {
      expect(TokenType.KEYWORD, 'with');
      const items: Array<{ context: ASTNode; target: ASTNode | null }> = [];
      const context = parseExpression();
      let target: ASTNode | null = null;
      if (match(TokenType.KEYWORD, 'as')) {
        consume();
        target = parseExpression();
      }
      items.push({ context, target });
      while (match(TokenType.COMMA)) {
        consume();
        const ctx = parseExpression();
        let tgt: ASTNode | null = null;
        if (match(TokenType.KEYWORD, 'as')) {
          consume();
          tgt = parseExpression();
        }
        items.push({ context: ctx, target: tgt });
      }
      expect(TokenType.COLON);
      const body = parseBlock();
      return { type: ASTNodeType.WITH_STATEMENT, items, body };
    };

    const parseStatement = (): ASTNode => {
      skipNewlines();
      if (match(TokenType.AT)) {
        const decorators = parseDecorators();
        if (match(TokenType.KEYWORD, 'def')) return parseFunctionDef(decorators);
        if (match(TokenType.KEYWORD, 'class')) return parseClassDef(decorators);
        throw new Error('Decorator must be followed by def or class');
      }
      if (match(TokenType.KEYWORD, 'def')) return parseFunctionDef();
      if (match(TokenType.KEYWORD, 'class')) return parseClassDef();
      if (match(TokenType.KEYWORD, 'if')) return parseIfStatement();
      if (match(TokenType.KEYWORD, 'for')) return parseForStatement();
      if (match(TokenType.KEYWORD, 'while')) return parseWhileStatement();
      if (match(TokenType.KEYWORD, 'try')) return parseTryStatement();
      if (match(TokenType.KEYWORD, 'with')) return parseWithStatement();
      if (match(TokenType.KEYWORD, 'return')) {
        consume();
        const value = match(TokenType.NEWLINE) ? null : parseExpressionList();
        return { type: ASTNodeType.RETURN_STATEMENT, value };
      }
      if (match(TokenType.KEYWORD, 'break')) {
        consume();
        return { type: ASTNodeType.BREAK_STATEMENT };
      }
      if (match(TokenType.KEYWORD, 'continue')) {
        consume();
        return { type: ASTNodeType.CONTINUE_STATEMENT };
      }
      if (match(TokenType.KEYWORD, 'pass')) {
        consume();
        return { type: ASTNodeType.PASS_STATEMENT };
      }
      if (match(TokenType.KEYWORD, 'assert')) {
        consume();
        const test = parseExpression();
        let message: ASTNode | null = null;
        if (match(TokenType.COMMA)) {
          consume();
          message = parseExpression();
        }
        return { type: ASTNodeType.ASSERT_STATEMENT, test, message };
      }
      if (match(TokenType.KEYWORD, 'raise')) {
        consume();
        const exc = match(TokenType.NEWLINE) ? null : parseExpression();
        return { type: ASTNodeType.RAISE_STATEMENT, exception: exc };
      }
      if (match(TokenType.KEYWORD, 'global')) {
        consume();
        const names: string[] = [];
        names.push(expect(TokenType.IDENTIFIER).value);
        while (match(TokenType.COMMA)) {
          consume();
          names.push(expect(TokenType.IDENTIFIER).value);
        }
        return { type: ASTNodeType.GLOBAL_STATEMENT, names };
      }
      if (match(TokenType.KEYWORD, 'nonlocal')) {
        consume();
        const names: string[] = [];
        names.push(expect(TokenType.IDENTIFIER).value);
        while (match(TokenType.COMMA)) {
          consume();
          names.push(expect(TokenType.IDENTIFIER).value);
        }
        return { type: ASTNodeType.NONLOCAL_STATEMENT, names };
      }
      if (match(TokenType.KEYWORD, 'del')) {
        consume();
        const target = parseExpression();
        return { type: ASTNodeType.DELETE_STATEMENT, target };
      }
      return parseAssignmentOrExpression();
    };

    const parseProgram = (): ASTNode => {
      const body: ASTNode[] = [];
      skipNewlines();
      while (this.pos < this.tokens.length && !match(TokenType.EOF)) {
        const stmt = parseStatement();
        body.push(stmt);
        skipNewlines();
      }
      expect(TokenType.EOF);
      return { type: ASTNodeType.PROGRAM, body };
    };

    return parseProgram();
  }
}
