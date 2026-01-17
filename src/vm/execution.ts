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
          } else if (frame.locals[i] !== undefined) {
            if (process.env['DEBUG_NONLOCAL']) {
              console.log(`renderFString: varname=${varname}, frame.locals[${i}]=${frame.locals[i]}`);
            }
            evalScope.values.set(varname, frame.locals[i]);
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
    frame.stack.length = block.stackHeight;
    frame.stack.push(normalizeThrown(err));
    frame.pc = block.handler;
    return true;
  };

  while (frame.pc < instructions.length) {
    const instr = instructions[frame.pc++];
    if (!instr) break;
    const { opcode, arg } = instr;

    try {
      switch (opcode) {
        case OpCode.LOAD_CONST:
          {
            const val: PyValue = constants[arg!];
            if (val && typeof val === 'object' && typeof val.__fstring__ === 'string') {
              frame.stack.push(renderFString(val.__fstring__, frame.scope));
            } else {
              frame.stack.push(val);
            }
          }
          break;

        case OpCode.LOAD_NAME: {
          const name = names[arg!];
          const val = frame.scope.get(name);
          // console.log(`LOAD_NAME ${name} -> ${val}`);
          frame.stack.push(val);
          break;
        }

        case OpCode.STORE_NAME:
          frame.scope.set(names[arg!], frame.stack.pop());
          break;

        case OpCode.LOAD_GLOBAL: {
          const name = names[arg!];
          // Find the global (topmost) scope
          let globalScope = frame.scope;
          while (globalScope.parent !== null) {
            globalScope = globalScope.parent;
          }
          const val = globalScope.get(name);
          frame.stack.push(val);
          break;
        }

        case OpCode.STORE_GLOBAL: {
          const name = names[arg!];
          // Find the global (topmost) scope
          let globalScope = frame.scope;
          while (globalScope.parent !== null) {
            globalScope = globalScope.parent;
          }
          globalScope.set(name, frame.stack.pop());
          break;
        }

        case OpCode.LOAD_FAST: {
          const varname = varnames[arg!];
          if (varname !== undefined && frame.scope.values.has(varname)) {
            const val = frame.scope.values.get(varname);
            frame.locals[arg!] = val;
            frame.stack.push(val);
            break;
          }
          const val = frame.locals[arg!];
          if (val === undefined) {
            throw new PyException('UnboundLocalError', `local variable '${varname}' referenced before assignment`);
          }
          frame.stack.push(val);
          break;
        }

        case OpCode.STORE_FAST: {
          const val = frame.stack.pop();
          frame.locals[arg!] = val;
          if (varnames && varnames[arg!] !== undefined) {
            frame.scope.values.set(varnames[arg!], val);
          }
          break;
        }

        case OpCode.UNPACK_SEQUENCE: {
          const seq = frame.stack.pop();
          const items = Array.isArray(seq) ? seq : Array.from(seq as PyValue);
          if (items.length !== arg!) {
            throw new PyException('ValueError', `not enough values to unpack (expected ${arg!}, got ${items.length})`);
          }
          for (let i = items.length - 1; i >= 0; i--) {
            frame.stack.push(items[i]);
          }
          break;
        }

        case OpCode.UNPACK_EX: {
          const seq = frame.stack.pop();
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
            frame.stack.push(items[items.length - afterCount + i]);
          }
          frame.stack.push(middle);
          for (let i = beforeCount - 1; i >= 0; i--) {
            frame.stack.push(items[i]);
          }
          break;
        }

        case OpCode.LOAD_ATTR: {
          const obj = frame.stack.pop();
          frame.stack.push(this.getAttribute(obj, names[arg!], frame.scope));
          break;
        }

        case OpCode.STORE_ATTR: {
          const val = frame.stack.pop();
          const obj = frame.stack.pop();
          this.setAttribute(obj, names[arg!], val);
          break;
        }

        case OpCode.LOAD_SUBSCR: {
          const index = frame.stack.pop();
          const obj = frame.stack.pop();
          frame.stack.push(this.getSubscript(obj, index));
          break;
        }

        case OpCode.STORE_SUBSCR: {
          const index = frame.stack.pop();
          const obj = frame.stack.pop();
          const val = frame.stack.pop();

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
          const index = frame.stack.pop();
          const obj = frame.stack.pop();

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

        case OpCode.POP_TOP:
          lastValue = frame.stack.pop();
          break;

        case OpCode.DUP_TOP: {
          const val = frame.stack[frame.stack.length - 1];
          frame.stack.push(val);
          break;
        }

        case OpCode.DUP_TOP_TWO: {
          const top = frame.stack[frame.stack.length - 1];
          const second = frame.stack[frame.stack.length - 2];
          frame.stack.push(second);
          frame.stack.push(top);
          break;
        }

        case OpCode.ROT_TWO: {
          const a = frame.stack.pop();
          const b = frame.stack.pop();
          frame.stack.push(a);
          frame.stack.push(b);
          break;
        }

        case OpCode.ROT_THREE: {
          const a = frame.stack.pop();
          const b = frame.stack.pop();
          const c = frame.stack.pop();
          frame.stack.push(a);
          frame.stack.push(c);
          frame.stack.push(b);
          break;
        }

        case OpCode.BINARY_ADD: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('+', a, b));
          break;
        }

        case OpCode.BINARY_SUBTRACT: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('-', a, b));
          break;
        }

        case OpCode.BINARY_MULTIPLY: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('*', a, b));
          break;
        }

        case OpCode.BINARY_DIVIDE: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('/', a, b));
          break;
        }

        case OpCode.BINARY_FLOOR_DIVIDE: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('//', a, b));
          break;
        }

        case OpCode.BINARY_MODULO: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('%', a, b));
          break;
        }

        case OpCode.BINARY_POWER: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('**', a, b));
          break;
        }

        case OpCode.BINARY_AND: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('&', a, b));
          break;
        }

        case OpCode.BINARY_XOR: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('^', a, b));
          break;
        }

        case OpCode.BINARY_OR: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('|', a, b));
          break;
        }

        case OpCode.BINARY_LSHIFT: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('<<', a, b));
          break;
        }

        case OpCode.BINARY_RSHIFT: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyBinary('>>', a, b));
          break;
        }

        case OpCode.INPLACE_ADD: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('+', a, b));
          break;
        }

        case OpCode.INPLACE_SUBTRACT: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('-', a, b));
          break;
        }

        case OpCode.INPLACE_MULTIPLY: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('*', a, b));
          break;
        }

        case OpCode.INPLACE_DIVIDE: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('/', a, b));
          break;
        }

        case OpCode.INPLACE_FLOOR_DIVIDE: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('//', a, b));
          break;
        }

        case OpCode.INPLACE_MODULO: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('%', a, b));
          break;
        }

        case OpCode.INPLACE_POWER: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('**', a, b));
          break;
        }

        case OpCode.INPLACE_AND: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('&', a, b));
          break;
        }

        case OpCode.INPLACE_XOR: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('^', a, b));
          break;
        }

        case OpCode.INPLACE_OR: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('|', a, b));
          break;
        }

        case OpCode.INPLACE_LSHIFT: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('<<', a, b));
          break;
        }

        case OpCode.INPLACE_RSHIFT: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyInPlaceBinary('>>', a, b));
          break;
        }

        case OpCode.UNARY_POSITIVE: {
          const a = frame.stack.pop();
          frame.stack.push(+a);
          break;
        }

        case OpCode.UNARY_NEGATIVE: {
          const a = frame.stack.pop();
          if (typeof a === 'bigint') {
            frame.stack.push(-a);
          } else {
            frame.stack.push(-a);
          }
          break;
        }

        case OpCode.UNARY_NOT: {
          const a = frame.stack.pop();
          frame.stack.push(!this.isTruthy(a, frame.scope));
          break;
        }

        case OpCode.UNARY_INVERT: {
          const a = frame.stack.pop();
          if (typeof a === 'bigint') {
            frame.stack.push(~a);
          } else {
            frame.stack.push(~Number(a));
          }
          break;
        }

        case OpCode.COMPARE_OP: {
          const b = frame.stack.pop();
          const a = frame.stack.pop();
          frame.stack.push(this.applyCompare(arg as CompareOp, a, b));
          break;
        }

        case OpCode.BUILD_LIST: {
          const list = [];
          for (let i = 0; i < arg!; i++) list.unshift(frame.stack.pop());
          frame.stack.push(list);
          break;
        }

        case OpCode.BUILD_TUPLE: {
          const tuple: PyValue[] = [];
          for (let i = 0; i < arg!; i++) tuple.unshift(frame.stack.pop());
          (tuple as PyValue).__tuple__ = true;
          frame.stack.push(tuple);
          break;
        }

        case OpCode.BUILD_MAP: {
          const dict = new PyDict();
          const items = [];
          for (let i = 0; i < arg!; i++) {
            const v = frame.stack.pop();
            const k = frame.stack.pop();
            items.push({ k, v });
          }
          for (let i = items.length - 1; i >= 0; i--) {
            dict.set(items[i].k, items[i].v);
          }
          frame.stack.push(dict);
          break;
        }

        case OpCode.BUILD_SET: {
          const set = new PySet();
          for (let i = 0; i < arg!; i++) {
            set.add(frame.stack.pop());
          }
          frame.stack.push(set);
          break;
        }

        case OpCode.BUILD_SLICE: {
          const step = arg === 3 ? frame.stack.pop() : null;
          const end = frame.stack.pop();
          const start = frame.stack.pop();
          // Create a slice object with start/end/step to match parser AST nodes
          frame.stack.push({ __slice__: true, start, end, step });
          break;
        }

        case OpCode.JUMP_ABSOLUTE:
          frame.pc = arg!;
          break;

        case OpCode.POP_JUMP_IF_FALSE: {
          const val = frame.stack.pop();
          if (!this.isTruthy(val, frame.scope)) {
            frame.pc = arg!;
          }
          break;
        }

        case OpCode.POP_JUMP_IF_TRUE: {
          const val = frame.stack.pop();
          if (this.isTruthy(val, frame.scope)) {
            frame.pc = arg!;
          }
          break;
        }

        case OpCode.JUMP_IF_FALSE_OR_POP: {
          const val = frame.stack[frame.stack.length - 1];
          if (!this.isTruthy(val, frame.scope)) {
            frame.pc = arg!;
          } else {
            frame.stack.pop();
          }
          break;
        }

        case OpCode.JUMP_IF_TRUE_OR_POP: {
          const val = frame.stack[frame.stack.length - 1];
          if (this.isTruthy(val, frame.scope)) {
            frame.pc = arg!;
          } else {
            frame.stack.pop();
          }
          break;
        }

        case OpCode.GET_ITER: {
          const obj = frame.stack.pop();
          if (obj && typeof obj[Symbol.iterator] === 'function') {
            frame.stack.push(obj[Symbol.iterator]());
          } else {
            throw new PyException('TypeError', `'${typeof obj}' object is not iterable`);
          }
          break;
        }

        case OpCode.FOR_ITER: {
          const iter = frame.stack[frame.stack.length - 1];
          const next = iter.next();
          if (next.done) {
            frame.stack.pop();
            frame.pc = arg!;
          } else {
            frame.stack.push(next.value);
          }
          break;
        }

        case OpCode.MAKE_FUNCTION: {
          const defaultsCount = arg || 0;
          const name = frame.stack.pop();
          const bc = frame.stack.pop();
          const defaults: PyValue[] = [];
          // Pop default values from stack in reverse order (last default on top)
          for (let i = 0; i < defaultsCount; i++) {
            defaults.unshift(frame.stack.pop());
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
          frame.stack.push(func);
          break;
        }

        case OpCode.LOAD_BUILD_CLASS: {
          const enclosingScope = frame.scope;
          frame.stack.push((bodyFn: PyValue, name: PyValue, ...bases: PyValue[]) => {
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

        case OpCode.IMPORT_NAME: {
          frame.stack.pop(); // level
          frame.stack.pop(); // fromlist
          const name = names[arg!];
          frame.stack.push(this.importModule(name, frame.scope));
          break;
        }

        case OpCode.RAISE_VARARGS: {
          if (arg! >= 2) frame.stack.pop(); // cause
          const exc = arg! >= 1 ? frame.stack.pop() : null;
          // simplified raise
          throw exc || new PyException('RuntimeError', 'No exception to raise');
        }

        case OpCode.SETUP_FINALLY: {
          frame.blockStack.push({ handler: arg!, stackHeight: frame.stack.length });
          break;
        }

        case OpCode.SETUP_WITH: {
          const ctx = frame.stack.pop();
          const enter = this.getAttribute(ctx, '__enter__', frame.scope);
          const exit = this.getAttribute(ctx, '__exit__', frame.scope);
          const result = this.callFunction(enter, [], frame.scope);

          frame.stack.push(exit);
          frame.stack.push(result);

          // Block should assume exit is on stack, so stackHeight includes exit.
          // When popping block, we leave exit on stack? 
          // No, standard behavior: SETUP_WITH pushes exit, enter_res.
          // Handler expects [exit, exc...]? 
          // Let's rely on blockStack logic: stack returned to stackHeight on exception.
          // If we set stackHeight to include exit, then on exception, we have [exit], then push exc.
          frame.blockStack.push({ handler: arg!, stackHeight: frame.stack.length - 1 });
          break;
        }

        case OpCode.WITH_EXCEPT_START: {
          // Stack: [exit, exc_norm] (after normalizeThrown in dispatchException)
          // Or [exit, exc]
          // This opcode calls exit(type, val, tb)

          const exc = frame.stack.pop();
          const exit = frame.stack.pop();

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

        case OpCode.CALL_FUNCTION: {
          const args = [];
          for (let i = 0; i < arg!; i++) {
            args.unshift(frame.stack.pop());
          }
          const func = frame.stack.pop();
          frame.stack.push(this.callFunction(func, args, frame.scope));
          break;
        }

        case OpCode.CALL_FUNCTION_KW: {
          const kwNames = frame.stack.pop();
          const kwList: PyValue[] = Array.isArray(kwNames) ? kwNames : [];
          const kwCount = kwList.length;
          const total = arg!;
          const values: PyValue[] = [];
          for (let i = 0; i < total; i++) {
            values.unshift(frame.stack.pop());
          }
          const func = frame.stack.pop();
          const positionalCount = total - kwCount;
          const positional = values.slice(0, positionalCount);
          const kwargs: Record<string, PyValue> = {};
          for (let i = 0; i < kwCount; i++) {
            kwargs[String(kwList[i])] = values[positionalCount + i];
          }
          frame.stack.push(this.callFunction(func, positional, frame.scope, kwargs));
          break;
        }

        case OpCode.CALL_FUNCTION_EX: {
          // arg == 1 means there's a kwargs dict on top
          // Stack: [func, args_tuple] or [func, args_tuple, kwargs_dict]
          const kwargs: Record<string, PyValue> = {};
          if (arg === 1) {
            const kwDict = frame.stack.pop();
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
          const argsTuple = frame.stack.pop();
          const func = frame.stack.pop();
          const args = Array.isArray(argsTuple) ? argsTuple : (argsTuple ? Array.from(argsTuple) : []);
          frame.stack.push(this.callFunction(func, args, frame.scope, kwargs));
          break;
        }

        case OpCode.EVAL_AST: {
          const node = frame.stack.pop();
          frame.stack.push(this.evaluateExpression(node, frame.scope));
          break;
        }

        case OpCode.RETURN_VALUE:
          return frame.stack.pop();

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
