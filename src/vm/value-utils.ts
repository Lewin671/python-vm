import { PyClass, PyDict, PyException, PyFunction, PyInstance, PySet } from './runtime-types';
export { parseStringToken } from '../common/string-token';

export const isPyNone = (value: any) => value === null;

export const isBigInt = (value: any): value is bigint => typeof value === 'bigint';
export const isIntObject = (value: any): boolean => value instanceof Number && (value as any).__int__ === true;
export const isFloatObject = (value: any): boolean => value instanceof Number && !isIntObject(value);
export const isFloatLike = (value: any): boolean => isFloatObject(value) || (typeof value === 'number' && !Number.isInteger(value));
export const isIntLike = (value: any): boolean =>
  isBigInt(value) ||
  value === true ||
  value === false ||
  (typeof value === 'number' && Number.isInteger(value)) ||
  isIntObject(value);
export const isNumericLike = (value: any): boolean =>
  isBigInt(value) || typeof value === 'number' || value instanceof Number || typeof value === 'boolean';
export const toNumber = (value: any): number => {
  if (value instanceof Number) return value.valueOf();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  return value;
};
export const toBigIntValue = (value: any): bigint => {
  if (typeof value === 'bigint') return value;
  if (value instanceof Number) return BigInt(Math.trunc(value.valueOf()));
  if (typeof value === 'number') return BigInt(value);
  return BigInt(value);
};
export const shouldUseBigInt = (left: any, right: any): boolean =>
  (isBigInt(left) || isBigInt(right)) && !isFloatLike(left) && !isFloatLike(right);
export const numericEquals = (left: any, right: any): boolean => {
  if (isNumericLike(left) && isNumericLike(right)) {
    const l = left instanceof Number ? left.valueOf() : left;
    const r = right instanceof Number ? right.valueOf() : right;
    // Use loose equality to handle mixed types (int, float, bool, bigint)
    // JS == handles bigint vs number correctly without precision loss.
    return l == r;
  }
  return left === right;
};
export const numericCompare = (
  left: any,
  right: any
): { left: any; right: any } | null => {
  if (!isNumericLike(left) || !isNumericLike(right)) return null;
  const l = left instanceof Number ? left.valueOf() : left;
  const r = right instanceof Number ? right.valueOf() : right;
  return { left: l, right: r };
};

export const bigIntFloorDiv = (left: bigint, right: bigint): bigint => {
  const quotient = left / right;
  if (left % right === 0n) return quotient;
  if ((left < 0n) !== (right < 0n)) return quotient - 1n;
  return quotient;
};

export const pyTypeName = (value: any): string => {
  if (value === null) return 'NoneType';
  if (isBigInt(value)) return 'int';
  if (isIntObject(value)) return 'int';
  if (value instanceof Number) return 'float';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'str';
  if (Array.isArray(value)) return (value as any).__tuple__ ? 'tuple' : 'list';
  if (value instanceof PySet) return 'set';
  if (value instanceof PyDict) return 'dict';
  if (value instanceof PyFunction) return 'function';
  if (value instanceof PyClass) return 'type';
  if (value instanceof PyInstance) return value.klass.name;
  return typeof value;
};

export const pyRepr = (value: any, seen: Set<any> = new Set()): string => {
  if (value === null) return 'None';
  if (value instanceof Number) {
    const num = value.valueOf();
    if (Number.isNaN(num)) return 'nan';
    if (num === Infinity) return 'inf';
    if (num === -Infinity) return '-inf';
    if (isIntObject(value)) return String(num);
    if (Object.is(num, -0)) return '-0.0';
    return Number.isInteger(num) ? `${num}.0` : String(num);
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (Object.is(value, -0)) return '-0.0';
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (value && value.__complex__) {
    const sign = value.im >= 0 ? '+' : '-';
    const imag = Math.abs(value.im);
    return `(${value.re}${sign}${imag}j)`;
  }
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;

  const isContainer = Array.isArray(value) || value instanceof PySet || value instanceof PyDict;
  if (isContainer) {
    if (seen.has(value)) {
      if (Array.isArray(value)) return (value as any).__tuple__ ? '(...)' : '[...]';
      return '{...}';
    }
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const items = value.map((v: any) => pyRepr(v, seen)).join(', ');
        if ((value as any).__tuple__) {
          if (value.length === 1) return `(${items},)`;
          return `(${items})`;
        }
        return `[${items}]`;
      }
      if (value instanceof PySet) {
        const items = Array.from(value.values())
          .map((v) => pyRepr(v, seen))
          .join(', ');
        return `{${items}}`;
      }
      if (value instanceof PyDict) {
        const items = Array.from(value.entries())
          .map(([k, v]) => `${pyRepr(k, seen)}: ${pyRepr(v, seen)}`)
          .join(', ');
        return `{${items}}`;
      }
    } finally {
      seen.delete(value);
    }
  }

  if (value instanceof PyFunction) return `<function ${value.name}>`;
  if (value instanceof PyClass) return `<class '${value.name}'>`;
  if (value instanceof PyInstance) return `<${value.klass.name} object>`;
  return String(value);
};

export const pyStr = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value && value.__complex__) return pyRepr(value);
  if (value && value.__typeName__) return `<class '${value.__typeName__}'>`;
  if (value instanceof PyException) return value.message;
  if (value instanceof PyInstance && value.klass.isException) {
    const msg = value.attributes.get('message');
    return msg === undefined || msg === null ? '' : String(msg);
  }
  return pyRepr(value);
};

export const isComplex = (value: any) => value && value.__complex__;

