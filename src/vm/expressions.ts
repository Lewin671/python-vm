import type { VirtualMachine } from './vm';
import { ASTNodeType } from '../types';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { PyClass, PyDict, PyException, PyFunction, PyGenerator, PyInstance, PySet, Scope } from './runtime-types';
import {
  isFloatObject,
  isIntObject,
  isNumericLike,
  numericCompare,
  numericEquals,
  parseStringToken,
  pyStr,
  toNumber,
} from './value-utils';

export function evaluateExpression(this: VirtualMachine, node: any, scope: Scope): any {
  switch (node.type) {
    case ASTNodeType.NUMBER_LITERAL: {
      const raw = node.value;
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string' && raw.endsWith('j')) {
        const imag = parseFloat(raw.slice(0, -1));
        return { __complex__: true, re: 0, im: imag };
      }
      if (raw.includes('.')) return new Number(parseFloat(raw));
      const big = BigInt(raw);
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
      if (big > maxSafe || big < minSafe) return big;
      return Number(raw);
    }
    case ASTNodeType.STRING_LITERAL: {
      const { value, isFString } = parseStringToken(node.value);
      if (isFString) {
        return value.replace(/\{([^}]+)\}/g, (_m, expr) => {
          const { rawExpr, rawSpec } = this.splitFormatSpec(expr);
          const inner = this.evaluateExpressionString(rawExpr.trim(), scope);
          const formatted = this.applyFormatSpec(inner, rawSpec ? rawSpec.trim() : '');
          return formatted;
        });
      }
      return value;
    }
    case ASTNodeType.BOOLEAN_LITERAL:
      return node.value;
    case ASTNodeType.NONE_LITERAL:
      return null;
    case ASTNodeType.IDENTIFIER:
      return scope.get(node.name);
    case ASTNodeType.LIST_LITERAL:
      return node.elements.map((el: any) => this.evaluateExpression(el, scope));
    case ASTNodeType.LIST_COMP: {
      const result: any[] = [];
      const compScope = new Scope(scope);
      this.evaluateComprehension(node.comprehension, compScope, () => {
        result.push(this.evaluateExpression(node.expression, compScope));
      }, scope);
      return result;
    }
    case ASTNodeType.TUPLE_LITERAL: {
      const arr = node.elements.map((el: any) => this.evaluateExpression(el, scope));
      (arr as any).__tuple__ = true;
      return arr;
    }
    case ASTNodeType.SET_COMP: {
      const result = new PySet();
      const compScope = new Scope(scope);
      this.evaluateComprehension(node.comprehension, compScope, () => {
        result.add(this.evaluateExpression(node.expression, compScope));
      }, scope);
      return result;
    }
    case ASTNodeType.SET_LITERAL:
      return new PySet(node.elements.map((el: any) => this.evaluateExpression(el, scope)));
    case ASTNodeType.DICT_LITERAL: {
      const map = new PyDict();
      for (const entry of node.entries) {
        map.set(this.evaluateExpression(entry.key, scope), this.evaluateExpression(entry.value, scope));
      }
      return map;
    }
    case ASTNodeType.DICT_COMP: {
      const map = new PyDict();
      const compScope = new Scope(scope);
      this.evaluateComprehension(node.comprehension, compScope, () => {
        map.set(this.evaluateExpression(node.key, compScope), this.evaluateExpression(node.value, compScope));
      }, scope);
      return map;
    }
    case ASTNodeType.GENERATOR_EXPR: {
      const self = this;
      const compScope = new Scope(scope);
      const iterator = function* () {
        yield* self.generateComprehension(
          node.comprehension,
          compScope,
          () => self.evaluateExpression(node.expression, compScope),
          scope
        );
      };
      return new PyGenerator(iterator());
    }
    case ASTNodeType.BINARY_OPERATION: {
      const left = this.evaluateExpression(node.left, scope);
      const right = this.evaluateExpression(node.right, scope);
      return this.applyBinary(node.operator, left, right);
    }
    case ASTNodeType.UNARY_OPERATION: {
      const operand = this.evaluateExpression(node.operand, scope);
      switch (node.operator) {
        case 'not':
          return !this.isTruthy(operand, scope);
        case '+':
          return typeof operand === 'bigint' ? operand : +operand;
        case '-':
          if (isIntObject(operand)) {
            const boxed = new Number(-operand.valueOf());
            (boxed as any).__int__ = true;
            return boxed;
          }
          if (isFloatObject(operand)) return new Number(-operand.valueOf());
          return -operand;
        case '~':
          return ~operand;
        default:
          throw new PyException('TypeError', `unsupported unary operator ${node.operator}`);
      }
    }
    case ASTNodeType.BOOL_OPERATION: {
      if (node.operator === 'and') {
        const left = this.evaluateExpression(node.values[0], scope);
        return this.isTruthy(left, scope) ? this.evaluateExpression(node.values[1], scope) : left;
      }
      const left = this.evaluateExpression(node.values[0], scope);
      return this.isTruthy(left, scope) ? left : this.evaluateExpression(node.values[1], scope);
    }
    case ASTNodeType.COMPARE: {
      let left = this.evaluateExpression(node.left, scope);
      for (let i = 0; i < node.ops.length; i++) {
        const op = node.ops[i];
        const right = this.evaluateExpression(node.comparators[i], scope);
        let result = false;
        switch (op) {
          case '==':
            result = numericEquals(left, right);
            break;
          case '!=':
            result = !numericEquals(left, right);
            break;
          case '<': {
            const numeric = numericCompare(left, right);
            if (numeric) {
              if (numeric.kind === 'float') {
                result =
                  !Number.isNaN(numeric.left) && !Number.isNaN(numeric.right) && (numeric.left as number) < (numeric.right as number);
              } else {
                result = (numeric.left as bigint) < (numeric.right as bigint);
              }
            } else {
              result = left < right;
            }
            break;
          }
          case '>': {
            const numeric = numericCompare(left, right);
            if (numeric) {
              if (numeric.kind === 'float') {
                result =
                  !Number.isNaN(numeric.left) && !Number.isNaN(numeric.right) && (numeric.left as number) > (numeric.right as number);
              } else {
                result = (numeric.left as bigint) > (numeric.right as bigint);
              }
            } else {
              result = left > right;
            }
            break;
          }
          case '<=': {
            const numeric = numericCompare(left, right);
            if (numeric) {
              if (numeric.kind === 'float') {
                result =
                  !Number.isNaN(numeric.left) && !Number.isNaN(numeric.right) && (numeric.left as number) <= (numeric.right as number);
              } else {
                result = (numeric.left as bigint) <= (numeric.right as bigint);
              }
            } else {
              result = left <= right;
            }
            break;
          }
          case '>=': {
            const numeric = numericCompare(left, right);
            if (numeric) {
              if (numeric.kind === 'float') {
                result =
                  !Number.isNaN(numeric.left) && !Number.isNaN(numeric.right) && (numeric.left as number) >= (numeric.right as number);
              } else {
                result = (numeric.left as bigint) >= (numeric.right as bigint);
              }
            } else {
              result = left >= right;
            }
            break;
          }
          case 'in':
            result = this.contains(right, left);
            break;
          case 'not in':
            result = !this.contains(right, left);
            break;
          case 'is':
            result = left === right;
            break;
          case 'is not':
            result = left !== right;
            break;
          default:
            throw new PyException('TypeError', `unsupported comparison ${op}`);
        }
        if (!result) return false;
        left = right;
      }
      return true;
    }
    case ASTNodeType.CALL: {
      const callee = this.evaluateExpression(node.callee, scope);
      const positional: any[] = [];
      const kwargs: Record<string, any> = {};
      for (const arg of node.args) {
        if (arg.type === 'KeywordArg') {
          kwargs[arg.name] = this.evaluateExpression(arg.value, scope);
        } else if (arg.type === 'StarArg') {
          const value = this.evaluateExpression(arg.value, scope);
          positional.push(...(Array.isArray(value) ? value : Array.from(value)));
        } else if (arg.type === 'KwArg') {
          const value = this.evaluateExpression(arg.value, scope);
          Object.assign(kwargs, value);
        } else {
          positional.push(this.evaluateExpression(arg, scope));
        }
      }
      return this.callFunction(callee, positional, scope, kwargs);
    }
    case ASTNodeType.ATTRIBUTE: {
      const obj = this.evaluateExpression(node.object, scope);
      return this.getAttribute(obj, node.name, scope);
    }
    case ASTNodeType.SUBSCRIPT: {
      const obj = this.evaluateExpression(node.object, scope);
      if (node.index && node.index.type === ASTNodeType.SLICE) {
        const slice = {
          type: ASTNodeType.SLICE,
          start: node.index.start ? this.evaluateExpression(node.index.start, scope) : null,
          end: node.index.end ? this.evaluateExpression(node.index.end, scope) : null,
          step: node.index.step ? this.evaluateExpression(node.index.step, scope) : null,
        };
        return this.getSubscript(obj, slice);
      }
      const index = this.evaluateExpression(node.index, scope);
      return this.getSubscript(obj, index);
    }
    case ASTNodeType.IF_EXPRESSION: {
      const test = this.evaluateExpression(node.test, scope);
      return this.isTruthy(test, scope)
        ? this.evaluateExpression(node.consequent, scope)
        : this.evaluateExpression(node.alternate, scope);
    }
    case ASTNodeType.LAMBDA: {
      return new PyFunction(
        '<lambda>',
        node.params.map((p: string) => ({ type: 'Param', name: p })),
        [
          {
            type: ASTNodeType.RETURN_STATEMENT,
            value: node.body,
          },
        ],
        scope,
        false
      );
    }
    default:
      throw new Error(`Unsupported expression type: ${node.type}`);
  }
}

