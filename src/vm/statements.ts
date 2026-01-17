import type { VirtualMachine } from './vm';
import { ASTNodeType } from '../types';
import { PyValue, BreakSignal, ContinueSignal, PyClass, PyException, PyFunction, PyInstance, ReturnSignal, Scope, PyDict } from './runtime-types';
import { findLocalVariables } from './value-utils';

export function executeStatement(this: VirtualMachine, node: PyValue, scope: Scope): PyValue {
  switch (node.type) {
    case ASTNodeType.EXPRESSION_STATEMENT:
      return this.evaluateExpression(node.expression, scope);
    case ASTNodeType.IMPORT_STATEMENT: {
      for (const entry of node.names) {
        const module = this.importModule(entry.name, scope);
        const bindingName = entry.alias || entry.name.split('.')[0];
        scope.set(bindingName, module);
      }
      return null;
    }
    case ASTNodeType.ASSIGNMENT: {
      const value = this.evaluateExpression(node.value, scope);
      for (const target of node.targets) {
        this.assignTarget(target, value, scope);
      }
      return null;
    }
    case ASTNodeType.AUG_ASSIGNMENT: {
      const target = node.target;
      let current: PyValue;
      let obj: PyValue;
      let index: PyValue;

      if (target.type === ASTNodeType.IDENTIFIER) {
        current = scope.get(target.name);
        const value = this.evaluateExpression(node.value, scope);
        const result = this.applyInPlaceBinary(node.operator, current, value);
        scope.set(target.name, result);
      } else if (target.type === ASTNodeType.ATTRIBUTE) {
        obj = this.evaluateExpression(target.object, scope);
        current = this.getAttribute(obj, target.name, scope);
        const value = this.evaluateExpression(node.value, scope);
        const result = this.applyInPlaceBinary(node.operator, current, value);
        this.setAttribute(obj, target.name, result);
      } else if (target.type === ASTNodeType.SUBSCRIPT) {
        obj = this.evaluateExpression(target.object, scope);
        if (target.index && target.index.type === ASTNodeType.SLICE) {
          index = {
            type: ASTNodeType.SLICE,
            start: target.index.start ? this.evaluateExpression(target.index.start, scope) : null,
            end: target.index.end ? this.evaluateExpression(target.index.end, scope) : null,
            step: target.index.step ? this.evaluateExpression(target.index.step, scope) : null,
          };
          current = this.getSubscript(obj, index);
        } else {
          index = this.evaluateExpression(target.index, scope);
          current = this.getSubscript(obj, index);
        }
        const value = this.evaluateExpression(node.value, scope);
        const result = this.applyInPlaceBinary(node.operator, current, value);

        if (Array.isArray(obj)) {
          if ((obj as PyValue).__tuple__) {
            throw new PyException('TypeError', "'tuple' object does not support item assignment");
          }
          if (index && index.type === ASTNodeType.SLICE) {
            const start = index.start !== null ? index.start : null;
            const end = index.end !== null ? index.end : null;
            const step = index.step !== null ? index.step : null;
            const stepValue = step !== null && step !== undefined ? step : 1;
            const values = this.toIterableArray(result);
            if (stepValue === 1) {
              const bounds = this.computeSliceBounds(obj.length, start, end, stepValue);
              obj.splice(bounds.start, bounds.end - bounds.start, ...values);
            } else {
              const indices = this.computeSliceIndices(obj.length, start, end, stepValue);
              if (values.length !== indices.length) {
                throw new PyException(
                  'ValueError',
                  `attempt to assign sequence of size ${values.length} to extended slice of size ${indices.length}`
                );
              }
              for (let i = 0; i < indices.length; i++) {
                obj[indices[i]] = values[i];
              }
            }
          } else {
            obj[index] = result;
          }
        } else if (obj instanceof PyDict) {
          obj.set(index, result);
        } else {
          // For other types, we might need a general setItem
          // But based on assignTarget, it only supports Array and PyDict
          throw new PyException('TypeError', 'unsupported subscript assignment');
        }
      } else {
        throw new PyException('TypeError', 'illegal expression for augmented assignment');
      }
      return null;
    }
    case ASTNodeType.IF_STATEMENT: {
      if (this.isTruthy(this.evaluateExpression(node.test, scope), scope)) {
        return this.executeBlock(node.body, scope);
      }
      for (const branch of node.elifs) {
        if (this.isTruthy(this.evaluateExpression(branch.test, scope), scope)) {
          return this.executeBlock(branch.body, scope);
        }
      }
      if (node.orelse?.length) {
        return this.executeBlock(node.orelse, scope);
      }
      return null;
    }
    case ASTNodeType.WHILE_STATEMENT: {
      while (this.isTruthy(this.evaluateExpression(node.test, scope), scope)) {
        try {
          this.executeBlock(node.body, scope);
        } catch (err) {
          if (err instanceof BreakSignal) break;
          if (err instanceof ContinueSignal) continue;
          throw err;
        }
      }
      return null;
    }
    case ASTNodeType.FOR_STATEMENT: {
      const iterable = this.evaluateExpression(node.iter, scope);
      const items = this.iterableToArray(iterable);
      for (const item of items) {
        this.assignTarget(node.target, item, scope);
        try {
          this.executeBlock(node.body, scope);
        } catch (err) {
          if (err instanceof BreakSignal) break;
          if (err instanceof ContinueSignal) continue;
          throw err;
        }
      }
      return null;
    }
    case ASTNodeType.MATCH_STATEMENT: {
      const subject = this.evaluateExpression(node.subject, scope);
      for (const matchCase of node.cases) {
        const result = this.matchPattern(matchCase.pattern, subject, scope);
        if (!result.matched) continue;
        if (matchCase.guard) {
          const guardScope = new Scope(scope);
          this.applyBindings(result.bindings, guardScope);
          if (!this.isTruthy(this.evaluateExpression(matchCase.guard, guardScope), guardScope)) continue;
        }
        this.applyBindings(result.bindings, scope);
        return this.executeBlock(matchCase.body, scope);
      }
      return null;
    }
    case ASTNodeType.FUNCTION_DEF: {
      const params = (node.params || []).map((param: PyValue) => {
        if (param.type === 'Param' && param.defaultValue) {
          return { ...param, defaultEvaluated: this.evaluateExpression(param.defaultValue, scope) };
        }
        return param;
      });
      const closure = scope.isClassScope ? (scope.parent as Scope) : scope;
      const localNames = findLocalVariables(node.body);
      // Parameters are also local
      for (const p of node.params || []) {
        if (p.name) localNames.add(p.name);
      }
      const fn = new PyFunction(node.name, params, node.body, closure, this.containsYield(node.body), localNames);
      scope.set(node.name, fn);
      if (node.decorators && node.decorators.length > 0) {
        let decorated: PyValue = fn;
        for (const decorator of node.decorators.reverse()) {
          const decFn = this.evaluateExpression(decorator, scope);
          decorated = this.callFunction(decFn, [decorated], scope);
        }
        scope.set(node.name, decorated);
      }
      return null;
    }
    case ASTNodeType.CLASS_DEF: {
      const bases = node.bases?.map((b: PyValue) => this.evaluateExpression(b, scope)) || [];
      const classScope = new Scope(scope, true);
      this.executeBlock(node.body, classScope);
      const attributes = new Map(classScope.values.entries());
      const isException = bases.some((b: PyValue) => b instanceof PyClass && b.isException);
      const klass = new PyClass(node.name, bases, attributes, isException);
      scope.set(node.name, klass);
      if (node.decorators && node.decorators.length > 0) {
        let decorated: PyValue = klass;
        for (const decorator of node.decorators.reverse()) {
          const decFn = this.evaluateExpression(decorator, scope);
          decorated = this.callFunction(decFn, [decorated], scope);
        }
        scope.set(node.name, decorated);
      }
      return null;
    }
    case ASTNodeType.RETURN_STATEMENT:
      throw new ReturnSignal(node.value ? this.evaluateExpression(node.value, scope) : null);
    case ASTNodeType.BREAK_STATEMENT:
      throw new BreakSignal();
    case ASTNodeType.CONTINUE_STATEMENT:
      throw new ContinueSignal();
    case ASTNodeType.PASS_STATEMENT:
      return null;
    case ASTNodeType.ASSERT_STATEMENT: {
      const test = this.evaluateExpression(node.test, scope);
      if (!this.isTruthy(test, scope)) {
        const message = node.message ? this.evaluateExpression(node.message, scope) : 'Assertion failed';
        throw new PyException('AssertionError', String(message));
      }
      return null;
    }
    case ASTNodeType.RAISE_STATEMENT: {
      const exc = node.exception ? this.evaluateExpression(node.exception, scope) : null;
      if (exc instanceof PyException) throw exc;
      if (exc instanceof PyInstance && exc.klass.isException) {
        const message = exc.attributes.get('message');
        throw new PyException(exc.klass.name, message ? String(message) : exc.klass.name, exc);
      }
      if (exc instanceof PyClass && exc.isException) {
        throw new PyException(exc.name, exc.name);
      }
      throw new PyException('Exception', exc ? String(exc) : 'Exception');
    }
    case ASTNodeType.TRY_STATEMENT: {
      let raised = false;
      try {
        this.executeBlock(node.body, scope);
      } catch (err) {
        raised = true;
        let handled = false;
        for (const handler of node.handlers) {
          if (!handler.exceptionType) {
            handled = true;
          } else if (err instanceof PyException) {
            const expected = this.evaluateExpression(handler.exceptionType, scope);
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
            this.executeBlock(handler.body, scope);
            break;
          }
        }
        if (!handled) throw err;
      } finally {
        if (node.finalbody?.length) {
          this.executeBlock(node.finalbody, scope);
        }
      }
      if (!raised && node.orelse?.length) {
        this.executeBlock(node.orelse, scope);
      }
      return null;
    }
    case ASTNodeType.WITH_STATEMENT: {
      for (const item of node.items) {
        const ctx = this.evaluateExpression(item.context, scope);
        const enter = this.getAttribute(ctx, '__enter__', scope);
        const exit = this.getAttribute(ctx, '__exit__', scope);
        const value = this.callFunction(enter, [], scope);
        if (item.target) {
          this.assignTarget(item.target, value, scope);
        }
        try {
          this.executeBlock(node.body, scope);
        } catch (err) {
          this.callFunction(exit, [err], scope);
          throw err;
        }
        this.callFunction(exit, [null, null, null], scope);
      }
      return null;
    }
    case ASTNodeType.GLOBAL_STATEMENT:
      for (const name of node.names) scope.globals.add(name);
      return null;
    case ASTNodeType.NONLOCAL_STATEMENT:
      for (const name of node.names) scope.nonlocals.add(name);
      return null;
    case ASTNodeType.DELETE_STATEMENT:
      this.deleteTarget(node.target, scope);
      return null;
    default:
      throw new Error(`Unsupported statement type: ${node.type}`);
  }
}

