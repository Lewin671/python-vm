import type { VirtualMachine } from './vm';
import { ASTNodeType } from '../types';
import { PyValue, PyClass, PyDict, PyException, PyFile, PyFunction, PyGenerator, PyInstance, PySet, Scope } from './runtime-types';
import {
  bigIntFloorDiv,
  isComplex,
  isFloatLike,
  isIntLike,
  isNumericLike,
  pythonModulo,
  shouldUseBigInt,
  toBigIntValue,
  toComplex,
  toNumber,
  pyStr,
} from './value-utils';

export function applyInPlaceBinary(this: VirtualMachine, op: string, left: PyValue, right: PyValue): PyValue {
  if (op === '+' && Array.isArray(left) && !(left as PyValue).__tuple__ && Array.isArray(right)) {
    left.push(...right);
    return left;
  }
  return this.applyBinary(op, left, right);
}

export function applyBinary(this: VirtualMachine, op: string, left: PyValue, right: PyValue): PyValue {
  if (isComplex(left) || isComplex(right)) {
    const a = toComplex(left);
    const b = toComplex(right);
    switch (op) {
      case '+':
        return { __complex__: true, re: a.re + b.re, im: a.im + b.im };
      case '-':
        return { __complex__: true, re: a.re - b.re, im: a.im - b.im };
      case '*':
        return {
          __complex__: true,
          re: a.re * b.re - a.im * b.im,
          im: a.re * b.im + a.im * b.re,
        };
      default:
        throw new PyException('TypeError', `unsupported complex operator ${op}`);
    }
  }
  switch (op) {
    case '+':
      if (Array.isArray(left) && Array.isArray(right)) {
        const result = [...left, ...right];
        if ((left as PyValue).__tuple__ && (right as PyValue).__tuple__) {
          (result as PyValue).__tuple__ = true;
        }
        return result;
      }
      if (isFloatLike(left) || isFloatLike(right)) {
        return new Number(toNumber(left) + toNumber(right));
      }
      if (shouldUseBigInt(left, right)) {
        return toBigIntValue(left) + toBigIntValue(right);
      }
      return left + right;
    case '-':
      if (left instanceof PySet && right instanceof PySet) {
        const result = new PySet(left);
        for (const item of right.values()) result.delete(item);
        return result;
      }
      if (isFloatLike(left) || isFloatLike(right)) {
        return new Number(toNumber(left) - toNumber(right));
      }
      if (shouldUseBigInt(left, right)) {
        return toBigIntValue(left) - toBigIntValue(right);
      }
      return left - right;
    case '*':
      if (typeof left === 'string' && isIntLike(right)) {
        const count = toNumber(right);
        if (count <= 0) return '';
        return left.repeat(count);
      }
      if (typeof right === 'string' && isIntLike(left)) {
        const count = toNumber(left);
        if (count <= 0) return '';
        return right.repeat(count);
      }
      if (Array.isArray(left) && isIntLike(right)) {
        const count = toNumber(right);
        if (count <= 0) {
          const result: PyValue[] = [];
          if ((left as PyValue).__tuple__) {
            (result as PyValue).__tuple__ = true;
          }
          return result;
        }
        const result = Array(count).fill(null).flatMap(() => left);
        if ((left as PyValue).__tuple__) {
          (result as PyValue).__tuple__ = true;
        }
        return result;
      }
      if (isFloatLike(left) || isFloatLike(right)) {
        return new Number(toNumber(left) * toNumber(right));
      }
      if (shouldUseBigInt(left, right)) {
        return toBigIntValue(left) * toBigIntValue(right);
      }
      return left * right;
    case '/':
      if (right === 0 || right === 0n) throw new PyException('ZeroDivisionError', 'division by zero');
      return new Number(toNumber(left) / toNumber(right));
    case '//':
      if (right === 0 || right === 0n) throw new PyException('ZeroDivisionError', 'division by zero');
      if (isFloatLike(left) || isFloatLike(right)) {
        return new Number(Math.floor(toNumber(left) / toNumber(right)));
      }
      if (shouldUseBigInt(left, right)) {
        return bigIntFloorDiv(toBigIntValue(left), toBigIntValue(right));
      }
      return Math.floor(left / right);
    case '%':
      if (typeof left === 'string') {
        return this.formatPercent(left, right);
      }
      return pythonModulo(left, right);
    case '**':
      if (isIntLike(left) && isIntLike(right) && !isFloatLike(left) && !isFloatLike(right)) {
        const exponentNum = toNumber(right);
        if (Number.isInteger(exponentNum) && exponentNum >= 0) {
          const approx = Math.pow(toNumber(left), exponentNum);
          if (shouldUseBigInt(left, right) || !Number.isSafeInteger(approx)) {
            return toBigIntValue(left) ** toBigIntValue(right);
          }
        }
      }
      if (shouldUseBigInt(left, right)) {
        const exponent = toBigIntValue(right);
        if (exponent < 0n) {
          return new Number(Math.pow(toNumber(left), toNumber(right)));
        }
        return toBigIntValue(left) ** exponent;
      }
      return Math.pow(toNumber(left), toNumber(right));
    case '&':
      if (left instanceof PySet && right instanceof PySet) {
        const result = new PySet();
        for (const item of left.values()) {
          if (right.has(item)) result.add(item);
        }
        return result;
      }
      if (shouldUseBigInt(left, right)) {
        return toBigIntValue(left) & toBigIntValue(right);
      }
      return left & right;
    case '|':
      if (left instanceof PySet && right instanceof PySet) {
        const result = new PySet(left);
        for (const item of right.values()) result.add(item);
        return result;
      }
      if (shouldUseBigInt(left, right)) {
        return toBigIntValue(left) | toBigIntValue(right);
      }
      return left | right;
    case '^':
      if (left instanceof PySet && right instanceof PySet) {
        const result = new PySet();
        for (const item of left.values()) {
          if (!right.has(item)) result.add(item);
        }
        for (const item of right.values()) {
          if (!left.has(item)) result.add(item);
        }
        return result;
      }
      if (shouldUseBigInt(left, right)) {
        return toBigIntValue(left) ^ toBigIntValue(right);
      }
      return left ^ right;
    case '<<':
      if (shouldUseBigInt(left, right)) {
        return toBigIntValue(left) << toBigIntValue(right);
      }
      return left << right;
    case '>>':
      if (shouldUseBigInt(left, right)) {
        return toBigIntValue(left) >> toBigIntValue(right);
      }
      return left >> right;
    default:
      throw new PyException('TypeError', `unsupported operator ${op}`);
  }
}

