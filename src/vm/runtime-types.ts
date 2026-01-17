import * as fs from 'fs';
import { ByteCode } from '../types';

export type ScopeValue = any;

export class ReturnSignal {
  value: any;
  constructor(value: any) {
    this.value = value;
  }
}

export class BreakSignal { }
export class ContinueSignal { }

export class PyException extends Error {
  pyType: string;
  pyValue: any;
  constructor(pyType: string, message?: string, pyValue?: any) {
    super(message || pyType);
    this.pyType = pyType;
    this.pyValue = pyValue;
  }
}

export class Frame {
  public stack: any[] = [];
  public pc: number = 0;
  public scope: Scope;
  public bytecode: ByteCode;
  public locals: any[] = [];
  public blockStack: Array<{ handler: number; stackHeight: number }> = [];

  constructor(bytecode: ByteCode, scope: Scope) {
    this.bytecode = bytecode;
    this.scope = scope;
    this.locals = new Array((bytecode.varnames || []).length).fill(undefined);
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
      if (process.env.DEBUG_NONLOCAL) {
        console.log(`Setting nonlocal ${name} = ${value}`);
        console.log(`Found scope:`, scope.values.has(name), scope.values.get(name));
      }
      scope.values.set(name, value);
      return;
    }
    this.values.set(name, value);
  }

  root(): Scope {
    let scope: Scope = this;
    while (scope.parent) {
      scope = scope.parent;
    }
    return scope;
  }

  findScopeWith(name: string, skipBase: boolean = false): Scope | null {
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

export class PyFunction {
  name: string;
  params: any[];
  body: any[];
  closure: Scope;
  closure_shared_values?: Map<string, any>;
  isGenerator: boolean;
  bytecode?: any; // ByteCode
  localNames: Set<string>;

  constructor(
    name: string,
    params: any[],
    body: any[],
    closure: Scope,
    isGenerator: boolean,
    localNames: Set<string> = new Set(),
    bytecode?: any
  ) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.closure = closure;
    this.isGenerator = isGenerator;
    this.localNames = localNames;
    this.bytecode = bytecode;
  }
}

export class PyClass {
  name: string;
  bases: PyClass[];
  attributes: Map<string, any>;
  isException: boolean;

  constructor(name: string, bases: PyClass[], attributes: Map<string, any>, isException: boolean = false) {
    this.name = name;
    this.bases = bases;
    this.attributes = attributes;
    this.isException = isException;
  }
}

export class PyInstance {
  klass: PyClass;
  attributes: Map<string, any>;

  constructor(klass: PyClass) {
    this.klass = klass;
    this.attributes = new Map();
  }
}

export class PyGenerator {
  private iterator: Generator<any, any, any>;

  constructor(iterator: Generator<any, any, any>) {
    this.iterator = iterator;
  }

  next(value?: any) {
    const result = this.iterator.next(value === undefined ? null : value);
    if (result.done) {
      throw new PyException('StopIteration', 'StopIteration');
    }
    return result.value;
  }

  send(value?: any) {
    const result = this.iterator.next(value === undefined ? null : value);
    if (result.done) {
      throw new PyException('StopIteration', 'StopIteration');
    }
    return result.value;
  }

  throw(exc: any) {
    const it: any = this.iterator as any;
    if (exc instanceof PyClass && exc.isException) {
      exc = new PyInstance(exc);
    }
    if (typeof it.throw !== 'function') {
      throw new PyException('TypeError', 'object is not an iterator');
    }
    const result = it.throw(exc);
    if (result.done) {
      throw new PyException('StopIteration', 'StopIteration');
    }
    return result.value;
  }

  close() {
    const it: any = this.iterator as any;
    if (typeof it.return === 'function') {
      it.return(null);
    }
    return null;
  }

  [Symbol.iterator]() {
    return this.iterator;
  }
}

export type DictEntry = { key: any; value: any };

export class PyDict {
  private primitiveStore: Map<string, DictEntry> = new Map();
  private objectStore: Map<any, DictEntry> = new Map();

  get size(): number {
    return this.primitiveStore.size + this.objectStore.size;
  }

  set(key: any, value: any): this {
    const info = this.keyInfo(key);
    const existing = info.store.get(info.id);
    if (existing) {
      existing.value = value;
      return this;
    }
    info.store.set(info.id, { key, value });
    return this;
  }

  get(key: any): any {
    const info = this.keyInfo(key);
    const entry = info.store.get(info.id);
    return entry ? entry.value : undefined;
  }

  has(key: any): boolean {
    const info = this.keyInfo(key);
    return info.store.has(info.id);
  }

  delete(key: any): boolean {
    const info = this.keyInfo(key);
    return info.store.delete(info.id);
  }

  *entries(): IterableIterator<[any, any]> {
    for (const entry of this.primitiveStore.values()) {
      yield [entry.key, entry.value];
    }
    for (const entry of this.objectStore.values()) {
      yield [entry.key, entry.value];
    }
  }

  *keys(): IterableIterator<any> {
    for (const entry of this.primitiveStore.values()) {
      yield entry.key;
    }
    for (const entry of this.objectStore.values()) {
      yield entry.key;
    }
  }

  *values(): IterableIterator<any> {
    for (const entry of this.primitiveStore.values()) {
      yield entry.value;
    }
    for (const entry of this.objectStore.values()) {
      yield entry.value;
    }
  }

  [Symbol.iterator](): IterableIterator<any> {
    return this.keys();
  }

  private keyInfo(key: any): { store: Map<any, DictEntry>; id: any } {
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
    return { store: this.objectStore, id: key };
  }

  private normalizeNumericKey(key: any): number | bigint | null {
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
  private primitiveStore: Map<string, any> = new Map();
  private objectStore: Map<any, any> = new Map();

  constructor(iterable?: Iterable<any>) {
    if (iterable) {
      for (const item of iterable) {
        this.add(item);
      }
    }
  }

  get size(): number {
    return this.primitiveStore.size + this.objectStore.size;
  }

  add(value: any): this {
    const info = this.valueInfo(value);
    if (!info.store.has(info.id)) {
      info.store.set(info.id, value);
    }
    return this;
  }

  has(value: any): boolean {
    const info = this.valueInfo(value);
    return info.store.has(info.id);
  }

  delete(value: any): boolean {
    const info = this.valueInfo(value);
    return info.store.delete(info.id);
  }

  clear(): void {
    this.primitiveStore.clear();
    this.objectStore.clear();
  }

  *values(): IterableIterator<any> {
    for (const value of this.primitiveStore.values()) {
      yield value;
    }
    for (const value of this.objectStore.values()) {
      yield value;
    }
  }

  [Symbol.iterator](): IterableIterator<any> {
    return this.values();
  }

  private valueInfo(value: any): { store: Map<any, any>; id: any } {
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
    return { store: this.objectStore, id: value };
  }

  private normalizeNumeric(value: any): number | bigint | null {
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