export function assignTarget(this: VirtualMachine, target: PyValue, value: PyValue, scope: Scope) {
  if (target.type === ASTNodeType.IDENTIFIER) {
    scope.set(target.name, value);
    return;
  }
  if (target.type === ASTNodeType.ATTRIBUTE) {
    const obj = this.evaluateExpression(target.object, scope);
    this.setAttribute(obj, target.name, value);
    return;
  }
  if (target.type === ASTNodeType.SUBSCRIPT) {
    const obj = this.evaluateExpression(target.object, scope);
    let index: PyValue;
    if (target.index && target.index.type === ASTNodeType.SLICE) {
      index = {
        type: ASTNodeType.SLICE,
        start: target.index.start ? this.evaluateExpression(target.index.start, scope) : null,
        end: target.index.end ? this.evaluateExpression(target.index.end, scope) : null,
        step: target.index.step ? this.evaluateExpression(target.index.step, scope) : null
      };
    } else {
      index = this.evaluateExpression(target.index, scope);
    }
    if (Array.isArray(obj)) {
      if ((obj as PyValue).__tuple__) {
        throw new PyException('TypeError', "'tuple' object does not support item assignment");
      }
      if (index && index.type === ASTNodeType.SLICE) {
        const start = index.start !== null ? index.start : null;
        const end = index.end !== null ? index.end : null;
        const step = index.step !== null ? index.step : null;
        const stepValue = step !== null && step !== undefined ? step : 1;
        const values = this.toIterableArray(value);
        if (stepValue === 1) {
          const bounds = this.computeSliceBounds(obj.length, start, end, stepValue);
          obj.splice(bounds.start, bounds.end - bounds.start, ...values);
        } else {
          const indices = this.computeSliceIndices(obj.length, start, end, stepValue);
          if (values.length !== indices.length) {
            throw new PyException(
              'ValueError',
              `attempt to assign sequence of size ${values.length} to extended slice of size ${indices.length}`
            );
          }
          for (let i = 0; i < indices.length; i++) {
            obj[indices[i]] = values[i];
          }
        }
      } else {
        obj[index] = value;
      }
      return;
    }
    if (obj instanceof PyDict) {
      obj.set(index, value);
      return;
    }
    throw new PyException('TypeError', 'unsupported subscript assignment');
  }
  if (target.type === ASTNodeType.TUPLE_LITERAL || target.type === ASTNodeType.LIST_LITERAL) {
    const elements = target.elements;
    const unpackValue = this.toIterableArray(value);
    const starIndex = elements.findIndex((el: PyValue) => el.type === ASTNodeType.STARRED);
    if (starIndex === -1) {
      for (let i = 0; i < elements.length; i++) {
        this.assignTarget(elements[i], unpackValue[i], scope);
      }
      return;
    }
    const prefixCount = starIndex;
    const suffixCount = elements.length - starIndex - 1;
    if (unpackValue.length < prefixCount + suffixCount) {
      throw new PyException('ValueError', 'not enough values to unpack');
    }
    for (let i = 0; i < prefixCount; i++) {
      this.assignTarget(elements[i], unpackValue[i], scope);
    }
    const starTarget = elements[starIndex];
    const middle = unpackValue.slice(prefixCount, unpackValue.length - suffixCount);
    this.assignTarget(starTarget.target, middle, scope);
    for (let i = 0; i < suffixCount; i++) {
      const valueIndex = unpackValue.length - suffixCount + i;
      const elementIndex = starIndex + 1 + i;
      this.assignTarget(elements[elementIndex], unpackValue[valueIndex], scope);
    }
    return;
  }
  throw new PyException('TypeError', 'invalid assignment target');
}

