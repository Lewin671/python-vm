import type { VirtualMachine } from './vm';
import { PyValue, PyDict, PyException, PyInstance, PySet, Scope } from './runtime-types';
import { isNumericLike, toNumber } from './value-utils';

export function isTruthy(this: VirtualMachine, value: PyValue, scope: Scope): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Number) return value.valueOf() !== 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof PyDict) return value.size > 0;
  if (value instanceof PySet) return value.size > 0;
  if (value instanceof PyInstance) {
    const boolAttr = this.findClassAttribute(value.klass, '__bool__');
    if (boolAttr !== undefined) {
      const bound = this.getAttribute(value, '__bool__', scope);
      const result = typeof bound === 'function' ? bound() : bound;
      if (typeof result !== 'boolean') {
        throw new PyException('TypeError', '__bool__ should return bool');
      }
      return result;
    }
    const lenAttr = this.findClassAttribute(value.klass, '__len__');
    if (lenAttr !== undefined) {
      const bound = this.getAttribute(value, '__len__', scope);
      const result = typeof bound === 'function' ? bound() : bound;
      if (!isNumericLike(result)) {
        throw new PyException('TypeError', '__len__ should return int');
      }
      return toNumber(result) !== 0;
    }
  }
  return true;
}
