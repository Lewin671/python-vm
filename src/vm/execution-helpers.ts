import type { VirtualMachine } from './vm';
import { ASTNodeType, CompareOp } from '../types';
import { BreakSignal, ContinueSignal, PyClass, PyDict, PyException, PyInstance, PySet, ReturnSignal, Scope } from './runtime-types';
import { numericEquals } from './value-utils';

export function applyCompare(this: VirtualMachine, op: CompareOp, a: any, b: any): boolean {
  switch (op) {
    case CompareOp.EQ:
      return numericEquals(a, b);
    case CompareOp.NE:
      return !numericEquals(a, b);
    case CompareOp.LT:
      return a < b;
    case CompareOp.LE:
      return a <= b;
    case CompareOp.GT:
      return a > b;
    case CompareOp.GE:
      return a >= b;
    case CompareOp.IS:
      return a === b;
    case CompareOp.IS_NOT:
      return a !== b;
    case CompareOp.IN:
      return this.contains(b, a);
    case CompareOp.NOT_IN:
      return !this.contains(b, a);
    default:
      return false;
  }
}

export function iterableToArray(this: VirtualMachine, iterable: any): any[] {
  if (iterable instanceof PyDict) return Array.from(iterable.keys());
  if (iterable instanceof PySet) return Array.from(iterable.values());
  if (Array.isArray(iterable)) return iterable;
  if (iterable && typeof iterable[Symbol.iterator] === 'function') return Array.from(iterable);
  throw new Error('Object is not iterable');
}

export function matchValueEquals(left: any, right: any): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (!matchValueEquals(left[i], right[i])) return false;
    }
    return true;
  }
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false;
    for (const [k, v] of left.entries()) {
      if (!right.has(k) || !matchValueEquals(v, right.get(k))) return false;
    }
    return true;
  }
  return left === right;
}

export function applyBindings(bindings: Map<string, any>, scope: Scope): void {
  for (const [name, value] of bindings.entries()) {
    scope.set(name, value);
  }
}

export function matchPattern(
  this: VirtualMachine,
  node: any,
  value: any,
  scope: Scope
): { matched: boolean; bindings: Map<string, any> } {
  switch (node.type) {
    case ASTNodeType.MATCH_PATTERN_WILDCARD:
      return { matched: true, bindings: new Map() };
    case ASTNodeType.MATCH_PATTERN_CAPTURE: {
      const bindings = new Map<string, any>();
      bindings.set(node.name, value);
      return { matched: true, bindings };
    }
    case ASTNodeType.MATCH_PATTERN_VALUE: {
      const expected = this.evaluateExpression(node.value, scope);
      return { matched: matchValueEquals(value, expected), bindings: new Map() };
    }
    case ASTNodeType.MATCH_PATTERN_SEQUENCE: {
      if (!Array.isArray(value)) return { matched: false, bindings: new Map() };
      if (value.length !== node.elements.length) return { matched: false, bindings: new Map() };
      const bindings = new Map<string, any>();
      for (let i = 0; i < node.elements.length; i++) {
        const result = this.matchPattern(node.elements[i], value[i], scope);
        if (!result.matched) return { matched: false, bindings: new Map() };
        for (const [key, val] of result.bindings.entries()) {
          bindings.set(key, val);
        }
      }
      return { matched: true, bindings };
    }
    case ASTNodeType.MATCH_PATTERN_OR: {
      for (const pattern of node.patterns) {
        const result = this.matchPattern(pattern, value, scope);
        if (result.matched) return result;
      }
      return { matched: false, bindings: new Map() };
    }
    default:
      throw new Error(`Unsupported match pattern: ${node.type}`);
  }
}

export function evaluateExpression(this: VirtualMachine, _node: any, _scope: Scope): any {
  throw new Error('evaluateExpression is deprecated, use bytecode');
}

export function executeStatement(this: VirtualMachine, _node: any, _scope: Scope): any {
  throw new Error('executeStatement is deprecated, use bytecode');
}

export function* executeBlockGenerator(
  this: VirtualMachine,
  body: any[],
  scope: Scope
): Generator<any, any, any> {
  for (const stmt of body) {
    yield* this.executeStatementGenerator(stmt, scope);
  }
  return null;
}

