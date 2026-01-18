import type { VirtualMachine } from './vm';
import { ASTNodeType } from '../types';
import { FastCallInfo, PyValue, PyClass, PyDict, PyException, PyFunction, PyGenerator, PyInstance, ReturnSignal, Scope, Frame } from './runtime-types';

const buildFastCallInfo = (func: PyFunction): FastCallInfo | null => {
  if (!func.bytecode || !func.bytecode.instructions || func.isGenerator) return null;
  const paramNames: string[] = [];
  for (const param of func.params) {
    if (param.type !== 'Param' || param.defaultValue || param.defaultEvaluated !== undefined) return null;
    paramNames.push(param.name);
  }
  const locals = new Set(func.localNames);
  if (func.bytecode.varnames) {
    for (const name of func.bytecode.varnames) {
      if (name !== undefined) locals.add(name);
    }
  }
  const globals = func.bytecode.globals && func.bytecode.globals.length > 0 ? new Set(func.bytecode.globals) : null;
  const nonlocals = func.bytecode.nonlocals && func.bytecode.nonlocals.length > 0 ? new Set(func.bytecode.nonlocals) : null;
  const useDirectSet = (!globals || globals.size === 0) && (!nonlocals || nonlocals.size === 0);
  return {
    paramNames,
    locals,
    globals,
    nonlocals,
    useDirectSet,
    argcount: func.bytecode.argcount,
  };
};

export function callFunction(
  this: VirtualMachine,
  func: PyValue,
  args: PyValue[],
  scope: Scope,
  kwargs: Record<string, PyValue> = {}
): PyValue {
  // console.log('Calling', func, 'with', args);
  const hasKwargs = kwargs ? Object.keys(kwargs).length > 0 : false;
  if (func instanceof PyFunction) {
    if (func.fastCall === undefined) {
      func.fastCall = buildFastCallInfo(func);
    }
    const fastCall = func.fastCall;
    if (fastCall && !hasKwargs && args.length === fastCall.paramNames.length) {
      const callScope = new Scope(func.closure);
      callScope.parent = func.closure;
      callScope.isClassScope = false;
      callScope.locals = fastCall.locals;
      if (fastCall.globals) {
        callScope.globals = fastCall.globals;
      }
      if (fastCall.nonlocals) {
        callScope.nonlocals = fastCall.nonlocals;
      }
      const setLocal = fastCall.useDirectSet
        ? (name: string, value: PyValue) => {
          callScope.values.set(name, value);
        }
        : (name: string, value: PyValue) => {
          callScope.set(name, value);
        };
      for (let i = 0; i < fastCall.paramNames.length; i++) {
        setLocal(fastCall.paramNames[i], args[i]);
      }
      const frame = new Frame(func.bytecode!, callScope);
      const argcount = Math.min(fastCall.argcount, args.length);
      for (let i = 0; i < argcount; i++) {
        frame.locals[i] = args[i];
      }
      return this.executeFrame(frame);
    }
    if (!kwargs) {
      kwargs = {};
    }
    const callScope = new Scope(func.closure);
    callScope.locals = new Set(func.localNames);
    if (func.bytecode?.varnames) {
      for (const name of func.bytecode.varnames) {
        if (name !== undefined) {
          callScope.locals.add(name);
        }
      }
    }
    if (func.bytecode) {
      if (func.bytecode.globals) {
        func.bytecode.globals.forEach((g: string) => callScope.globals.add(g));
      }
      if (func.bytecode.nonlocals) {
        func.bytecode.nonlocals.forEach((n: string) => callScope.nonlocals.add(n));
      }
    }
    const useDirectSet = callScope.globals.size === 0 && callScope.nonlocals.size === 0;
    const setLocal = useDirectSet
      ? (name: string, value: PyValue) => {
        callScope.values.set(name, value);
      }
      : (name: string, value: PyValue) => {
        callScope.set(name, value);
      };
    let argIndex = 0;
    const argsLength = args.length;
    for (const param of func.params) {
      if (param.type === 'Param') {
        let argValue: PyValue;
        if (argIndex < argsLength) {
          argValue = args[argIndex];
          argIndex += 1;
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
        setLocal(param.name, argValue);
      } else if (param.type === 'VarArg') {
        const varArgs = args.slice(argIndex);
        (varArgs as PyValue).__tuple__ = true;
        setLocal(param.name, varArgs);
        argIndex = argsLength;
      } else if (param.type === 'KwArg') {
        const kwDict = new PyDict();
        for (const [key, value] of Object.entries(kwargs)) {
          kwDict.set(key, value);
        }
        setLocal(param.name, kwDict);
        kwargs = {};
      }
    }
    try {
      if (func.isGenerator) {
        const iterator = this.executeBlockGenerator(func.body, callScope);
        return new PyGenerator(iterator);
      }
      if (func.bytecode && func.bytecode.instructions) {
        const frame = new Frame(func.bytecode, callScope);
        for (let i = 0; i < (func.bytecode.argcount || 0); i++) {
          const varname = func.bytecode.varnames[i];
          frame.locals[i] = callScope.values.get(varname);
        }
        return this.executeFrame(frame);
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

export function containsYield(this: VirtualMachine, body: PyValue[]): boolean {
  for (const stmt of body) {
    if (stmt.type === ASTNodeType.YIELD) return true;
    if (stmt.expression && this.expressionHasYield(stmt.expression)) return true;
    if (stmt.value && this.expressionHasYield(stmt.value)) return true;
    if (stmt.body && Array.isArray(stmt.body) && this.containsYield(stmt.body)) return true;
  }
  return false;
}

export function evaluateComprehension(this: VirtualMachine, node: PyValue, scope: Scope, emit: () => void, outerScope?: Scope) {
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
      const passes = clause.ifs.every((cond: PyValue) => this.isTruthy(this.evaluateExpression(cond, scope), scope));
      if (passes) {
        walk(index + 1);
      }
    }
  };
  walk(0);
}

export function* generateComprehension(
  this: VirtualMachine,
  node: PyValue,
  scope: Scope,
  valueFactory: () => PyValue,
  outerScope?: Scope
): Generator<PyValue, PyValue> {
  const clauses = node.clauses || [];
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const vm = this;
  const walk = (index: number): Generator<PyValue, PyValue> => {
    return (function* (): Generator<PyValue, PyValue> {
      if (index >= clauses.length) {
        yield valueFactory();
        return;
      }
      const clause = clauses[index];
      const iterScope = (index === 0 && outerScope) ? outerScope : scope;
      const iterable = vm.evaluateExpression(clause.iter, iterScope);
      const items = Array.isArray(iterable) ? iterable : Array.from(iterable);
      for (const item of items) {
        vm.assignTarget(clause.target, item, scope);
        const passes = clause.ifs.every((cond: PyValue) => vm.isTruthy(vm.evaluateExpression(cond, scope), scope));
        if (passes) {
          yield* walk(index + 1);
        }
      }
    })();
  };
  yield* walk(0);
  return null;
}

export function expressionHasYield(this: VirtualMachine, node: PyValue): boolean {
  if (!node) return false;
  if (node.type === ASTNodeType.YIELD) return true;
  for (const key of Object.keys(node)) {
    const value = (node as PyValue)[key];
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
