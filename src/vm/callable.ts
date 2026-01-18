import type { VirtualMachine } from './vm';
import { ASTNodeType } from '../types';
import { PyValue, PyClass, PyDict, PyException, PyFunction, PyGenerator, PyInstance, ReturnSignal, Scope, Frame } from './runtime-types';

export function callFunction(
  this: VirtualMachine,
  func: PyValue,
  args: PyValue[],
  scope: Scope,
  kwargs?: Record<string, PyValue>
): PyValue {
  // Fast path for native JS functions (most common for builtins)
  if (typeof func === 'function') {
    if (kwargs && Object.keys(kwargs).length > 0) {
      return func(...args, { __kwargs__: kwargs });
    }
    return func(...args);
  }
  
  if (func instanceof PyFunction) {
    // Fast path for simple bytecode functions (no kwargs, no varargs, no generators)
    const bc = func.bytecode;
    const params = func.params;
    const paramLen = params.length;
    const hasKwargs = kwargs && Object.keys(kwargs).length > 0;
    
    // Check if we can use the fast path
    const canUseFastPath = bc && bc.instructions && !func.isGenerator && !hasKwargs &&
      args.length === paramLen && paramLen > 0 && 
      params.every((p: PyValue) => p.type === 'Param');
    
    if (canUseFastPath) {
      // Fast path: create scope and frame with minimal allocations
      const callScope = new Scope(func.closure);
      const scopeValues = callScope.values;
      
      // Directly set locals - avoid Set creation for locals when not needed
      if (func.localNames.size > 0) {
        callScope.locals = func.localNames;
      }
      
      // Directly copy globals/nonlocals from bytecode (use Sets directly)
      if (bc.globals) {
        const globals = callScope.globals;
        for (let i = 0; i < bc.globals.length; i++) {
          globals.add(bc.globals[i]);
        }
      }
      if (bc.nonlocals) {
        const nonlocals = callScope.nonlocals;
        for (let i = 0; i < bc.nonlocals.length; i++) {
          nonlocals.add(bc.nonlocals[i]);
        }
      }
      
      // Set parameters directly in scope
      for (let i = 0; i < paramLen; i++) {
        scopeValues.set(params[i].name, args[i]);
      }
      
      // Create frame and populate locals array
      const frame = new Frame(bc, callScope);
      const frameLocals = frame.locals;
      const argcount = bc.argcount || 0;
      const varnames = bc.varnames;
      for (let i = 0; i < argcount; i++) {
        frameLocals[i] = scopeValues.get(varnames[i]);
      }
      
      return this.executeFrame(frame);
    }
    
    // Slow path for complex cases
    const callScope = new Scope(func.closure);
    if (func.localNames.size > 0) {
      callScope.locals = new Set(func.localNames);
    }
    if (bc) {
      if (bc.globals) {
        const globals = callScope.globals;
        for (let i = 0; i < bc.globals.length; i++) {
          globals.add(bc.globals[i]);
        }
      }
      if (bc.nonlocals) {
        const nonlocals = callScope.nonlocals;
        for (let i = 0; i < bc.nonlocals.length; i++) {
          nonlocals.add(bc.nonlocals[i]);
        }
      }
    }
    
    let argIndex = 0;
    for (let i = 0; i < paramLen; i++) {
      const param = params[i];
      if (param.type === 'Param') {
        let argValue: PyValue;
        if (argIndex < args.length) {
          argValue = args[argIndex++];
        } else if (kwargs && param.name in kwargs) {
          argValue = kwargs[param.name];
          delete kwargs[param.name];
        } else if (param.defaultEvaluated !== undefined) {
          argValue = param.defaultEvaluated;
        } else if (param.defaultValue) {
          argValue = this.evaluateExpression(param.defaultValue, scope);
        } else {
          argValue = null;
        }
        callScope.values.set(param.name, argValue);
      } else if (param.type === 'VarArg') {
        const varArgs = args.slice(argIndex);
        (varArgs as PyValue).__tuple__ = true;
        callScope.values.set(param.name, varArgs);
        argIndex = args.length;
      } else if (param.type === 'KwArg') {
        const kwDict = new PyDict();
        if (kwargs) {
          for (const key in kwargs) {
            if (Object.prototype.hasOwnProperty.call(kwargs, key)) {
              kwDict.set(key, kwargs[key]);
            }
          }
        }
        callScope.values.set(param.name, kwDict);
      }
    }
    
    try {
      if (func.isGenerator) {
        const iterator = this.executeBlockGenerator(func.body, callScope);
        return new PyGenerator(iterator);
      }
      if (bc && bc.instructions) {
        const frame = new Frame(bc, callScope);
        const argcount = bc.argcount || 0;
        const varnames = bc.varnames;
        const frameLocals = frame.locals;
        const scopeValues = callScope.values;
        for (let i = 0; i < argcount; i++) {
          frameLocals[i] = scopeValues.get(varnames[i]);
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