export function* executeStatementGenerator(
  this: VirtualMachine,
  node: any,
  scope: Scope
): Generator<any, any, any> {
  const isSubclass = (klass: PyClass, target: PyClass): boolean => {
    if (klass === target) return true;
    return klass.bases.some((b) => isSubclass(b, target));
  };
  const normalizeThrown = (err: any): any => {
    if (err instanceof PyInstance && err.klass.isException) return err;
    if (err instanceof PyClass && err.isException) return new PyInstance(err);
    if (err instanceof PyException) {
      try {
        const klass = scope.get(err.pyType);
        if (klass instanceof PyClass) {
          const inst = new PyInstance(klass);
          if (err.message) inst.attributes.set('message', err.message);
          return inst;
        }
      } catch {
        // ignore
      }
    }
    return err;
  };

  const matches = (expected: any, thrown: any): boolean => {
    if (!expected) return true;
    const norm = normalizeThrown(thrown);
    if (expected instanceof PyInstance && expected.klass.isException) {
      expected = expected.klass;
    }
    if (expected instanceof PyClass && expected.isException) {
      if (norm instanceof PyInstance && norm.klass.isException) {
        return isSubclass(norm.klass, expected);
      }
      if (norm instanceof PyClass && norm.isException) {
        return isSubclass(norm, expected);
      }
      return false;
    }
    return false;
  };

  switch (node.type) {
    case ASTNodeType.EXPRESSION_STATEMENT: {
      const expr = node.expression;
      if (expr && expr.type === ASTNodeType.YIELD) {
        const value = expr.value ? this.evaluateExpression(expr.value, scope) : null;
        yield value;
        return;
      }
      if (expr) {
        this.evaluateExpression(expr, scope);
      }
      return;
    }

    case ASTNodeType.ASSIGNMENT: {
      if (node.value && node.value.type === ASTNodeType.YIELD) {
        const yielded = node.value.value ? this.evaluateExpression(node.value.value, scope) : null;
        const sentRaw = yield yielded;
        const sent = sentRaw === undefined ? null : sentRaw;
        for (const target of node.targets || []) {
          this.assignTarget(target, sent, scope);
        }
        return;
      }

      const value = this.evaluateExpression(node.value, scope);
      for (const target of node.targets || []) {
        this.assignTarget(target, value, scope);
      }
      return;
    }

    case ASTNodeType.AUG_ASSIGNMENT: {
      const current = this.evaluateExpression(node.target, scope);
      const right = this.evaluateExpression(node.value, scope);
      // Strip the '=' from the operator ('+=' -> '+')
      const result = this.applyInPlaceBinary(node.operator.slice(0, -1), current, right);
      this.assignTarget(node.target, result, scope);
      return;
    }

    case ASTNodeType.IF_STATEMENT: {
      const test = this.isTruthy(this.evaluateExpression(node.test, scope), scope);
      if (test) {
        yield* this.executeBlockGenerator(node.body || [], scope);
      } else {
        yield* this.executeBlockGenerator(node.orelse || [], scope);
      }
      return;
    }

    case ASTNodeType.WHILE_STATEMENT: {
      let broke = false;
      while (this.isTruthy(this.evaluateExpression(node.test, scope), scope)) {
        try {
          yield* this.executeBlockGenerator(node.body || [], scope);
        } catch (err) {
          if (err instanceof ContinueSignal) continue;
          if (err instanceof BreakSignal) {
            broke = true;
            break;
          }
          throw err;
        }
      }
      if (!broke && node.orelse && node.orelse.length) {
        yield* this.executeBlockGenerator(node.orelse, scope);
      }
      return;
    }

    case ASTNodeType.FOR_STATEMENT: {
      const iterable = this.evaluateExpression(node.iter, scope);
      if (!iterable || typeof iterable[Symbol.iterator] !== 'function') {
        throw new PyException('TypeError', `'${typeof iterable}' object is not iterable`);
      }
      const it = iterable[Symbol.iterator]();
      let broke = false;
      while (true) {
        const next = it.next();
        if (next.done) break;
        this.assignTarget(node.target, next.value, scope);
        try {
          yield* this.executeBlockGenerator(node.body || [], scope);
        } catch (err) {
          if (err instanceof ContinueSignal) continue;
          if (err instanceof BreakSignal) {
            broke = true;
            break;
          }
          throw err;
        }
      }
      if (!broke && node.orelse && node.orelse.length) {
        yield* this.executeBlockGenerator(node.orelse, scope);
      }
      return;
    }

    case ASTNodeType.BREAK_STATEMENT:
      throw new BreakSignal();

    case ASTNodeType.CONTINUE_STATEMENT:
      throw new ContinueSignal();

    case ASTNodeType.RETURN_STATEMENT: {
      throw new ReturnSignal(node.value ? this.evaluateExpression(node.value, scope) : null);
    }

    case ASTNodeType.TRY_STATEMENT: {
      let raised = false;
      try {
        yield* this.executeBlockGenerator(node.body || [], scope);
      } catch (err) {
        raised = true;
        let handled = false;
        const normalized = normalizeThrown(err);
        for (const handler of node.handlers || []) {
          if (!handler.exceptionType) {
            handled = true;
          } else {
            const expected = this.evaluateExpression(handler.exceptionType, scope);
            handled = matches(expected, normalized);
          }
          if (handled) {
            if (handler.name) {
              scope.set(handler.name, normalized);
            }
            yield* this.executeBlockGenerator(handler.body || [], scope);
            break;
          }
        }
        if (!handled) throw err;
      } finally {
        if (node.finalbody && node.finalbody.length) {
          yield* this.executeBlockGenerator(node.finalbody, scope);
        }
      }
      if (!raised && node.orelse && node.orelse.length) {
        yield* this.executeBlockGenerator(node.orelse, scope);
      }
      return;
    }

    default: {
      // Fallback to the non-generator statement executor for anything else.
      this.executeStatement(node, scope);
      return;
    }
  }
}

export function executeBlock(this: VirtualMachine, _body: any[], _scope: Scope): any {
  let last: any = null;
  for (const stmt of _body) {
    last = this.executeStatement(stmt, _scope);
  }
  return last;
}