export function evaluateExpressionString(this: VirtualMachine, expr: string, scope: Scope): any {
  const wrapped = `__f = ${expr}\n`;
  const tokens = new Lexer(wrapped).tokenize();
  const ast = new Parser(tokens).parse();
  const assignment = ast.body[0];
  if (!assignment || assignment.type !== ASTNodeType.ASSIGNMENT) {
    return this.executeExpressionInline(expr, scope);
  }
  return this.evaluateExpression(assignment.value, scope);
}

export function executeExpressionInline(this: VirtualMachine, expr: string, scope: Scope): any {
  const tokens = expr.trim().split(/\s+/);
  if (tokens.length === 1 && scope.values.has(tokens[0])) {
    return scope.get(tokens[0]);
  }
  return expr;
}

export function applyFormatSpec(this: VirtualMachine, value: any, spec: string): string {
  if (!spec) return pyStr(value);
  if (spec.endsWith('%')) {
    const digits = spec.includes('.') ? parseInt(spec.split('.')[1], 10) : 0;
    const num = isNumericLike(value) ? toNumber(value) : parseFloat(value);
    return (num * 100).toFixed(digits) + '%';
  }
  if (spec.includes('.')) {
    const parts = spec.split('.');
    const width = parts[0];
    const precision = parseInt(parts[1].replace(/[^\d]/g, ''), 10);
    const num = isNumericLike(value) ? toNumber(value) : parseFloat(value);
    const formatted = num.toFixed(precision);
    return this.applyWidth(formatted, width);
  }
  if (spec === 'd') return typeof value === 'bigint' ? value.toString() : String(parseInt(value, 10));
  if (spec === 'b') return typeof value === 'bigint' ? value.toString(2) : Number(value).toString(2);
  if (spec === 'x') return typeof value === 'bigint' ? value.toString(16) : Number(value).toString(16);
  if (spec === 'o') return typeof value === 'bigint' ? value.toString(8) : Number(value).toString(8);
  return this.applyWidth(String(value), spec);
}

export function splitFormatSpec(expr: string): { rawExpr: string; rawSpec: string } {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ':' && depth === 0) {
      return { rawExpr: expr.slice(0, i), rawSpec: expr.slice(i + 1) };
    }
  }
  return { rawExpr: expr, rawSpec: '' };
}

export function applyWidth(text: string, spec: string): string {
  const match = spec.match(/([<^>])?(\d+)/);
  if (!match) return text;
  const align = match[1] || '>';
  const width = parseInt(match[2], 10);
  if (text.length >= width) return text;
  const padding = width - text.length;
  if (align === '<') return text + ' '.repeat(padding);
  if (align === '^') {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  return ' '.repeat(padding) + text;
}

export function contains(this: VirtualMachine, container: any, value: any): boolean {
  if (Array.isArray(container)) {
    if (isNumericLike(value)) {
      return container.some((item) => isNumericLike(item) && numericEquals(item, value));
    }
    return container.includes(value);
  }
  if (typeof container === 'string') return container.includes(value);
  if (container instanceof PySet) {
    return container.has(value);
  }
  if (container instanceof PyDict) return container.has(value);
  return false;
}

