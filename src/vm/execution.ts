import type { VirtualMachine } from './vm';
import { ByteCode, OpCode, ASTNodeType, CompareOp } from '../types';
import { PyValue, PyClass, PyDict, PyException, PyFunction, PyInstance, PySet, Scope, Frame } from './runtime-types';

export function execute(this: VirtualMachine, bytecode: ByteCode): PyValue {
  const globalScope = new Scope();
  this.installBuiltins(globalScope);

  const frame = new Frame(bytecode, globalScope);
  return this.executeFrame(frame);
}

export function executeFrame(this: VirtualMachine, frame: Frame): PyValue {
  const { instructions, constants, names, varnames } = frame.bytecode;
  // console.log('Executing frame with names:', names);

  // Populate scope with globals and nonlocals from bytecode
  if (frame.bytecode.globals) {
    for (const name of frame.bytecode.globals) {
      frame.scope.globals.add(name);
    }
  }
  if (frame.bytecode.nonlocals) {
    for (const name of frame.bytecode.nonlocals) {
      frame.scope.nonlocals.add(name);
    }
  }

  let lastValue: PyValue = null;

  // Cache frequently accessed properties for faster access (V8 optimization)
  const stack = frame.stack;
  const locals = frame.locals;
  const scope = frame.scope;
  const scopeValues = scope.values;
  const iterSymbol = Symbol.iterator;

  const renderFString = (template: string, scope: Scope): string => {
    return template.replace(/\{([^}]+)\}/g, (_m, expr) => {
      const { rawExpr, rawSpec } = this.splitFormatSpec(expr);
      // Create a temporary scope that includes local variables for f-string evaluation
      const evalScope = new Scope(scope);
      if (varnames) {
        for (let i = 0; i < varnames.length; i++) {
          const varname = varnames[i];
          if (varname === undefined) continue;
          if (scope.values.has(varname)) {
            const val = scope.values.get(varname);
            if (process.env['DEBUG_NONLOCAL']) {
              console.log(`renderFString: varname=${varname}, scope.values.get=${val}`);
            }
            evalScope.values.set(varname, val);
          } else if (locals[i] !== undefined) {
            if (process.env['DEBUG_NONLOCAL']) {
              console.log(`renderFString: varname=${varname}, locals[${i}]=${locals[i]}`);
            }
            evalScope.values.set(varname, locals[i]);
          }
        }
      }
      const inner = this.evaluateExpressionString(rawExpr.trim(), evalScope);
      return this.applyFormatSpec(inner, rawSpec ? rawSpec.trim() : '');
    });
  };

  const normalizeThrown = (err: PyValue): PyValue => {
    if (err instanceof PyException) {
      try {
        const klass = frame.scope.get(err.pyType);
        if (klass instanceof PyClass) {
          const inst = new PyInstance(klass);
          if (err.message) inst.attributes.set('message', err.message);
          return inst;
        }
      } catch {
        // Ignore normalization failures
      }
    }
    return err;
  };

  const dispatchException = (err: PyValue): boolean => {
    if (frame.blockStack.length === 0) return false;
    const block = frame.blockStack.pop()!;
    stack.length = block.stackHeight;
    stack.push(normalizeThrown(err));
    frame.pc = block.handler;
    return true;
  };

  while (frame.pc < instructions.length) {
    const instr = instructions[frame.pc++];
    if (!instr) break;
    const { opcode, arg } = instr;

    try {
      // Switch cases ordered by execution frequency (hot paths first)
      // Based on dynamic opcode execution profiling across benchmark workloads:
      // - Fibonacci recursion, list operations, nested loops, dictionary ops, etc.
      // - LOAD_FAST (22-23%), LOAD_CONST (18%), LOAD_NAME (9-33%) are hottest
      // - All 73 cases reordered: frequent ops first, then grouped by category
      // This reduces average case evaluations and improves branch prediction
      switch (opcode) {
        // === HOT PATH: Most frequently executed opcodes (>5% execution time) ===
        case OpCode.LOAD_FAST: {
          // Optimize common case: value is in locals
          let val = locals[arg!];
          if (val === undefined) {
            // Check scope values as fallback
            const varname = varnames[arg!];
            if (varname !== undefined && scopeValues.has(varname)) {
              val = scopeValues.get(varname);
              locals[arg!] = val;
            } else {
              throw new PyException('UnboundLocalError', `local variable '${varname}' referenced before assignment`);
            }
          }
          stack.push(val);
          break;
        }

        case OpCode.LOAD_CONST:
          {
            const val: PyValue = constants[arg!];
            if (val && typeof val === 'object' && typeof val.__fstring__ === 'string') {
              stack.push(renderFString(val.__fstring__, frame.scope));
            } else {
              stack.push(val);
            }
          }
          break;

        case OpCode.LOAD_NAME: {
          const name = names[arg!];
          const val = scope.get(name);
          // console.log(`LOAD_NAME ${name} -> ${val}`);
          stack.push(val);
          break;
        }

        case OpCode.BINARY_ADD: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(a + b);
          } else {
            stack.push(this.applyBinary('+', a, b));
          }
          break;
        }

        case OpCode.BINARY_SUBTRACT: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(a - b);
          } else {
            stack.push(this.applyBinary('-', a, b));
          }
          break;
        }

        case OpCode.BINARY_MULTIPLY: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(a * b);
          } else {
            stack.push(this.applyBinary('*', a, b));
          }
          break;
        }

        case OpCode.CALL_FUNCTION: {
          const argCount = arg!;
          const args = new Array(argCount);
          // Pop arguments in reverse order
          for (let i = argCount - 1; i >= 0; i--) {
            args[i] = stack.pop();
          }
          const func = stack.pop();
          stack.push(this.callFunction(func, args, scope));
          break;
        }

        case OpCode.RETURN_VALUE:
          return stack.pop();

        case OpCode.COMPARE_OP: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple integer comparisons
          if (typeof a === 'number' && typeof b === 'number') {
            let result: boolean | undefined = undefined;
            switch (arg as CompareOp) {
              case CompareOp.LT: result = a < b; break;
              case CompareOp.LE: result = a <= b; break;
              case CompareOp.EQ: result = a === b; break;
              case CompareOp.NE: result = a !== b; break;
              case CompareOp.GT: result = a > b; break;
              case CompareOp.GE: result = a >= b; break;
            }
            if (result !== undefined) {
              stack.push(result);
            } else {
              stack.push(this.applyCompare(arg as CompareOp, a, b));
            }
          } else {
            stack.push(this.applyCompare(arg as CompareOp, a, b));
          }
          break;
        }

        case OpCode.POP_JUMP_IF_FALSE: {
          const val = stack.pop();
          // Fast path for booleans and numbers
          let isFalse = false;
          if (typeof val === 'boolean') {
            isFalse = !val;
          } else if (typeof val === 'number') {
            isFalse = val === 0;
          } else if (val === null || val === undefined) {
            isFalse = true;
          } else {
            isFalse = !this.isTruthy(val, scope);
          }
          if (isFalse) {
            frame.pc = arg!;
          }
          break;
        }

        case OpCode.STORE_FAST: {
          const val = stack.pop();
          locals[arg!] = val;
          if (varnames && varnames[arg!] !== undefined) {
            scopeValues.set(varnames[arg!], val);
          }
          break;
        }

        case OpCode.STORE_NAME:
          scope.set(names[arg!], stack.pop());
          break;

        case OpCode.FOR_ITER: {
          const iter = stack[stack.length - 1];
          const next = iter.next();
          if (next.done) {
            stack.pop();
            frame.pc = arg!;
          } else {
            stack.push(next.value);
          }
          break;
        }

        case OpCode.JUMP_ABSOLUTE:
          frame.pc = arg!;
          break;

        case OpCode.INPLACE_ADD: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(a + b);
          } else {
            stack.push(this.applyInPlaceBinary('+', a, b));
          }
          break;
        }

        case OpCode.INPLACE_SUBTRACT: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(a - b);
          } else {
            stack.push(this.applyInPlaceBinary('-', a, b));
          }
          break;
        }

        case OpCode.INPLACE_MULTIPLY: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(a * b);
          } else {
            stack.push(this.applyInPlaceBinary('*', a, b));
          }
          break;
        }

        case OpCode.POP_TOP:
          lastValue = stack.pop();
          break;

        case OpCode.GET_ITER: {
          const obj = stack.pop();
          if (obj && typeof obj[iterSymbol] === 'function') {
            stack.push(obj[iterSymbol]());
          } else {
            throw new PyException('TypeError', `'${typeof obj}' object is not iterable`);
          }
          break;
        }

        case OpCode.LOAD_ATTR: {
          const obj = stack.pop();
          stack.push(this.getAttribute(obj, names[arg!], frame.scope));
          break;
        }

        // Other BINARY operations
        case OpCode.BINARY_DIVIDE: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(a / b);
          } else {
            stack.push(this.applyBinary('/', a, b));
          }
          break;
        }

        case OpCode.BINARY_FLOOR_DIVIDE: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(Math.floor(a / b));
          } else {
            stack.push(this.applyBinary('//', a, b));
          }
          break;
        }

        case OpCode.BINARY_MODULO: {
          const b = stack.pop();
          const a = stack.pop();
          // Fast path for simple numbers
          if (typeof a === 'number' && typeof b === 'number') {
            stack.push(a % b);
          } else {
            stack.push(this.applyBinary('%', a, b));
          }
          break;
        }

        case OpCode.BINARY_POWER: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyBinary('**', a, b));
          break;
        }

        case OpCode.BINARY_AND: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyBinary('&', a, b));
          break;
        }

        case OpCode.BINARY_XOR: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyBinary('^', a, b));
          break;
        }

        case OpCode.BINARY_OR: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyBinary('|', a, b));
          break;
        }

        case OpCode.BINARY_LSHIFT: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyBinary('<<', a, b));
          break;
        }

        case OpCode.BINARY_RSHIFT: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyBinary('>>', a, b));
          break;
        }

        // Other INPLACE operations
        case OpCode.INPLACE_DIVIDE: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('/', a, b));
          break;
        }

        case OpCode.INPLACE_FLOOR_DIVIDE: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('//', a, b));
          break;
        }

        case OpCode.INPLACE_MODULO: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('%', a, b));
          break;
        }

        case OpCode.INPLACE_POWER: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('**', a, b));
          break;
        }

        case OpCode.INPLACE_AND: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('&', a, b));
          break;
        }

        case OpCode.INPLACE_XOR: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('^', a, b));
          break;
        }

        case OpCode.INPLACE_OR: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('|', a, b));
          break;
        }

        case OpCode.INPLACE_LSHIFT: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('<<', a, b));
          break;
        }

        case OpCode.INPLACE_RSHIFT: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(this.applyInPlaceBinary('>>', a, b));
          break;
        }

        // Other JUMP operations
        case OpCode.POP_JUMP_IF_TRUE: {
          const val = stack.pop();
          if (this.isTruthy(val, frame.scope)) {
            frame.pc = arg!;
          }
          break;
        }

        case OpCode.JUMP_IF_FALSE_OR_POP: {
          const val = stack[stack.length - 1];
          if (!this.isTruthy(val, frame.scope)) {
            frame.pc = arg!;
          } else {
            stack.pop();
          }
          break;
        }

        case OpCode.JUMP_IF_TRUE_OR_POP: {
          const val = stack[stack.length - 1];
          if (this.isTruthy(val, frame.scope)) {
            frame.pc = arg!;
          } else {
            stack.pop();
          }
          break;
        }

        // LOAD/STORE operations
        case OpCode.LOAD_GLOBAL: {
          const name = names[arg!];
          // Find the global (topmost) scope
          let globalScope = frame.scope;
          while (globalScope.parent !== null) {
            globalScope = globalScope.parent;
          }
          const val = globalScope.get(name);
          stack.push(val);
          break;
        }

        case OpCode.STORE_GLOBAL: {
          const name = names[arg!];
          // Find the global (topmost) scope
          let globalScope = frame.scope;
          while (globalScope.parent !== null) {
            globalScope = globalScope.parent;
          }
          globalScope.set(name, stack.pop());
          break;
        }

        case OpCode.STORE_ATTR: {
          const val = stack.pop();
          const obj = stack.pop();
          this.setAttribute(obj, names[arg!], val);
          break;
        }

        case OpCode.LOAD_SUBSCR: {
          const index = stack.pop();
          const obj = stack.pop();
          stack.push(this.getSubscript(obj, index));
          break;
        }

        case OpCode.STORE_SUBSCR: {
          const index = stack.pop();
          const obj = stack.pop();
          const val = stack.pop();

          // Check if object is a tuple (immutable)
          if (Array.isArray(obj) && (obj as PyValue).__tuple__) {
            throw new PyException('TypeError', `'tuple' object does not support item assignment`);
          }

          if (Array.isArray(obj)) {
            // Handle slice assignment
            if (index && (index.__slice__ || index.type === ASTNodeType.SLICE)) {
              const start = index.start !== undefined ? index.start : null;
              const end = index.end !== undefined ? index.end : null;
              const step = index.step !== undefined ? index.step : 1;
              const bounds = this.computeSliceBounds(obj.length, start, end, step);
              const indices = this.computeSliceIndices(obj.length, start, end, step);

              // For extended slices (step != 1), replacement must have same length
              if (bounds.step !== 1) {
                if (!Array.isArray(val) || val.length !== indices.length) {
                  throw new PyException('ValueError', `attempt to assign sequence of size ${Array.isArray(val) ? val.length : 1} to extended slice of size ${indices.length}`);
                }
                for (let i = 0; i < indices.length; i++) {
                  obj[indices[i]] = val[i];
                }
              } else {
                // Simple slice: replace the slice with the new values
                const valArray = Array.isArray(val) ? val : [val];
                obj.splice(bounds.start, indices.length, ...valArray);
              }
            } else {
              obj[index] = val;
            }
          } else if (obj instanceof PyDict) {
            obj.set(index, val);
          } else {
            throw new PyException('TypeError', `'${typeof obj}' object does not support item assignment`);
          }
          break;
        }

        case OpCode.DELETE_SUBSCR: {
          const index = stack.pop();
          const obj = stack.pop();

          if (Array.isArray(obj)) {
            if (index && (index.__slice__ || index.type === ASTNodeType.SLICE)) {
              const start = index.start !== undefined ? index.start : null;
              const end = index.end !== undefined ? index.end : null;
              const step = index.step !== undefined ? index.step : 1;
              const bounds = this.computeSliceBounds(obj.length, start, end, step);
              // Standard deletion of slice
              if (bounds.step === 1) {
                obj.splice(bounds.start, bounds.end - bounds.start);
              } else {
                // Deleting with step != 1
                const indices = this.computeSliceIndices(obj.length, start, end, step);
                // We must delete from back to front to avoid index shifting problems
                indices.sort((a, b) => b - a);
                for (const idx of indices) {
                  obj.splice(idx, 1);
                }
              }
            } else {
              if (typeof index !== 'number') {
                throw new PyException('TypeError', 'list indices must be integers or slices');
              }
              obj.splice(index, 1);
            }
          } else if (obj instanceof PyDict) {
            obj.delete(index);
          } else if (obj instanceof PySet) {
            obj.delete(index);
          } else {
            throw new PyException('TypeError', `'${typeof obj}' object does not support item deletion`);
          }
          break;
        }

        // UNPACK operations
        case OpCode.UNPACK_SEQUENCE: {
          const seq = stack.pop();
          const items = Array.isArray(seq) ? seq : Array.from(seq as PyValue);
          if (items.length !== arg!) {
            throw new PyException('ValueError', `not enough values to unpack (expected ${arg!}, got ${items.length})`);
          }
          for (let i = items.length - 1; i >= 0; i--) {
            stack.push(items[i]);
          }
          break;
        }

        case OpCode.UNPACK_EX: {
          const seq = stack.pop();
          const items = Array.isArray(seq) ? seq : Array.from(seq as PyValue);
          const beforeCount = (arg! >> 8) & 0xff;
          const afterCount = arg! & 0xff;
          if (items.length < beforeCount + afterCount) {
            throw new PyException('ValueError', 'not enough values to unpack');
          }
          const middle = items.slice(beforeCount, items.length - afterCount);

          // Push in reverse order of assignment popping:
          // suffix values (last..first), then middle list, then prefix values (last..first).
          for (let i = afterCount - 1; i >= 0; i--) {
            stack.push(items[items.length - afterCount + i]);
          }
          stack.push(middle);
          for (let i = beforeCount - 1; i >= 0; i--) {
            stack.push(items[i]);
          }
          break;
        }

        // Stack operations
        case OpCode.DUP_TOP: {
          const val = stack[stack.length - 1];
          stack.push(val);
          break;
        }

        case OpCode.DUP_TOP_TWO: {
          const top = stack[stack.length - 1];
          const second = stack[stack.length - 2];
          stack.push(second);
          stack.push(top);
          break;
        }

        case OpCode.ROT_TWO: {
          const a = stack.pop();
          const b = stack.pop();
          stack.push(a);
          stack.push(b);
          break;
        }

        case OpCode.ROT_THREE: {
          const a = stack.pop();
          const b = stack.pop();
          const c = stack.pop();
          stack.push(a);
          stack.push(c);
          stack.push(b);
          break;
        }

        // UNARY operations
        case OpCode.UNARY_POSITIVE: {
          const a = stack.pop();
          stack.push(+a);
          break;
        }

        case OpCode.UNARY_NEGATIVE: {
          const a = stack.pop();
          if (typeof a === 'bigint') {
            stack.push(-a);
          } else {
            stack.push(-a);
          }
          break;
        }

        case OpCode.UNARY_NOT: {
          const a = stack.pop();
          stack.push(!this.isTruthy(a, frame.scope));
          break;
        }

        case OpCode.UNARY_INVERT: {
          const a = stack.pop();
          if (typeof a === 'bigint') {
            stack.push(~a);
          } else {
            stack.push(~Number(a));
          }
          break;
        }

        // BUILD operations
        case OpCode.BUILD_LIST: {
          const count = arg!;
          const list = new Array(count);
          for (let i = count - 1; i >= 0; i--) list[i] = stack.pop();
          stack.push(list);
          break;
        }

        case OpCode.BUILD_TUPLE: {
          const count = arg!;
          const tuple: PyValue[] = new Array(count);
          for (let i = count - 1; i >= 0; i--) tuple[i] = stack.pop();
          (tuple as PyValue).__tuple__ = true;
          stack.push(tuple);
          break;
        }

        case OpCode.BUILD_MAP: {
          const dict = new PyDict();
          const items = [];
          for (let i = 0; i < arg!; i++) {
            const v = stack.pop();
            const k = stack.pop();
            items.push({ k, v });
          }
          for (let i = items.length - 1; i >= 0; i--) {
            dict.set(items[i].k, items[i].v);
          }
          stack.push(dict);
          break;
        }

        case OpCode.BUILD_SET: {
          const set = new PySet();
          for (let i = 0; i < arg!; i++) {
            set.add(stack.pop());
          }
          stack.push(set);
          break;
        }

        case OpCode.BUILD_SLICE: {
          const step = arg === 3 ? stack.pop() : null;
          const end = stack.pop();
          const start = stack.pop();
          // Create a slice object with start/end/step to match parser AST nodes
          stack.push({ __slice__: true, start, end, step });
          break;
        }

        // Function/class operations
        case OpCode.MAKE_FUNCTION: {
          const defaultsCount = arg || 0;
          const name = stack.pop();
          const bc = stack.pop();
          const defaults: PyValue[] = new Array(defaultsCount);
          // Pop default values from stack in reverse order (last default on top)
          for (let i = defaultsCount - 1; i >= 0; i--) {
            defaults[i] = stack.pop();
          }

          // Create a copy of params with evaluated defaults
          const params = (bc && bc.params) ? bc.params.map((p: PyValue) => ({ ...p })) : [];
          if (params.length > 0 && defaultsCount > 0) {
            let defaultIndex = 0;
            for (let i = params.length - defaultsCount; i < params.length; i++) {
              if (params[i] && params[i].type === 'Param') {
                params[i].defaultEvaluated = defaults[defaultIndex++];
              }
            }
          }

          const isGenerator = !!(bc && (bc as PyValue).isGenerator);
          const body = (bc && (bc as PyValue).astBody) ? (bc as PyValue).astBody : [];
          const func = new PyFunction(name, params, body, frame.scope, isGenerator, new Set(), bc);
          func.closure_shared_values = frame.scope.values;
          stack.push(func);
          break;
        }

        case OpCode.CALL_FUNCTION_KW: {
          const kwNames = stack.pop();
          const kwList: PyValue[] = Array.isArray(kwNames) ? kwNames : [];
          const kwCount = kwList.length;
          const total = arg!;
          const values: PyValue[] = new Array(total);
          for (let i = total - 1; i >= 0; i--) {
            values[i] = stack.pop();
          }
          const func = stack.pop();
          const positionalCount = total - kwCount;
          const positional = values.slice(0, positionalCount);
          const kwargs: Record<string, PyValue> = {};
          for (let i = 0; i < kwCount; i++) {
            kwargs[String(kwList[i])] = values[positionalCount + i];
          }
          stack.push(this.callFunction(func, positional, frame.scope, kwargs));
          break;
        }

        case OpCode.CALL_FUNCTION_EX: {
          // arg == 1 means there's a kwargs dict on top
          // Stack: [func, args_tuple] or [func, args_tuple, kwargs_dict]
          const kwargs: Record<string, PyValue> = {};
          if (arg === 1) {
            const kwDict = stack.pop();
            if (kwDict instanceof PyDict) {
              for (const [k, v] of kwDict.entries()) {
                kwargs[String(k)] = v;
              }
            } else if (kwDict && typeof kwDict === 'object') {
              for (const [k, v] of Object.entries(kwDict)) {
                kwargs[k] = v;
              }
            }
          }
          const argsTuple = stack.pop();
          const func = stack.pop();
          const args = Array.isArray(argsTuple) ? argsTuple : (argsTuple ? Array.from(argsTuple) : []);
          stack.push(this.callFunction(func, args, frame.scope, kwargs));
          break;
        }

        case OpCode.LOAD_BUILD_CLASS: {
          const enclosingScope = frame.scope;
          stack.push((bodyFn: PyValue, name: PyValue, ...bases: PyValue[]) => {
            const classScope = new Scope(enclosingScope, true);
            if (bodyFn instanceof PyFunction && bodyFn.bytecode) {
              const bodyFrame = new Frame(bodyFn.bytecode, classScope);
              // Class bodies take no args; locals stay empty.
              this.executeFrame(bodyFrame);
            } else if (typeof bodyFn === 'function') {
              bodyFn();
            }
            const attributes = new Map(classScope.values.entries());
            const isException = bases.some((b: PyValue) => b instanceof PyClass && b.isException);
            return new PyClass(String(name), bases, attributes, isException);
          });
          break;
        }

        // Import/exception operations
        case OpCode.IMPORT_NAME: {
          stack.pop(); // level
          stack.pop(); // fromlist
          const name = names[arg!];
          stack.push(this.importModule(name, frame.scope));
          break;
        }

        case OpCode.RAISE_VARARGS: {
          if (arg! >= 2) stack.pop(); // cause
          const exc = arg! >= 1 ? stack.pop() : null;
          // simplified raise
          throw exc || new PyException('RuntimeError', 'No exception to raise');
        }

        case OpCode.SETUP_FINALLY: {
          frame.blockStack.push({ handler: arg!, stackHeight: stack.length });
          break;
        }

        case OpCode.SETUP_WITH: {
          const ctx = stack.pop();
          const enter = this.getAttribute(ctx, '__enter__', frame.scope);
          const exit = this.getAttribute(ctx, '__exit__', frame.scope);
          const result = this.callFunction(enter, [], frame.scope);

          stack.push(exit);
          stack.push(result);

          // Block should assume exit is on stack, so stackHeight includes exit.
          // When popping block, we leave exit on stack? 
          // No, standard behavior: SETUP_WITH pushes exit, enter_res.
          // Handler expects [exit, exc...]? 
          // Let's rely on blockStack logic: stack returned to stackHeight on exception.
          // If we set stackHeight to include exit, then on exception, we have [exit], then push exc.
          frame.blockStack.push({ handler: arg!, stackHeight: stack.length - 1 });
          break;
        }

        case OpCode.WITH_EXCEPT_START: {
          // Stack: [exit, exc_norm] (after normalizeThrown in dispatchException)
          // Or [exit, exc]
          // This opcode calls exit(type, val, tb)

          const exc = stack.pop();
          const exit = stack.pop();

          // Call exit(type, val, tb)
          // For our VM, we can pass (exc.type, exc, None)
          const pyType = (exc instanceof PyInstance) ? exc.klass : (exc.pyType || exc);

          const handled = this.callFunction(exit, [pyType, exc, null], frame.scope);

          if (this.isTruthy(handled, frame.scope)) {
            // Exception suppressed
            // Pop exception from stack (we already popped it)
            // Push nothing? or push suppression marker?
            // CPython pushes nothing on suppression?
            // "If __exit__ returns True, the exception is suppressed, and execution proceeds"
            // We usually JUMP after this.
            // But if we just consumed the exception, we need to ensure the stack is clean for the next block.
          } else {
            // Exception not suppressed, re-raise
            throw exc;
          }
          break;
        }

        case OpCode.POP_BLOCK: {
          frame.blockStack.pop();
          break;
        }

        case OpCode.EVAL_AST: {
          const node = stack.pop();
          stack.push(this.evaluateExpression(node, frame.scope));
          break;
        }

        default:
          throw new Error(`VM: Unknown opcode ${OpCode[opcode]} (${opcode}) at pc ${frame.pc - 1}`);
      }
    } catch (err) {
      if (dispatchException(err)) {
        continue;
      }
      throw err;
    }
  }

  return lastValue;
}

export {
  applyCompare,
  iterableToArray,
  matchValueEquals,
  applyBindings,
  matchPattern,
  evaluateExpression,
  executeStatement,
  executeBlockGenerator,
  executeStatementGenerator,
  executeBlock,
} from './execution-helpers';