export function formatPercent(this: VirtualMachine, format: string, value: PyValue): string {
  const values = Array.isArray(value) ? value : [value];
  let index = 0;
  return format.replace(/%[sdfo]/g, (match) => {
    const val = values[index++];
    if (match === '%d') return typeof val === 'bigint' ? val.toString() : String(parseInt(val, 10));
    if (match === '%f') return String(parseFloat(val));
    return String(val);
  });
}

export function getSubscript(this: VirtualMachine, obj: PyValue, index: PyValue): PyValue {
  // Check if index is a slice object (created by BUILD_SLICE opcode or AST node)
  if (index && (index.type === ASTNodeType.SLICE || index.__slice__)) {
    const start = index.start !== undefined ? index.start : null;
    const end = index.end !== undefined ? index.end : null;
    const step = index.step !== undefined ? index.step : 1;
    const indices = this.computeSliceIndices(obj.length, start, end, step);
    const result: PyValue[] = [];
    for (const idx of indices) result.push(obj[idx]);
    if (typeof obj === 'string') return result.join('');
    if (Array.isArray(obj) && (obj as PyValue).__tuple__) {
      (result as PyValue).__tuple__ = true;
    }
    return result;
  }
  if (Array.isArray(obj) || typeof obj === 'string') {
    let idx = index;
    if (isIntLike(idx) && toNumber(idx) < 0) {
      idx = obj.length + toNumber(idx);
    }
    if (isIntLike(idx)) {
      idx = toNumber(idx);
    }
    return obj[idx];
  }
  if (obj instanceof PyDict) {
    return obj.get(index);
  }
  return null;
}