export function toIterableArray(this: VirtualMachine, value: PyValue): PyValue[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value[Symbol.iterator] === 'function') {
    return Array.from(value);
  }
  throw new PyException('TypeError', 'cannot unpack non-iterable');
}

export function deleteTarget(this: VirtualMachine, target: PyValue, scope: Scope) {
  if (target.type === ASTNodeType.SUBSCRIPT) {
    const obj = this.evaluateExpression(target.object, scope);
    let index: PyValue;
    if (target.index && target.index.type === ASTNodeType.SLICE) {
      index = {
        type: ASTNodeType.SLICE,
        start: target.index.start ? this.evaluateExpression(target.index.start, scope) : null,
        end: target.index.end ? this.evaluateExpression(target.index.end, scope) : null,
        step: target.index.step ? this.evaluateExpression(target.index.step, scope) : null
      };
    } else {
      index = this.evaluateExpression(target.index, scope);
    }
    if (Array.isArray(obj)) {
      if ((obj as PyValue).__tuple__) {
        throw new PyException('TypeError', "'tuple' object does not support item assignment");
      }
      if (index && index.type === ASTNodeType.SLICE) {
        const start = index.start !== null ? index.start : null;
        const end = index.end !== null ? index.end : null;
        const step = index.step !== null ? index.step : null;
        const stepValue = step !== null && step !== undefined ? step : 1;
        if (stepValue === 1) {
          const bounds = this.computeSliceBounds(obj.length, start, end, stepValue);
          obj.splice(bounds.start, bounds.end - bounds.start);
        } else {
          const indices = this.computeSliceIndices(obj.length, start, end, stepValue);
          indices.sort((a, b) => b - a);
          for (const idx of indices) {
            obj.splice(idx, 1);
          }
        }
      } else {
        obj.splice(index, 1);
      }
      return;
    }
    if (obj instanceof PyDict) {
      obj.delete(index);
      return;
    }
    throw new PyException('TypeError', 'unsupported delete target');
  }
  throw new PyException('TypeError', 'unsupported delete target');
}
