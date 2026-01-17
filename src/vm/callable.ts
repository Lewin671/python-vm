import type { VirtualMachine } from './vm';
import { ASTNodeType } from '../types';
import { PyClass, PyDict, PyException, PyFunction, PyGenerator, PyInstance, ReturnSignal, Scope } from './runtime-types';

export function callFunction(
  this: VirtualMachine,
  func: any,
  args: any[],
  scope: Scope,
  kwargs: Record<string, any> = {}
): any {
  if (!kwargs) {
    kwargs = {};
  }
  if (func instanceof PyFunction) {
    const callScope = new Scope(func.closure);
    callScope.locals = new Set(func.localNames);
    for (const param of func.params) {
      if (param.type === 'Param') {
        let argValue: any;
        if (args.length > 0) {
          argValue = args.shift();
        } else if (param.name in kwargs) {
          argValue = kwargs[param.name];
          delete kwargs[param.name];
        } else if (param.defaultEvaluated !== undefined) {
          argValue = param.defaultEvaluated;
        } else if (param.defaultValue) {
          argValue = this.evaluateExpression(param.defaultValue, scope);
        } else {
          argValue = null;
        }
        callScope.set(param.name, argValue);
      } else if (param.type === 'VarArg') {
        const varArgs = [...args];
        (varArgs as any).__tuple__ = true;
        callScope.set(param.name, varArgs);
        args = [];
      } else if (param.type === 'KwArg') {
        const kwDict = new PyDict();
        for (const [key, value] of Object.entries(kwargs)) {
          kwDict.set(key, value);
        }
        callScope.set(param.name, kwDict);
        kwargs = {};
      }
    }
    try {
      if (func.isGenerator) {
        const iterator = this.executeBlockGenerator(func.body, callScope);
        return new PyGenerator(iterator);
      }
      const result = this.executeBlock(func.body, callScope);
      return result;
    } catch (err) {
      if (err instanceof ReturnSignal) return err.value;
      throw err;
    }
  }
  if (func instanceof PyClass) {
    const instance = new PyInstance(func);
    if (func.isException && args.length > 0) {
      instance.attributes.set('message', args[0]);
    }
    const init = this.findClassAttribute(func, '__init__');
    if (init instanceof PyFunction) {
      this.callFunction(init, [instance, ...args], scope, kwargs);
    }
    return instance;
  }
  if (typeof func === 'function') {
    if (Object.keys(kwargs).length > 0) {
      return func(...args, { __kwargs__: kwargs });
    }
    return func(...args);
  }
  throw new PyException('TypeError', 'object is not callable');
}

export function containsYield(this: VirtualMachine, body: any[]): boolean {
  for (const stmt of body) {
    if (stmt.type === ASTNodeType.YIELD) return true;
    if (stmt.expression && this.expressionHasYield(stmt.expression)) return true;
    if (stmt.value && this.expressionHasYield(stmt.value)) return true;
    if (stmt.body && Array.isArray(stmt.body) && this.containsYield(stmt.body)) return true;
  }
  return false;
}

export function evaluateComprehension(this: VirtualMachine, node: any, scope: Scope, emit: () => void, outerScope?: Scope) {
  const clauses = node.clauses || [];
  const walk = (index: number) => {
    if (index >= clauses.length) {
      emit();
      return;
    }
    const clause = clauses[index];
    const iterScope = (index === 0 && outerScope) ? outerScope : scope;
    const iterable = this.evaluateExpression(clause.iter, iterScope);
    const items = Array.isArray(iterable) ? iterable : Array.from(iterable);
    for (const item of items) {
      this.assignTarget(clause.target, item, scope);
      const passes = clause.ifs.every((cond: any) => this.isTruthy(this.evaluateExpression(cond, scope), scope));
      if (passes) {
        walk(index + 1);
      }
    }
  };
  walk(0);
}

export function* generateComprehension(
  this: VirtualMachine,
  node: any,
  scope: Scope,
  valueFactory: () => any,
  outerScope?: Scope
): Generator<any, any, any> {
  const clauses = node.clauses || [];
  const walk = (index: number): Generator<any, any, any> => {
    const self = this;
    return (function* (): Generator<any, any, any> {
      if (index >= clauses.length) {
        yield valueFactory();
        return;
      }
      const clause = clauses[index];
      const iterScope = (index === 0 && outerScope) ? outerScope : scope;
      const iterable = self.evaluateExpression(clause.iter, iterScope);
      const items = Array.isArray(iterable) ? iterable : Array.from(iterable);
      for (const item of items) {
        self.assignTarget(clause.target, item, scope);
        const passes = clause.ifs.every((cond: any) => self.isTruthy(self.evaluateExpression(cond, scope), scope));
        if (passes) {
          yield* walk(index + 1);
        }
      }
    })();
  };
  yield* walk(0);
  return null;
}

export function expressionHasYield(this: VirtualMachine, node: any): boolean {
  if (!node) return false;
  if (node.type === ASTNodeType.YIELD) return true;
  for (const key of Object.keys(node)) {
    const value = (node as any)[key];
    if (Array.isArray(value)) {
      if (value.some((item) => item && typeof item === 'object' && this.expressionHasYield(item))) {
        return true;
      }
    } else if (value && typeof value === 'object') {
      if (this.expressionHasYield(value)) return true;
    }
  }
  return false;
}