export function computeSliceBounds(this: VirtualMachine, length: number, start: PyValue, end: PyValue, step: PyValue) {
  const stepValue = this.normalizeSliceStep(step);
  const startProvided = start !== null && start !== undefined;
  const endProvided = end !== null && end !== undefined;
  let startValue = startProvided ? toNumber(start) : null;
  let endValue = endProvided ? toNumber(end) : null;
  if (startValue === null) startValue = stepValue < 0 ? length - 1 : 0;
  if (endValue === null) endValue = stepValue < 0 ? -1 : length;
  if (startProvided && startValue < 0) startValue = length + startValue;
  if (endProvided && endValue < 0) endValue = length + endValue;
  return { start: startValue, end: endValue, step: stepValue };
}

export function computeSliceIndices(this: VirtualMachine, length: number, start: PyValue, end: PyValue, step: PyValue) {
  const bounds = this.computeSliceBounds(length, start, end, step);
  const indices: number[] = [];
  for (let i = bounds.start; bounds.step > 0 ? i < bounds.end : i > bounds.end; i += bounds.step) {
    indices.push(i);
  }
  return indices;
}

export function normalizeSliceStep(step: PyValue) {
  const stepValue = step !== null && step !== undefined ? toNumber(step) : 1;
  if (stepValue === 0) {
    throw new PyException('ValueError', 'slice step cannot be zero');
  }
  return stepValue;
}

