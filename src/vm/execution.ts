import type { VirtualMachine } from './vm';
import { ByteCode, ASTNodeType } from '../types';
import { BreakSignal, ContinueSignal, ReturnSignal, Scope, PySet } from './runtime-types';
import { PyDict } from './runtime-types';

export function execute(this: VirtualMachine, bytecode: ByteCode): any {
  if (!bytecode.ast) {
    throw new Error('Bytecode missing AST');
  }

  const globalScope = new Scope();
  this.installBuiltins(globalScope);
  return this.executeBlock(bytecode.ast.body, globalScope);
}

export function executeBlock(this: VirtualMachine, body: any[], scope: Scope): any {
  let lastValue: any = null;
  for (const stmt of body) {
    lastValue = this.executeStatement(stmt, scope);
  }
  return lastValue;
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

export function matchPattern(this: VirtualMachine, node: any, value: any, scope: Scope): { matched: boolean; bindings: Map<string, any> } {
  switch (node.type) {
    case ASTNodeType.MATCH_PATTERN_VALUE:
      return { matched: matchValueEquals(value, this.evaluateExpression(node.value, scope)), bindings: new Map() };
    case ASTNodeType.MATCH_PATTERN_WILDCARD:
      return { matched: true, bindings: new Map() };
    case ASTNodeType.MATCH_PATTERN_CAPTURE:
      return { matched: true, bindings: new Map([[node.name, value]]) };
    case ASTNodeType.MATCH_PATTERN_OR: {
      for (const pattern of node.patterns || []) {
        const result = this.matchPattern(pattern, value, scope);
        if (result.matched) return result;
      }
      return { matched: false, bindings: new Map() };
    }
    case ASTNodeType.MATCH_PATTERN_SEQUENCE: {
      const elements = node.elements || node.patterns;
      if (!Array.isArray(value) || !elements || elements.length !== value.length) {
        return { matched: false, bindings: new Map() };
      }
      const bindings = new Map<string, any>();
      for (let i = 0; i < elements.length; i++) {
        const result = this.matchPattern(elements[i], value[i], scope);
        if (!result.matched) return { matched: false, bindings: new Map() };
        for (const [k, v] of result.bindings.entries()) bindings.set(k, v);
      }
      return { matched: true, bindings };
    }
    case 'MatchValue':
      return { matched: matchValueEquals(value, node.value), bindings: new Map() };
    case 'MatchSingleton':
      return { matched: value === node.value, bindings: new Map() };
    case 'MatchSequence': {
      if (!Array.isArray(value)) return { matched: false, bindings: new Map() };
      if (!node.patterns || node.patterns.length !== value.length) return { matched: false, bindings: new Map() };
      const bindings = new Map<string, any>();
      for (let i = 0; i < node.patterns.length; i++) {
        const result = this.matchPattern(node.patterns[i], value[i], scope);
        if (!result.matched) return { matched: false, bindings: new Map() };
        for (const [k, v] of result.bindings.entries()) bindings.set(k, v);
      }
      return { matched: true, bindings };
    }
    case 'MatchMapping': {
      if (!(value instanceof PyDict)) return { matched: false, bindings: new Map() };
      const bindings = new Map<string, any>();
      for (const { key, pattern } of node.keys) {
        if (!value.has(key)) return { matched: false, bindings: new Map() };
        const result = this.matchPattern(pattern, value.get(key), scope);
        if (!result.matched) return { matched: false, bindings: new Map() };
        for (const [k, v] of result.bindings.entries()) bindings.set(k, v);
      }
      return { matched: true, bindings };
    }
    case 'MatchAs':
      return {
        matched: true,
        bindings: node.name ? new Map([[node.name, value]]) : new Map(),
      };
    case 'MatchClass': {
      if (!value || !value.klass || value.klass.name !== node.className) return { matched: false, bindings: new Map() };
      const bindings = new Map<string, any>();
      for (let i = 0; i < node.patterns.length; i++) {
        const attrName = node.kwd_attrs[i] || node.patterns[i].name;
        const attrValue = value.attributes.get(attrName);
        const result = this.matchPattern(node.patterns[i], attrValue, scope);
        if (!result.matched) return { matched: false, bindings: new Map() };
        for (const [k, v] of result.bindings.entries()) bindings.set(k, v);
      }
      return { matched: true, bindings };
    }
    default:
      return { matched: false, bindings: new Map() };
  }
}

export function applyBindings(bindings: Map<string, any>, scope: Scope): void {
  for (const [name, value] of bindings.entries()) {
    scope.set(name, value);
  }
}

export function* executeBlockGenerator(this: VirtualMachine, body: any[], scope: Scope): Generator<any, any, any> {
  for (const stmt of body) {
    yield* this.executeStatementGenerator(stmt, scope);
  }
  return null;
}

export function* executeStatementGenerator(this: VirtualMachine, node: any, scope: Scope): Generator<any, any, any> {
  switch (node.type) {
    case ASTNodeType.EXPRESSION_STATEMENT: {
      if (this.expressionHasYield(node.expression)) {
        yield* this.evaluateExpressionGenerator(node.expression, scope);
        return null;
      }
      this.evaluateExpression(node.expression, scope);
      return null;
    }
    case ASTNodeType.ASSIGNMENT: {
      const value = this.expressionHasYield(node.value)
        ? yield* this.evaluateExpressionGenerator(node.value, scope)
        : this.evaluateExpression(node.value, scope);
      for (const target of node.targets) {
        this.assignTarget(target, value, scope);
      }
      return null;
    }
    case ASTNodeType.IF_STATEMENT: {
      const test = this.expressionHasYield(node.test)
        ? yield* this.evaluateExpressionGenerator(node.test, scope)
        : this.evaluateExpression(node.test, scope);
      if (this.isTruthy(test, scope)) {
        yield* this.executeBlockGenerator(node.body, scope);
        return null;
      }
      for (const branch of node.elifs) {
        const branchTest = this.expressionHasYield(branch.test)
          ? yield* this.evaluateExpressionGenerator(branch.test, scope)
          : this.evaluateExpression(branch.test, scope);
        if (this.isTruthy(branchTest, scope)) {
          yield* this.executeBlockGenerator(branch.body, scope);
          return null;
        }
      }
      if (node.orelse?.length) {
        yield* this.executeBlockGenerator(node.orelse, scope);
      }
      return null;
    }
    case ASTNodeType.WHILE_STATEMENT: {
      while (true) {
        const test = this.expressionHasYield(node.test)
          ? yield* this.evaluateExpressionGenerator(node.test, scope)
          : this.evaluateExpression(node.test, scope);
        if (!this.isTruthy(test, scope)) break;
        try {
          yield* this.executeBlockGenerator(node.body, scope);
        } catch (err) {
          if (err instanceof BreakSignal) break;
          if (err instanceof ContinueSignal) continue;
          throw err;
        }
      }
      return null;
    }
    case ASTNodeType.FOR_STATEMENT: {
      const iterable = this.expressionHasYield(node.iter)
        ? yield* this.evaluateExpressionGenerator(node.iter, scope)
        : this.evaluateExpression(node.iter, scope);
      const items = this.iterableToArray(iterable);
      for (const item of items) {
        this.assignTarget(node.target, item, scope);
        try {
          yield* this.executeBlockGenerator(node.body, scope);
        } catch (err) {
          if (err instanceof BreakSignal) break;
          if (err instanceof ContinueSignal) continue;
          throw err;
        }
      }
      return null;
    }
    case ASTNodeType.MATCH_STATEMENT: {
      const subject = this.expressionHasYield(node.subject)
        ? yield* this.evaluateExpressionGenerator(node.subject, scope)
        : this.evaluateExpression(node.subject, scope);
      for (const matchCase of node.cases) {
        const result = this.matchPattern(matchCase.pattern, subject, scope);
        if (!result.matched) continue;
        if (matchCase.guard) {
          const guardScope = new Scope(scope);
          this.applyBindings(result.bindings, guardScope);
          const guardValue = this.expressionHasYield(matchCase.guard)
            ? yield* this.evaluateExpressionGenerator(matchCase.guard, guardScope)
            : this.evaluateExpression(matchCase.guard, guardScope);
          if (!this.isTruthy(guardValue, scope)) continue;
        }
        this.applyBindings(result.bindings, scope);
        yield* this.executeBlockGenerator(matchCase.body, scope);
        return null;
      }
      return null;
    }
    case ASTNodeType.RETURN_STATEMENT: {
      const value = node.value
        ? (this.expressionHasYield(node.value)
            ? yield* this.evaluateExpressionGenerator(node.value, scope)
            : this.evaluateExpression(node.value, scope))
        : null;
      throw new ReturnSignal(value);
    }
    case ASTNodeType.TRY_STATEMENT: {
      let raised = false;
      try {
        yield* this.executeBlockGenerator(node.body, scope);
      } catch (err) {
        raised = true;
        let handled = false;
        for (const handler of node.handlers) {
          if (!handler.exceptionType) {
            handled = true;
          } else if (err instanceof PyException) {
            const expected = this.expressionHasYield(handler.exceptionType)
              ? yield* this.evaluateExpressionGenerator(handler.exceptionType, scope)
              : this.evaluateExpression(handler.exceptionType, scope);
            if (expected instanceof PyClass && expected.isException && err.pyType === expected.name) {
              handled = true;
            } else if (expected instanceof PyInstance && expected.klass.isException && err.pyType === expected.klass.name) {
              handled = true;
            }
          }
          if (handled) {
            if (handler.name) {
              scope.set(handler.name, err instanceof PyException ? err : new PyException('Exception', String(err)));
            }
            yield* this.executeBlockGenerator(handler.body, scope);
            break;
          }
        }
        if (!handled) throw err;
      } finally {
        if (node.finalbody?.length) {
          yield* this.executeBlockGenerator(node.finalbody, scope);
        }
      }
      if (!raised && node.orelse?.length) {
        yield* this.executeBlockGenerator(node.orelse, scope);
      }
      return null;
    }
    case ASTNodeType.WITH_STATEMENT: {
      for (const item of node.items) {
        const ctx = this.expressionHasYield(item.context)
          ? yield* this.evaluateExpressionGenerator(item.context, scope)
          : this.evaluateExpression(item.context, scope);
        const enter = this.getAttribute(ctx, '__enter__', scope);
        const exit = this.getAttribute(ctx, '__exit__', scope);
        const value = this.callFunction(enter, [], scope);
        if (item.target) {
          this.assignTarget(item.target, value, scope);
        }
        try {
          yield* this.executeBlockGenerator(node.body, scope);
        } catch (err) {
          this.callFunction(exit, [err], scope);
          throw err;
        }
        this.callFunction(exit, [null, null, null], scope);
      }
      return null;
    }
    case ASTNodeType.BREAK_STATEMENT:
      throw new BreakSignal();
    case ASTNodeType.CONTINUE_STATEMENT:
      throw new ContinueSignal();
    case ASTNodeType.PASS_STATEMENT:
      return null;
    default:
      return this.executeStatement(node, scope);
  }
}