export const toComplex = (value: any) => {
  if (isComplex(value)) return value;
  if (isNumericLike(value)) return { __complex__: true, re: toNumber(value), im: 0 };
  return { __complex__: true, re: 0, im: 0 };
};

export const pythonModulo = (left: any, right: any) => {
  if (shouldUseBigInt(left, right)) {
    const leftNum = toBigIntValue(left);
    const rightNum = toBigIntValue(right);
    if (rightNum === 0n) throw new PyException('ZeroDivisionError', 'division by zero');
    const remainder = leftNum % rightNum;
    const adjust = remainder !== 0n && (leftNum < 0n) !== (rightNum < 0n);
    const quotient = leftNum / rightNum - (adjust ? 1n : 0n);
    return leftNum - quotient * rightNum;
  }
  const leftNum = toNumber(left);
  const rightNum = toNumber(right);
  if (rightNum === 0) throw new PyException('ZeroDivisionError', 'division by zero');
  const quotient = Math.floor(leftNum / rightNum);
  const result = leftNum - quotient * rightNum;
  if (isFloatObject(left) || isFloatObject(right)) {
    return new Number(result);
  }
  return result;
};

import { ASTNodeType } from '../types';

export function findLocalVariables(body: any[]): Set<string> {
  const locals = new Set<string>();
  const globals = new Set<string>();
  const nonlocals = new Set<string>();

  function collect(node: any) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
      return;
    }

    switch (node.type) {
      case ASTNodeType.ASSIGNMENT:
        for (const target of node.targets) collectTarget(target);
        break;
      case ASTNodeType.AUG_ASSIGNMENT:
        collectTarget(node.target);
        break;
      case ASTNodeType.FOR_STATEMENT:
        collectTarget(node.target);
        collect(node.body);
        collect(node.orelse);
        break;
      case ASTNodeType.WITH_STATEMENT:
        for (const item of node.items) {
          if (item.target) collectTarget(item.target);
        }
        collect(node.body);
        break;
      case ASTNodeType.TRY_STATEMENT:
        collect(node.body);
        for (const handler of node.handlers) {
          if (handler.name) locals.add(handler.name);
          collect(handler.body);
        }
        collect(node.orelse);
        collect(node.finalbody);
        break;
      case ASTNodeType.FUNCTION_DEF:
        locals.add(node.name);
        // Do not recurse into nested function body for local variable analysis of current scope
        break;
      case ASTNodeType.CLASS_DEF:
        locals.add(node.name);
        // Do not recurse into class body
        break;
      case ASTNodeType.IMPORT_STATEMENT:
        for (const entry of node.names) {
          const bindingName = entry.alias || entry.name.split('.')[0];
          locals.add(bindingName);
        }
        break;
      case ASTNodeType.GLOBAL_STATEMENT:
        for (const name of node.names) globals.add(name);
        break;
      case ASTNodeType.NONLOCAL_STATEMENT:
        for (const name of node.names) nonlocals.add(name);
        break;
      case ASTNodeType.IF_STATEMENT:
        collect(node.body);
        for (const elif of node.elifs) collect(elif.body);
        collect(node.orelse);
        break;
      case ASTNodeType.WHILE_STATEMENT:
        collect(node.body);
        collect(node.orelse);
        break;
      case ASTNodeType.MATCH_STATEMENT:
        for (const matchCase of node.cases) {
          collectPattern(matchCase.pattern);
          collect(matchCase.body);
        }
        break;
      case ASTNodeType.DELETE_STATEMENT:
        // delete does not bind, but it can only delete variables in the current scope if they are local
        break;
    }
  }

  function collectTarget(target: any) {
    if (target.type === ASTNodeType.IDENTIFIER) {
      locals.add(target.name);
    } else if (target.type === ASTNodeType.TUPLE_LITERAL || target.type === ASTNodeType.LIST_LITERAL) {
      for (const element of target.elements) {
        if (element.type === ASTNodeType.STARRED) {
          collectTarget(element.target);
        } else {
          collectTarget(element);
        }
      }
    }
  }

  function collectPattern(pattern: any) {
    if (!pattern) return;
    switch (pattern.type) {
      case ASTNodeType.MATCH_PATTERN_CAPTURE:
        locals.add(pattern.name);
        break;
      case ASTNodeType.MATCH_PATTERN_OR:
        if (pattern.patterns) {
          for (const p of pattern.patterns) collectPattern(p);
        }
        break;
      case ASTNodeType.MATCH_PATTERN_SEQUENCE: {
        const elements = pattern.elements || pattern.patterns;
        if (elements) {
          for (const p of elements) collectPattern(p);
        }
        break;
      }
      case 'MatchAs':
        if (pattern.name) locals.add(pattern.name);
        if (pattern.pattern) collectPattern(pattern.pattern);
        break;
      case 'MatchSequence':
        if (pattern.patterns) {
          for (const p of pattern.patterns) collectPattern(p);
        }
        break;
      case 'MatchMapping':
        if (pattern.patterns) {
          for (const p of pattern.patterns) collectPattern(p);
        }
        if (pattern.keys) {
          for (const { pattern: p } of pattern.keys) collectPattern(p);
        }
        break;
      case 'MatchClass':
        if (pattern.patterns) {
          for (const p of pattern.patterns) collectPattern(p);
        }
        break;
    }
  }

  collect(body);

  // Remove variables declared global or nonlocal from locals
  for (const g of globals) locals.delete(g);
  for (const n of nonlocals) locals.delete(n);

  return locals;
}