export function getAttribute(this: VirtualMachine, obj: PyValue, name: string, scope: Scope): PyValue {
  // Fast path for most common cases first
  if (Array.isArray(obj)) {
    // Pre-bound methods for arrays to avoid closure creation overhead
    switch (name) {
      case 'append': {
        // Use a cached bound method when possible
        const objAny = obj as PyValue;
        let method = objAny.__append_method__;
        if (!method) {
          method = (value: PyValue) => { obj.push(value); return null; };
          objAny.__append_method__ = method;
        }
        return method;
      }
      case 'pop': return (index?: number) => {
        if (index === undefined) return obj.pop();
        return obj.splice(index, 1)[0];
      };
      case 'extend': return (iterable: PyValue) => {
        const arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
        obj.push(...arr);
        return null;
      };
      case 'count': return (value: PyValue) => {
        let count = 0;
        for (let i = 0; i < obj.length; i++) {
          if (obj[i] === value) count++;
        }
        return count;
      };
      case 'index': return (value: PyValue) => obj.indexOf(value);
      case 'sort': {
        return (...args: PyValue[]) => {
          let kwargs: Record<string, PyValue> = {};
          if (args.length > 0) {
            const last = args[args.length - 1];
            if (last && last.__kwargs__) {
              kwargs = last.__kwargs__;
              args = args.slice(0, -1);
            }
          }
          let keyFn = args.length > 0 ? args[0] : null;
          if ('key' in kwargs) keyFn = kwargs['key'];
          const reverse = 'reverse' in kwargs ? Boolean(kwargs['reverse']) : false;

          const initialLength = obj.length;
          if (keyFn) {
            const keyed = [];
            for (let i = 0; i < initialLength; i++) {
              const item = obj[i];
              const key = this.callFunction(keyFn, [item], scope);
              if (obj.length !== initialLength) {
                throw new PyException('ValueError', 'list modified during sort');
              }
              keyed.push({ item, key });
            }
            keyed.sort((a, b) => {
              if (isNumericLike(a.key) && isNumericLike(b.key)) {
                return toNumber(a.key) - toNumber(b.key);
              }
              return String(a.key).localeCompare(String(b.key));
            });
            if (obj.length !== initialLength) {
              throw new PyException('ValueError', 'list modified during sort');
            }
            obj.length = 0;
            obj.push(...keyed.map((entry) => entry.item));
          } else if (obj.every((value: PyValue) => isNumericLike(value))) {
            obj.sort((a: PyValue, b: PyValue) => toNumber(a) - toNumber(b));
            if (obj.length !== initialLength) {
              throw new PyException('ValueError', 'list modified during sort');
            }
          } else {
            obj.sort();
            if (obj.length !== initialLength) {
              throw new PyException('ValueError', 'list modified during sort');
            }
          }
          if (reverse) obj.reverse();
          return null;
        };
      }
    }
  }
  
  if (typeof obj === 'string') {
    switch (name) {
      case 'upper': return () => obj.toUpperCase();
      case 'lower': return () => obj.toLowerCase();
      case 'strip': return () => obj.trim();
      case 'startswith': return (prefix: string) => obj.startsWith(prefix);
      case 'endswith': return (suffix: string) => obj.endsWith(suffix);
      case 'split': return (sep: string = ' ') => obj.split(sep);
      case 'count': return (ch: PyValue) => obj.split(ch).length - 1;
      case 'join': return (iterable: PyValue) => {
        const arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
        return arr.map(item => pyStr(item)).join(obj);
      };
      case 'replace': return (a: PyValue, b: PyValue) => obj.replace(a, b);
      case 'format': return (...args: PyValue[]) => {
        let kwargs: Record<string, PyValue> = {};
        if (args.length > 0) {
          const last = args[args.length - 1];
          if (last && last.__kwargs__) {
            kwargs = last.__kwargs__;
            args = args.slice(0, -1);
          }
        }
        let autoIndex = 0;
        return obj.replace(/\{([^{}]*)\}/g, (_match, key) => {
          if (key === '') {
            const value = args[autoIndex++];
            return pyStr(value);
          }
          if (/^\d+$/.test(key)) {
            const value = args[parseInt(key, 10)];
            return pyStr(value);
          }
          if (key in kwargs) {
            return pyStr(kwargs[key]);
          }
          return '';
        });
      };
    }
  }
  
  if (obj && obj.__moduleScope__) {
    if (obj.__moduleScope__.values.has(name)) {
      return obj.__moduleScope__.values.get(name);
    }
  }
  if (obj instanceof PyInstance) {
    if (obj.attributes.has(name)) return obj.attributes.get(name);
    const attr = this.findClassAttribute(obj.klass, name);
    if (attr instanceof PyFunction) {
      return (...args: PyValue[]) => this.callFunction(attr, [obj, ...args], scope);
    }
    return attr;
  }
  if (obj instanceof PyClass) {
    const attr = this.findClassAttribute(obj, name);
    return attr;
  }
  if (obj instanceof PyFile) {
    const value = (obj as PyValue)[name];
    if (typeof value === 'function') return value.bind(obj);
    return value;
  }
  if (obj instanceof PyGenerator) {
    const value = (obj as PyValue)[name];
    if (typeof value === 'function') return value.bind(obj);
    return value;
  }
  if (isComplex(obj)) {
    if (name === 'real') return new Number(obj.re);
    if (name === 'imag') return new Number(obj.im);
  }
  if (obj instanceof PyDict) {
    if (name === 'items')
      return () =>
        Array.from(obj.entries()).map(([k, v]) => {
          const tup = [k, v];
          (tup as PyValue).__tuple__ = true;
          return tup;
        });
    const value = (obj as PyValue)[name];
    if (typeof value === 'function') return value.bind(obj);
    return value;
  }
  if (obj instanceof PySet) {
    if (name === 'add')
      return (value: PyValue) => {
        obj.add(value);
        return null;
      };
    if (name === 'update')
      return (values: PyValue) => {
        const items = Array.isArray(values) ? values : Array.from(values);
        for (const item of items) obj.add(item);
        return null;
      };
    if (name === 'remove')
      return (value: PyValue) => {
        obj.delete(value);
        return null;
      };
  }
  if (obj && typeof obj === 'object' && obj.__typeName__) {
    if (name === '__name__') return obj.__typeName__;
  }
  if (obj && obj.__typeName__ === undefined && name === '__name__') {
    return obj.name;
  }
  return (obj as PyValue)[name];
}

export function setAttribute(this: VirtualMachine, obj: PyValue, name: string, value: PyValue) {
  if (obj && obj.__moduleScope__) {
    obj.__moduleScope__.values.set(name, value);
    return;
  }
  if (obj instanceof PyInstance) {
    obj.attributes.set(name, value);
    return;
  }
  (obj as PyValue)[name] = value;
}

export function findClassAttribute(klass: PyClass, name: string): PyValue {
  if (klass.attributes.has(name)) return klass.attributes.get(name);
  for (const base of klass.bases) {
    const attr = findClassAttribute(base, name);
    if (attr !== undefined) return attr;
  }
  return undefined;
}