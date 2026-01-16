import { Token, TokenType } from '../types';

/**
 * 词法分析器 - 将源代码转换为 token 流
 */
export class Lexer {
  private code: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];
  private indentStack: number[] = [0];
  private atLineStart: boolean = true;

  constructor(code: string) {
    this.code = code;
  }

  tokenize(): Token[] {
    // Helper function to create a token
    const createToken = (type: TokenType, value: string): Token => ({
      type,
      value,
      line: this.line,
      column: this.column - value.length
    });

    // Helper function to advance position
    const advance = (n: number = 1) => {
      for (let i = 0; i < n; i++) {
        if (this.code[this.pos] === '\n') {
          this.line++;
          this.column = 1;
        } else {
          this.column++;
        }
        this.pos++;
      }
    };

    // Helper function to peek ahead
    const peek = (n: number = 0) => this.code[this.pos + n] || '';

    const emitIndentTokens = (indent: number) => {
      const currentIndent = this.indentStack[this.indentStack.length - 1];
      if (indent > currentIndent) {
        this.tokens.push(createToken(TokenType.INDENT, ''));
        this.indentStack.push(indent);
      } else if (indent < currentIndent) {
        while (indent < this.indentStack[this.indentStack.length - 1]) {
          this.tokens.push(createToken(TokenType.DEDENT, ''));
          this.indentStack.pop();
        }
        if (indent !== this.indentStack[this.indentStack.length - 1]) {
          throw new Error(`Indentation error at line ${this.line}`);
        }
      }
    };

    // Main tokenization loop
    while (this.pos < this.code.length) {
      if (this.atLineStart) {
        let indent = 0;
        while (peek() === ' ' || peek() === '\t') {
          indent += peek() === '\t' ? 4 : 1;
          advance();
        }

        if (peek() === '\n') {
          this.tokens.push(createToken(TokenType.NEWLINE, '\n'));
          advance();
          this.atLineStart = true;
          continue;
        }

        if (peek() === '#') {
          while (this.pos < this.code.length && peek() !== '\n') {
            advance();
          }
          continue;
        }

        emitIndentTokens(indent);
        this.atLineStart = false;
      }

      if (this.pos >= this.code.length) {
        break;
      }

      const char = peek();

      if (char === ' ' || char === '\t') {
        advance();
        continue;
      }

      if (char === '#') {
        while (this.pos < this.code.length && peek() !== '\n') {
          advance();
        }
        continue;
      }

      if (char === '\n') {
        this.tokens.push(createToken(TokenType.NEWLINE, '\n'));
        advance();
        this.atLineStart = true;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(peek(1)))) {
        let num = '';
        let hasDot = false;
        if (char === '.') {
          hasDot = true;
          num += '.';
          advance();
        }
        while (this.pos < this.code.length && /[0-9]/.test(peek())) {
          num += peek();
          advance();
        }
        if (peek() === '.' && !hasDot) {
          hasDot = true;
          num += '.';
          advance();
          while (this.pos < this.code.length && /[0-9]/.test(peek())) {
            num += peek();
            advance();
          }
        }
        if (peek() === 'j' || peek() === 'J') {
          num += peek();
          advance();
        }
        this.tokens.push(createToken(TokenType.NUMBER, num));
        continue;
      }

      // Strings
      if (char === '"' || char === "'" || ((char === 'f' || char === 'F') && (peek(1) === '"' || peek(1) === "'"))) {
        let prefix = '';
        let quote = char;
        if (char === 'f' || char === 'F') {
          prefix = char;
          quote = peek(1);
          advance();
        }
        let str = prefix + quote;
        advance();
        const isTriple = peek() === quote && peek(1) === quote;
        if (isTriple) {
          str += quote + quote;
          advance(2);
        }

        while (this.pos < this.code.length) {
          if (!isTriple && peek() === quote) {
            break;
          }
          if (isTriple && peek() === quote && peek(1) === quote && peek(2) === quote) {
            break;
          }
          if (peek() === '\\') {
            str += peek();
            advance();
            if (this.pos < this.code.length) {
              str += peek();
              advance();
            }
          } else {
            str += peek();
            advance();
          }
        }

        if (!isTriple && peek() === quote) {
          str += quote;
          advance();
        } else if (isTriple && peek() === quote && peek(1) === quote && peek(2) === quote) {
          str += quote + quote + quote;
          advance(3);
        } else {
          throw new Error(`Unterminated string at line ${this.line}`);
        }

        this.tokens.push(createToken(TokenType.STRING, str));
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(char)) {
        let ident = '';
        while (this.pos < this.code.length && /[a-zA-Z0-9_]/.test(peek())) {
          ident += peek();
          advance();
        }

        // Check for keywords and boolean literals
        if (ident === 'def' || ident === 'class' || ident === 'if' || ident === 'elif' || ident === 'else' ||
            ident === 'for' || ident === 'while' || ident === 'return' || ident === 'break' || ident === 'continue' ||
            ident === 'pass' || ident === 'in' || ident === 'is' || ident === 'and' || ident === 'or' || ident === 'not' ||
            ident === 'lambda' || ident === 'yield' || ident === 'try' || ident === 'except' || ident === 'finally' ||
            ident === 'with' || ident === 'as' || ident === 'global' || ident === 'nonlocal' || ident === 'assert' ||
            ident === 'raise' || ident === 'del' || ident === 'match' || ident === 'case') {
          this.tokens.push(createToken(TokenType.KEYWORD, ident));
        } else if (ident === 'True' || ident === 'False') {
          this.tokens.push(createToken(TokenType.BOOLEAN, ident));
        } else if (ident === 'None') {
          this.tokens.push(createToken(TokenType.NONE, ident));
        } else {
          this.tokens.push(createToken(TokenType.IDENTIFIER, ident));
        }
        continue;
      }

      // Operators and delimiters
      switch (char) {
        case '+':
          if (peek(1) === '=') {
            this.tokens.push(createToken(TokenType.OPERATOR, '+='));
            advance(2);
          } else {
            this.tokens.push(createToken(TokenType.OPERATOR, '+'));
            advance();
          }
          break;
        case '-':
          if (peek(1) === '=') {
            this.tokens.push(createToken(TokenType.OPERATOR, '-='));
            advance(2);
          } else {
            this.tokens.push(createToken(TokenType.OPERATOR, '-'));
            advance();
          }
          break;
        case '*':
          if (peek(1) === '*') {
            if (peek(2) === '=') {
              this.tokens.push(createToken(TokenType.OPERATOR, '**='));
              advance(3);
            } else {
              this.tokens.push(createToken(TokenType.OPERATOR, '**'));
              advance(2);
            }
          } else {
            if (peek(1) === '=') {
              this.tokens.push(createToken(TokenType.OPERATOR, '*='));
              advance(2);
            } else {
              this.tokens.push(createToken(TokenType.OPERATOR, '*'));
              advance();
            }
          }
          break;
        case '/':
          if (peek(1) === '/') {
            if (peek(2) === '=') {
              this.tokens.push(createToken(TokenType.OPERATOR, '//='));
              advance(3);
            } else {
              this.tokens.push(createToken(TokenType.OPERATOR, '//'));
              advance(2);
            }
          } else if (peek(1) === '=') {
            this.tokens.push(createToken(TokenType.OPERATOR, '/='));
            advance(2);
          } else {
            this.tokens.push(createToken(TokenType.OPERATOR, '/'));
            advance();
          }
          break;
        case '%':
          if (peek(1) === '=') {
            this.tokens.push(createToken(TokenType.OPERATOR, '%='));
            advance(2);
          } else {
            this.tokens.push(createToken(TokenType.OPERATOR, '%'));
            advance();
          }
          break;
        case '=':
          if (peek(1) === '=') {
            this.tokens.push(createToken(TokenType.OPERATOR, '=='));
            advance(2);
          } else {
            this.tokens.push(createToken(TokenType.ASSIGN, '='));
            advance();
          }
          break;
        case '!':
          if (peek(1) === '=') {
            this.tokens.push(createToken(TokenType.OPERATOR, '!='));
            advance(2);
          } else {
            throw new Error(`Unexpected character '!' at line ${this.line}`);
          }
          break;
        case '&':
          this.tokens.push(createToken(TokenType.OPERATOR, '&'));
          advance();
          break;
        case '|':
          this.tokens.push(createToken(TokenType.OPERATOR, '|'));
          advance();
          break;
        case '^':
          this.tokens.push(createToken(TokenType.OPERATOR, '^'));
          advance();
          break;
        case '~':
          this.tokens.push(createToken(TokenType.OPERATOR, '~'));
          advance();
          break;
        case '<':
          if (peek(1) === '<') {
            this.tokens.push(createToken(TokenType.OPERATOR, '<<'));
            advance(2);
          } else if (peek(1) === '=') {
            this.tokens.push(createToken(TokenType.OPERATOR, '<='));
            advance(2);
          } else {
            this.tokens.push(createToken(TokenType.OPERATOR, '<'));
            advance();
          }
          break;
        case '>':
          if (peek(1) === '>') {
            this.tokens.push(createToken(TokenType.OPERATOR, '>>'));
            advance(2);
          } else if (peek(1) === '=') {
            this.tokens.push(createToken(TokenType.OPERATOR, '>='));
            advance(2);
          } else {
            this.tokens.push(createToken(TokenType.OPERATOR, '>'));
            advance();
          }
          break;
        case '(':
          this.tokens.push(createToken(TokenType.LPAREN, '('));
          advance();
          break;
        case ')':
          this.tokens.push(createToken(TokenType.RPAREN, ')'));
          advance();
          break;
        case '[':
          this.tokens.push(createToken(TokenType.LBRACKET, '['));
          advance();
          break;
        case ']':
          this.tokens.push(createToken(TokenType.RBRACKET, ']'));
          advance();
          break;
        case '{':
          this.tokens.push(createToken(TokenType.LBRACE, '{'));
          advance();
          break;
        case '}':
          this.tokens.push(createToken(TokenType.RBRACE, '}'));
          advance();
          break;
        case ':':
          this.tokens.push(createToken(TokenType.COLON, ':'));
          advance();
          break;
        case ',':
          this.tokens.push(createToken(TokenType.COMMA, ','));
          advance();
          break;
        case '.':
          this.tokens.push(createToken(TokenType.DOT, '.'));
          advance();
          break;
        case '@':
          this.tokens.push(createToken(TokenType.AT, '@'));
          advance();
          break;
        case ' ':
        case '\t':
          // Should be handled by skipWhitespace
          advance();
          break;
        default:
          throw new Error(`Unexpected character '${char}' at line ${this.line}, column ${this.column}`);
      }
    }

    while (this.indentStack.length > 1) {
      this.tokens.push(createToken(TokenType.DEDENT, ''));
      this.indentStack.pop();
    }

    // Add EOF
    this.tokens.push(createToken(TokenType.EOF, ''));

    return this.tokens;
  }
}
