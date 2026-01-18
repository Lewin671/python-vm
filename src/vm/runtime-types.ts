import * as fs from 'fs';
import { ByteCode } from '../types';

/**
 * Represents any Python value in the VM.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PyValue = any;

export type ScopeValue = PyValue;

export class ReturnSignal {
  value: PyValue;
  constructor(value: PyValue) {
    this.value = value;
  }
}

export class BreakSignal { }
export class ContinueSignal { }

export class PyException extends Error {
  pyType: string;
  pyValue: PyValue;
  constructor(pyType: string, message?: string, pyValue?: PyValue) {
    super(message || pyType);
    this.pyType = pyType;
    this.pyValue = pyValue;
  }
}

export class Frame {
  public stack: PyValue[] = [];
  public pc: number = 0;
  public scope: Scope;
  public bytecode: ByteCode;
  public locals: PyValue[] = [];
  public blockStack: Array<{ handler: number; stackHeight: number }> = [];

  constructor(bytecode: ByteCode, scope: Scope) {
    this.bytecode = bytecode;
    this.scope = scope;
    this.locals = new Array((bytecode.varnames || []).length);
  }
}

export class Scope {
  values: Map<string, ScopeValue> = new Map();
  parent: Scope | null;
  globals: Set<string> = new Set();
  nonlocals: Set<string> = new Set();
  locals: Set<string> = new Set();
  isClassScope: boolean = false;

  constructor(parent: Scope | null = null, isClassScope: boolean = false) {
    this.parent = parent;
    this.isClassScope = isClassScope;
  }

  get(name: string): ScopeValue {
    if (this.values.has(name)) {
      return this.values.get(name);
    }
    if (this.locals.has(name)) {
      throw new PyException('UnboundLocalError', `local variable '${name}' referenced before assignment`);
    }

    if (this.nonlocals.has(name) && this.parent) {
      const scope = this.findScopeWith(name, true);
      // If we found a scope, return the actual reference from its Map
      if (scope) return scope.values.get(name);
    }

    let p: Scope | null = this.parent;
    while (p && p.isClassScope) {
      p = p.parent;
    }

    if (p) {
      return p.get(name);
    }
    throw new PyException('NameError', `name '${name}' is not defined`);
  }

  set(name: string, value: ScopeValue): void {
    if (this.globals.has(name) && this.parent) {
      this.root().values.set(name, value);
      return;
    }
    if (this.nonlocals.has(name) && this.parent) {
      const scope = this.findScopeWith(name, true);
      if (!scope) {
        throw new PyException('NameError', `no binding for nonlocal '${name}' found`);
      }
      // Debug: log the scope chain
      if (process.env['DEBUG_NONLOCAL']) {
        console.log(`Setting nonlocal ${name} = ${value}`);
        console.log(`Found scope:`, scope.values.has(name), scope.values.get(name));
      }
      scope.values.set(name, value);
      return;
    }
    this.values.set(name, value);
  }

  root(): Scope {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Scope = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  findScopeWith(name: string, skipBase: boolean = false): Scope | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let scope: Scope | null = skipBase ? this.parent : this;
    while (scope) {
      if (scope.isClassScope) {
        scope = scope.parent;
        continue;
      }
      if (scope.values.has(name)) return scope;
      if (scope.locals.has(name)) return scope;
      scope = scope.parent;
    }
    return null;
  }
}

export type FastCallInfo = {
  paramNames: string[];
  locals: Set<string>;
  globals: Set<string> | null;
  nonlocals: Set<string> | null;
  useDirectSet: boolean;
  argcount: number;
};

export class PyFunction {
  name: string;
  params: PyValue[];
  body: PyValue[];
  closure: Scope;
  closure_shared_values?: Map<string, PyValue>;
  isGenerator: boolean;
  bytecode?: ByteCode;
  localNames: Set<string>;
  fastCall?: FastCallInfo | null;

  constructor(
    name: string,
    params: PyValue[],
    body: PyValue[],
    closure: Scope,
    isGenerator: boolean,
    localNames: Set<string> = new Set(),
    bytecode?: ByteCode
  ) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.closure = closure;
    this.isGenerator = isGenerator;
    this.localNames = localNames;
    if (bytecode !== undefined) this.bytecode = bytecode;
  }
}

export class PyClass {
  name: string;
  bases: PyClass[];
  attributes: Map<string, PyValue>;
  isException: boolean;

  constructor(name: string, bases: PyClass[], attributes: Map<string, PyValue>, isException: boolean = false) {
    this.name = name;
    this.bases = bases;
    this.attributes = attributes;
    this.isException = isException;
  }
}

export class PyInstance {
  klass: PyClass;
  attributes: Map<string, PyValue>;

  constructor(klass: PyClass) {
    this.klass = klass;
    this.attributes = new Map();
  }
}

export class PyGenerator {
  private iterator: Generator<PyValue>;

  constructor(iterator: Generator<PyValue>) {
    this.iterator = iterator;
  }

  next(value?: PyValue) {
    const result = this.iterator.next(value === undefined ? null : value);
    if (result.done) {
      throw new PyException('StopIteration', 'StopIteration');
    }
    return result.value;
  }

  send(value?: PyValue) {
    const result = this.iterator.next(value === undefined ? null : value);
    if (result.done) {
      throw new PyException('StopIteration', 'StopIteration');
    }
    return result.value;
  }

  throw(exc: PyValue) {
    const it = this.iterator;
    if (exc instanceof PyClass && exc.isException) {
      exc = new PyInstance(exc);
    }
    if (typeof it.throw !== 'function') {
      throw new PyException('TypeError', 'object is not an iterator');
    }
    const result = (it as PyValue as { throw: (e: PyValue) => { done: boolean; value: PyValue } }).throw(exc);
    if (result.done) {
      throw new PyException('StopIteration', 'StopIteration');
    }
    return result.value;
  }

  close() {
    const it = this.iterator;
    if (typeof (it as PyValue as { return?: (v: PyValue) => void }).return === 'function') {
      (it as PyValue as { return: (v: PyValue) => void }).return(null);
    }
    return null;
  }

  [Symbol.iterator]() {
    return this.iterator;
  }
}

export class PyRange {
  start: number;
  end: number;
  step: number;
  length: number;

  constructor(start: number, end: number, step: number) {
    this.start = start;
    this.end = end;
    this.step = step;
    if (step > 0) {
      const span = end - start;
      this.length = span > 0 ? Math.ceil(span / step) : 0;
    } else {
      const span = start - end;
      this.length = span > 0 ? Math.ceil(span / -step) : 0;
    }
  }

  [Symbol.iterator](): Iterator<number | null> {
    return new PyRangeIterator(this.start, this.end, this.step);
  }
}

class PyRangeIterator {
  private current: number;
  private end: number;
  private step: number;

  constructor(start: number, end: number, step: number) {
    this.current = start;
    this.end = end;
    this.step = step;
  }

  next(): IteratorResult<number | null> {
    if (this.step > 0 ? this.current < this.end : this.current > this.end) {
      const value = this.current;
      this.current += this.step;
      return { value, done: false };
    }
    return { value: null, done: true };
  }

  [Symbol.iterator](): Iterator<number | null> {
    return this;
  }
}

export type DictEntry = { key: PyValue; value: PyValue };

export class PyDict {
  private primitiveStore: Map<string, DictEntry> = new Map();
  private objectStore: Map<PyValue, DictEntry> = new Map();

  get size(): number {
    return this.primitiveStore.size + this.objectStore.size;
  }

  set(key: PyValue, value: PyValue): this {
    const info = this.keyInfo(key);
    const existing = info.store.get(info.id);
    if (existing) {
      existing.value = value;
      return this;
    }
    info.store.set(info.id, { key, value });
    return this;
  }

  get(key: PyValue): PyValue {
    const info = this.keyInfo(key);
    const entry = info.store.get(info.id);
    return entry ? entry.value : undefined;
  }

  has(key: PyValue): boolean {
    const info = this.keyInfo(key);
    return info.store.has(info.id);
  }

  delete(key: PyValue): boolean {
    const info = this.keyInfo(key);
    return info.store.delete(info.id);
  }

  *entries(): IterableIterator<[PyValue, PyValue]> {
    for (const entry of this.primitiveStore.values()) {
      yield [entry.key, entry.value] as [PyValue, PyValue];
    }
    for (const entry of this.objectStore.values()) {
      yield [entry.key, entry.value] as [PyValue, PyValue];
    }
  }

  *keys(): IterableIterator<PyValue> {
    for (const entry of this.primitiveStore.values()) {
      yield entry.key;
    }
    for (const entry of this.objectStore.values()) {
      yield entry.key;
    }
  }

  *values(): IterableIterator<PyValue> {
    for (const entry of this.primitiveStore.values()) {
      yield entry.value;
    }
    for (const entry of this.objectStore.values()) {
      yield entry.value;
    }
  }

  [Symbol.iterator](): IterableIterator<PyValue> {
    return this.keys();
  }

  private keyInfo(key: PyValue): { store: Map<PyValue, DictEntry>; id: PyValue } {
    const numeric = this.normalizeNumericKey(key);
    if (numeric !== null) {
      if (typeof numeric === 'number' && Number.isNaN(numeric)) {
        return { store: this.objectStore, id: key };
      }
      return { store: this.primitiveStore, id: `n:${numeric.toString()}` };
    }
    if (typeof key === 'string') {
      return { store: this.primitiveStore, id: `s:${key}` };
    }
    if (key === null) {
      return { store: this.primitiveStore, id: 'none' };
    }
    if (key === undefined) {
      return { store: this.primitiveStore, id: 'undefined' };
    }
    return { store: this.objectStore as Map<PyValue, DictEntry>, id: key };
  }

  private normalizeNumericKey(key: PyValue): number | bigint | null {
    if (typeof key === 'boolean') return key ? 1n : 0n;
    if (typeof key === 'bigint') return key;
    if (typeof key === 'number' || key instanceof Number) {
      const v = key.valueOf();
      if (Number.isFinite(v) && Number.isInteger(v)) return BigInt(v);
      return v;
    }
    return null;
  }
}

export class PySet {
  private primitiveStore: Map<string, PyValue> = new Map();
  private objectStore: Map<PyValue, PyValue> = new Map();

  constructor(iterable?: Iterable<PyValue>) {
    if (iterable) {
      for (const item of iterable) {
        this.add(item);
      }
    }
  }

  get size(): number {
    return this.primitiveStore.size + this.objectStore.size;
  }

  add(value: PyValue): this {
    const info = this.valueInfo(value);
    if (!info.store.has(info.id)) {
      info.store.set(info.id, value);
    }
    return this;
  }

  has(value: PyValue): boolean {
    const info = this.valueInfo(value);
    return info.store.has(info.id);
  }

  delete(value: PyValue): boolean {
    const info = this.valueInfo(value);
    return info.store.delete(info.id);
  }

  clear(): void {
    this.primitiveStore.clear();
    this.objectStore.clear();
  }

  *values(): IterableIterator<PyValue> {
    for (const value of this.primitiveStore.values()) {
      yield value;
    }
    for (const value of this.objectStore.values()) {
      yield value;
    }
  }

  [Symbol.iterator](): IterableIterator<PyValue> {
    return this.values();
  }

  private valueInfo(value: PyValue): { store: Map<PyValue, PyValue>; id: PyValue } {
    const numeric = this.normalizeNumeric(value);
    if (numeric !== null) {
      if (typeof numeric === 'number' && Number.isNaN(numeric)) {
        return { store: this.objectStore, id: value };
      }
      return { store: this.primitiveStore, id: `n:${numeric.toString()}` };
    }
    if (typeof value === 'string') {
      return { store: this.primitiveStore, id: `s:${value}` };
    }
    if (value === null) {
      return { store: this.primitiveStore, id: 'none' };
    }
    if (value === undefined) {
      return { store: this.primitiveStore, id: 'undefined' };
    }
    return { store: this.objectStore as Map<PyValue, PyValue>, id: value };
  }

  private normalizeNumeric(value: PyValue): number | bigint | null {
    if (typeof value === 'boolean') return value ? 1n : 0n;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' || value instanceof Number) {
      const v = value.valueOf();
      if (Number.isFinite(v) && Number.isInteger(v)) return BigInt(v);
      return v;
    }
    return null;
  }
}

export class PyFile {
  path: string;
  mode: string;
  handle: number | null;

  constructor(path: string, mode: string) {
    this.path = path;
    this.mode = mode;
    this.handle = null;
  }

  open() {
    if (this.handle !== null) return;
    if (this.mode.includes('w')) {
      this.handle = fs.openSync(this.path, 'w');
    } else if (this.mode.includes('r')) {
      this.handle = fs.openSync(this.path, 'r');
    } else {
      this.handle = fs.openSync(this.path, 'r');
    }
  }

  write(data: string) {
    this.open();
    if (this.handle === null) return;
    fs.writeSync(this.handle, data);
  }

  read(): string {
    if (this.mode.includes('r')) {
      return fs.readFileSync(this.path, 'utf8');
    }
    return '';
  }

  close() {
    if (this.handle !== null) {
      fs.closeSync(this.handle);
      this.handle = null;
    }
  }

  __enter__() {
    this.open();
    return this;
  }

  __exit__() {
    this.close();
    return false;
  }
}
