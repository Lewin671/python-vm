import type { VirtualMachine } from './vm';
import { PyValue, PyClass, PyDict, PyException, PyFile, PyGenerator, PyInstance, PySet, Scope } from './runtime-types';
import { isFloatLike, isNumericLike, pyStr, pyTypeName, toBigIntValue, toNumber } from './value-utils';

export function installBuiltins(this: VirtualMachine, scope: Scope) {
  const builtins = new Map<string, PyValue>();
  builtins.set('print', (...args: PyValue[]) => {
    let sep = ' ';
    let end = '\n';
    if (args.length > 0) {
      const last = args[args.length - 1];
      if (last && last.__kwargs__) {
        const kwargs = last.__kwargs__;
        sep = kwargs.sep !== undefined ? kwargs.sep : sep;
        end = kwargs.end !== undefined ? kwargs.end : end;
        args = args.slice(0, -1);
      }
    }
    const output = args.map((a) => pyStr(a)).join(sep) + end;
    process.stdout.write(output);
    return null;
  });
  builtins.set('len', (value: PyValue) => {
    if (typeof value === 'string' || Array.isArray(value)) return value.length;
    if (value instanceof PyDict || value instanceof PySet) return value.size;
    throw new PyException('TypeError', 'object has no len()');
  });
  builtins.set('range', (...args: PyValue[]) => {
    let start = 0;
    let end = 0;
    let step = 1;
    if (args.length === 1) {
      end = toNumber(args[0]);
    } else if (args.length === 2) {
      start = toNumber(args[0]);
      end = toNumber(args[1]);
    } else if (args.length >= 3) {
      start = toNumber(args[0]);
      end = toNumber(args[1]);
      step = toNumber(args[2]);
    }
    if (step === 0) throw new PyException('ValueError', 'range() arg 3 must not be zero');
    
    // Pre-compute size and pre-allocate array for better performance
    const size = step > 0 
      ? Math.max(0, Math.ceil((end - start) / step))
      : Math.max(0, Math.ceil((start - end) / (-step)));
    
    const result = new Array(size);
    if (step > 0) {
      for (let idx = 0, i = start; idx < size; idx++, i += step) {
        result[idx] = i;
      }
    } else {
      for (let idx = 0, i = start; idx < size; idx++, i += step) {
        result[idx] = i;
      }
    }
    return result;
  });
  const listFn = (value: PyValue) => {
    if (Array.isArray(value)) return [...value];
    if (value instanceof PySet) return Array.from(value.values());
    if (value && typeof value[Symbol.iterator] === 'function') return Array.from(value);
    return [];
  };
  (listFn as PyValue).__typeName__ = 'list';
  builtins.set('list', listFn);
  const tupleFn = (value: PyValue) => {
    const arr = Array.isArray(value) ? [...value] : value && typeof value[Symbol.iterator] === 'function' ? Array.from(value) : [];
    (arr as PyValue).__tuple__ = true;
    return arr;
  };
  (tupleFn as PyValue).__typeName__ = 'tuple';
  builtins.set('tuple', tupleFn);
  const setFn = (value: PyValue) => {
    if (value instanceof PySet) return new PySet(value);
    if (Array.isArray(value)) return new PySet(value);
    if (value && typeof value[Symbol.iterator] === 'function') return new PySet(Array.from(value));
    return new PySet();
  };
  (setFn as PyValue).__typeName__ = 'set';
  builtins.set('set', setFn);
  builtins.set('sum', (value: PyValue[]) => {
    const len = value.length;
    if (len === 0) return 0;
    
    // Fast path: check first element type and assume homogeneous array
    const first = value[0];
    if (typeof first === 'bigint') {
      let sum = 0n;
      for (let i = 0; i < len; i++) {
        sum += toBigIntValue(value[i]);
      }
      return sum;
    }
    
    // Fast path for numbers (most common case)
    if (typeof first === 'number') {
      let sum = 0;
      for (let i = 0; i < len; i++) {
        sum += value[i];
      }
      return sum;
    }
    
    // Fallback for mixed types
    if (value.some((v) => typeof v === 'bigint')) {
      return value.reduce((acc, v) => acc + toBigIntValue(v), 0n);
    }
    return value.reduce((acc, v) => acc + v, 0);
  });
  builtins.set('max', (...args: PyValue[]) => {
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (values.every((v: PyValue) => isNumericLike(v) && !isFloatLike(v))) {
      return values.reduce((acc: PyValue, v: PyValue) => (toBigIntValue(v) > toBigIntValue(acc) ? v : acc));
    }
    return Math.max(...values.map((v: PyValue) => toNumber(v)));
  });
  builtins.set('min', (...args: PyValue[]) => {
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (values.every((v: PyValue) => isNumericLike(v) && !isFloatLike(v))) {
      return values.reduce((acc: PyValue, v: PyValue) => (toBigIntValue(v) < toBigIntValue(acc) ? v : acc));
    }
    return Math.min(...values.map((v: PyValue) => toNumber(v)));
  });
  builtins.set('abs', (value: PyValue) => {
    if (typeof value === 'bigint') return value < 0n ? -value : value;
    return Math.abs(toNumber(value));
  });
  const roundHalfToEven = (input: number) => {
    const floored = Math.floor(input);
    const diff = input - floored;
    const epsilon = 1e-12;
    if (diff > 0.5 + epsilon) return floored + 1;
    if (diff < 0.5 - epsilon) return floored;
    return floored % 2 === 0 ? floored : floored + 1;
  };
  builtins.set('round', (value: number, digits?: number) => {
    if (digits === undefined) return roundHalfToEven(value);
    const factor = Math.pow(10, digits);
    return roundHalfToEven(value * factor) / factor;
  });
  const intFn = (value: PyValue) => {
    if (typeof value === 'bigint') return value;
    const text = typeof value === 'string' ? value.trim() : null;
    if (text && /^[-+]?\\d+$/.test(text)) {
      const big = BigInt(text);
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
      if (big > maxSafe || big < minSafe) {
        return big;
      }
    }
    const result = parseInt(value, 10);
    if (Number.isNaN(result)) throw new PyException('ValueError', 'Invalid integer');
    const boxed = new Number(result);
    (boxed as PyValue).__int__ = true;
    return boxed;
  };
  (intFn as PyValue).__typeName__ = 'int';
  builtins.set('int', intFn);
  const floatFn = (value?: PyValue) => {
    if (value === undefined) return new Number(0);
    if (value instanceof Number) return new Number(value.valueOf());
    if (typeof value === 'number') return new Number(value);
    if (typeof value === 'boolean') return new Number(value ? 1 : 0);
    if (typeof value === 'string') {
      const text = value.trim();
      if (text.length === 0) throw new PyException('ValueError', 'Invalid float');
      const lower = text.toLowerCase();
      if (lower === 'nan' || lower === '+nan' || lower === '-nan') return new Number(NaN);
      if (lower === 'inf' || lower === '+inf' || lower === 'infinity' || lower === '+infinity') return new Number(Infinity);
      if (lower === '-inf' || lower === '-infinity') return new Number(-Infinity);
      const result = parseFloat(text);
      if (Number.isNaN(result)) throw new PyException('ValueError', 'Invalid float');
      return new Number(result);
    }
    const result = parseFloat(value);
    if (Number.isNaN(result)) throw new PyException('ValueError', 'Invalid float');
    return new Number(result);
  };
  (floatFn as PyValue).__typeName__ = 'float';
  builtins.set('float', floatFn);
  const strFn = (value: PyValue) => pyStr(value);
  (strFn as PyValue).__typeName__ = 'str';
  builtins.set('str', strFn);
  const boolFn = (value: PyValue) => this.isTruthy(value, scope);
  (boolFn as PyValue).__typeName__ = 'bool';
  builtins.set('bool', boolFn);
  builtins.set('type', (value: PyValue) => ({ __typeName__: pyTypeName(value) }));
  const isSubclass = (klass: PyClass, target: PyClass): boolean => {
    if (klass === target) return true;
    return klass.bases.some((base) => isSubclass(base, target));
  };
  builtins.set('isinstance', (value: PyValue, typeObj: PyValue) => {
    if (typeObj instanceof PyClass) {
      if (value instanceof PyInstance) return isSubclass(value.klass, typeObj);
      return false;
    }
    if (typeObj && typeObj.__typeName__) {
      return pyTypeName(value) === typeObj.__typeName__;
    }
    return false;
  });
  builtins.set('enumerate', (iterable: PyValue) => {
    const arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
    return arr.map((v, i) => {
      const tup = [i, v];
      (tup as PyValue).__tuple__ = true;
      return tup;
    });
  });
  builtins.set('zip', (...iterables: PyValue[]) => {
    const arrays = iterables.map((it) => (Array.isArray(it) ? it : Array.from(it)));
    const length = Math.min(...arrays.map((a) => a.length));
    const result: PyValue[] = [];
    for (let i = 0; i < length; i++) {
      const tup = arrays.map((a) => a[i]);
      (tup as PyValue).__tuple__ = true;
      result.push(tup);
    }
    return result;
  });
  builtins.set('sorted', (iterable: PyValue) => {
    const arr = Array.isArray(iterable) ? [...iterable] : Array.from(iterable);
    if (arr.every((v) => isNumericLike(v))) {
      return arr.sort((a, b) => toNumber(a) - toNumber(b));
    }
    return arr.sort();
  });
  builtins.set('reversed', (iterable: PyValue) => {
    const arr = Array.isArray(iterable) ? [...iterable] : Array.from(iterable);
    return arr.reverse();
  });
  builtins.set('map', (fn: PyValue, iterable: PyValue) => {
    const arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
    return arr.map((value) => this.callFunction(fn, [value], scope));
  });
  builtins.set('filter', (fn: PyValue, iterable: PyValue) => {
    const arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
    return arr.filter((value) => this.isTruthy(this.callFunction(fn, [value], scope), scope));
  });
  builtins.set('next', (iterable: PyValue) => {
    if (iterable instanceof PyGenerator) {
      return iterable.next();
    }
    if (iterable && typeof iterable.next === 'function') {
      const result = iterable.next();
      if (result.done) throw new PyException('StopIteration', 'StopIteration');
      return result.value;
    }
    throw new PyException('TypeError', 'object is not an iterator');
  });
  builtins.set('open', (path: PyValue, mode: PyValue = 'r') => {
    const file = new PyFile(String(path), String(mode));
    try {
      file.open();
    } catch (err) {
      throw new PyException('FileNotFoundError', 'File not found');
    }
    return file;
  });
  const exceptionClass = (name: string, base?: PyClass) => {
    const klass = new PyClass(name, base ? [base] : [], new Map(), true);
    return klass;
  };

  const ExceptionBase = exceptionClass('Exception');
  builtins.set('Exception', ExceptionBase);
  builtins.set('AssertionError', exceptionClass('AssertionError', ExceptionBase));
  builtins.set('AttributeError', exceptionClass('AttributeError', ExceptionBase));
  const NameErrorBase = exceptionClass('NameError', ExceptionBase);
  builtins.set('NameError', NameErrorBase);
  builtins.set('UnboundLocalError', exceptionClass('UnboundLocalError', NameErrorBase));
  builtins.set('ZeroDivisionError', exceptionClass('ZeroDivisionError', ExceptionBase));
  builtins.set('ValueError', exceptionClass('ValueError', ExceptionBase));
  builtins.set('TypeError', exceptionClass('TypeError', ExceptionBase));
  builtins.set('FileNotFoundError', exceptionClass('FileNotFoundError', ExceptionBase));
  builtins.set('StopIteration', exceptionClass('StopIteration', ExceptionBase));

  scope.values = new Map([...builtins.entries()]);
  // console.log('Installed builtins:', Array.from(scope.values.keys()));
}
