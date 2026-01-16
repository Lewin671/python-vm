import { ByteCode, ASTNodeType } from '../types';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import * as fs from 'fs';

type ScopeValue = any;

class ReturnSignal {
  value: any;
  constructor(value: any) {
    this.value = value;
  }
}

class BreakSignal {}
class ContinueSignal {}

class PyException extends Error {
  pyType: string;
  pyValue: any;
  constructor(pyType: string, message?: string, pyValue?: any) {
    super(message || pyType);
    this.pyType = pyType;
    this.pyValue = pyValue;
  }
}

class Scope {
  values: Map<string, ScopeValue> = new Map();
  parent: Scope | null;
  globals: Set<string> = new Set();
  nonlocals: Set<string> = new Set();

  constructor(parent: Scope | null = null) {
    this.parent = parent;
  }

  get(name: string): ScopeValue {
    if (this.values.has(name)) {
      return this.values.get(name);
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    throw new PyException('NameError', `name '${name}' is not defined`);
  }

  set(name: string, value: ScopeValue): void {
    if (this.globals.has(name) && this.parent) {
      this.root().values.set(name, value);
      return;
    }
    if (this.nonlocals.has(name) && this.parent) {
      const scope = this.parent.findScopeWith(name);
      if (!scope) {
        throw new PyException('NameError', `no binding for nonlocal '${name}' found`);
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

  findScopeWith(name: string): Scope | null {
    let scope: Scope | null = this;
    while (scope) {
      if (scope.values.has(name)) return scope;
      scope = scope.parent;
    }
    return null;
  }
}

class PyFunction {
  name: string;
  params: any[];
  body: any[];
  closure: Scope;
  isGenerator: boolean;

  constructor(name: string, params: any[], body: any[], closure: Scope, isGenerator: boolean) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.closure = closure;
    this.isGenerator = isGenerator;
  }
}

class PyClass {
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

class PyInstance {
  klass: PyClass;
  attributes: Map<string, any>;

  constructor(klass: PyClass) {
    this.klass = klass;
    this.attributes = new Map();
  }
}

class PyGenerator {
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

  [Symbol.iterator]() {
    return this.iterator;
  }
}

type DictEntry = { key: any; value: any };

class PyDict {
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

  [Symbol.iterator](): IterableIterator<[any, any]> {
    return this.entries();
  }

  private keyInfo(key: any): { store: Map<any, DictEntry>; id: any } {
    const numeric = this.normalizeNumericKey(key);
    if (numeric !== null) {
      return { store: this.primitiveStore, id: `n:${String(numeric)}` };
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

  private normalizeNumericKey(key: any): number | null {
    if (typeof key === 'boolean') return key ? 1 : 0;
    if (typeof key === 'number') return key;
    if (key instanceof Number) return key.valueOf();
    return null;
  }
}

class PyFile {
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

const isTruthy = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (value instanceof Number) return value.valueOf() !== 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof PyDict) return value.size > 0;
  if (value instanceof Set) return value.size > 0;
  return true;
};

const isPyNone = (value: any) => value === null;

const pyTypeName = (value: any): string => {
  if (value === null) return 'NoneType';
  if (value instanceof Number) return 'float';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'str';
  if (Array.isArray(value)) return (value as any).__tuple__ ? 'tuple' : 'list';
  if (value instanceof Set) return 'set';
  if (value instanceof PyDict) return 'dict';
  if (value instanceof PyFunction) return 'function';
  if (value instanceof PyClass) return 'type';
  if (value instanceof PyInstance) return value.klass.name;
  return typeof value;
};

const pyRepr = (value: any): string => {
  if (value === null) return 'None';
  if (value instanceof Number) {
    const num = value.valueOf();
    if (Number.isNaN(num)) return 'nan';
    if (num === Infinity) return 'inf';
    if (num === -Infinity) return '-inf';
    return Number.isInteger(num) ? `${num}.0` : String(num);
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isNaN(value) ? 'nan' : String(value);
  if (value && value.__complex__) {
    const sign = value.im >= 0 ? '+' : '-';
    const imag = Math.abs(value.im);
    return `(${value.re}${sign}${imag}j)`;
  }
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) {
    const items = value.map((v: any) => pyRepr(v)).join(', ');
    if ((value as any).__tuple__) {
      if (value.length === 1) return `(${items},)`;
      return `(${items})`;
    }
    return `[${items}]`;
  }
  if (value instanceof Set) {
    const items = Array.from(value.values()).map((v) => pyRepr(v)).join(', ');
    return `{${items}}`;
  }
  if (value instanceof PyDict) {
    const items = Array.from(value.entries()).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ');
    return `{${items}}`;
  }
  if (value instanceof PyFunction) return `<function ${value.name}>`;
  if (value instanceof PyClass) return `<class '${value.name}'>`;
  if (value instanceof PyInstance) return `<${value.klass.name} object>`;
  return String(value);
};

const pyStr = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value && value.__complex__) return pyRepr(value);
  if (value && value.__typeName__) return `<class '${value.__typeName__}'>`;
  if (value instanceof PyException) return value.message;
  return pyRepr(value);
};

const isComplex = (value: any) => value && value.__complex__;

const toComplex = (value: any) => {
  if (isComplex(value)) return value;
  if (typeof value === 'number') return { __complex__: true, re: value, im: 0 };
  return { __complex__: true, re: 0, im: 0 };
};

const isFloatObject = (value: any) => value instanceof Number;
const numValue = (value: any) => (value instanceof Number ? value.valueOf() : value);

const parseStringToken = (tokenValue: string): { value: string; isFString: boolean } => {
  let raw = tokenValue;
  let isFString = false;
  if (raw.startsWith('f') || raw.startsWith('F')) {
    isFString = true;
    raw = raw.slice(1);
  }
  const quote = raw[0];
  if (raw.startsWith(quote.repeat(3))) {
    const inner = raw.slice(3, -3);
    return { value: inner, isFString };
  }
  const inner = raw.slice(1, -1);
  return { value: inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'"), isFString };
};

/**
 * 虚拟机 - 执行 AST
 */
export class VirtualMachine {
  execute(bytecode: ByteCode): any {
    if (!bytecode.ast) {
      throw new Error('Bytecode missing AST');
    }

    const globalScope = new Scope();
    this.installBuiltins(globalScope);
    return this.executeBlock(bytecode.ast.body, globalScope);
  }

  private installBuiltins(scope: Scope) {
    const builtins = new Map<string, any>();
    builtins.set('print', (...args: any[]) => {
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
    builtins.set('len', (value: any) => {
      if (typeof value === 'string' || Array.isArray(value)) return value.length;
      if (value instanceof PyDict || value instanceof Set) return value.size;
      throw new PyException('TypeError', 'object has no len()');
    });
    builtins.set('range', (...args: any[]) => {
      let start = 0;
      let end = 0;
      let step = 1;
      if (args.length === 1) {
        end = args[0];
      } else if (args.length === 2) {
        start = args[0];
        end = args[1];
      } else if (args.length >= 3) {
        start = args[0];
        end = args[1];
        step = args[2];
      }
      const result: number[] = [];
      if (step === 0) throw new PyException('ValueError', 'range() arg 3 must not be zero');
      if (step > 0) {
        for (let i = start; i < end; i += step) result.push(i);
      } else {
        for (let i = start; i > end; i += step) result.push(i);
      }
      return result;
    });
    const listFn = (value: any) => {
      if (Array.isArray(value)) return [...value];
      if (value instanceof Set) return Array.from(value.values());
      if (value && typeof value[Symbol.iterator] === 'function') return Array.from(value);
      return [];
    };
    (listFn as any).__typeName__ = 'list';
    builtins.set('list', listFn);
    const tupleFn = (value: any) => {
      const arr = Array.isArray(value) ? [...value] : value && typeof value[Symbol.iterator] === 'function' ? Array.from(value) : [];
      (arr as any).__tuple__ = true;
      return arr;
    };
    (tupleFn as any).__typeName__ = 'tuple';
    builtins.set('tuple', tupleFn);
    const setFn = (value: any) => {
      if (value instanceof Set) return new Set(value);
      if (Array.isArray(value)) return new Set(value);
      if (value && typeof value[Symbol.iterator] === 'function') return new Set(Array.from(value));
      return new Set();
    };
    (setFn as any).__typeName__ = 'set';
    builtins.set('set', setFn);
    builtins.set('sum', (value: any[]) => value.reduce((acc, v) => acc + v, 0));
    builtins.set('max', (...args: any[]) => args.length === 1 && Array.isArray(args[0]) ? Math.max(...args[0]) : Math.max(...args));
    builtins.set('min', (...args: any[]) => args.length === 1 && Array.isArray(args[0]) ? Math.min(...args[0]) : Math.min(...args));
    builtins.set('abs', (value: any) => Math.abs(value));
    builtins.set('round', (value: number, digits?: number) => {
      if (digits === undefined) return Math.round(value);
      const factor = Math.pow(10, digits);
      return Math.round(value * factor) / factor;
    });
    const intFn = (value: any) => {
      const result = parseInt(value, 10);
      if (Number.isNaN(result)) throw new PyException('ValueError', 'Invalid integer');
      return result;
    };
    (intFn as any).__typeName__ = 'int';
    builtins.set('int', intFn);
    const floatFn = (value?: any) => {
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
    (floatFn as any).__typeName__ = 'float';
    builtins.set('float', floatFn);
    const strFn = (value: any) => pyStr(value);
    (strFn as any).__typeName__ = 'str';
    builtins.set('str', strFn);
    const boolFn = (value: any) => isTruthy(value);
    (boolFn as any).__typeName__ = 'bool';
    builtins.set('bool', boolFn);
    builtins.set('type', (value: any) => ({ __typeName__: pyTypeName(value) }));
    builtins.set('isinstance', (value: any, typeObj: any) => {
      if (typeObj && typeObj.__typeName__) {
        return pyTypeName(value) === typeObj.__typeName__;
      }
      return false;
    });
    builtins.set('enumerate', (iterable: any) => {
      const arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
      return arr.map((v, i) => {
        const tup = [i, v];
        (tup as any).__tuple__ = true;
        return tup;
      });
    });
    builtins.set('zip', (...iterables: any[]) => {
      const arrays = iterables.map((it) => (Array.isArray(it) ? it : Array.from(it)));
      const length = Math.min(...arrays.map((a) => a.length));
      const result: any[] = [];
      for (let i = 0; i < length; i++) {
        const tup = arrays.map((a) => a[i]);
        (tup as any).__tuple__ = true;
        result.push(tup);
      }
      return result;
    });
    builtins.set('sorted', (iterable: any) => {
      const arr = Array.isArray(iterable) ? [...iterable] : Array.from(iterable);
      if (arr.every((v) => typeof v === 'number')) {
        return arr.sort((a, b) => a - b);
      }
      return arr.sort();
    });
    builtins.set('reversed', (iterable: any) => {
      const arr = Array.isArray(iterable) ? [...iterable] : Array.from(iterable);
      return arr.reverse();
    });
    builtins.set('map', (fn: any, iterable: any) => {
      const arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
      return arr.map((value) => this.callFunction(fn, [value], scope));
    });
    builtins.set('filter', (fn: any, iterable: any) => {
      const arr = Array.isArray(iterable) ? iterable : Array.from(iterable);
      return arr.filter((value) => isTruthy(this.callFunction(fn, [value], scope)));
    });
    builtins.set('next', (iterable: any) => {
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
    builtins.set('open', (path: any, mode: any = 'r') => {
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
    builtins.set('ZeroDivisionError', exceptionClass('ZeroDivisionError', ExceptionBase));
    builtins.set('ValueError', exceptionClass('ValueError', ExceptionBase));
    builtins.set('TypeError', exceptionClass('TypeError', ExceptionBase));
    builtins.set('FileNotFoundError', exceptionClass('FileNotFoundError', ExceptionBase));

    scope.values = new Map([...builtins.entries()]);
  }

  private executeBlock(body: any[], scope: Scope): any {
    let lastValue: any = null;
    for (const stmt of body) {
      lastValue = this.executeStatement(stmt, scope);
    }
    return lastValue;
  }

  private iterableToArray(iterable: any): any[] {
    if (iterable instanceof PyDict) return Array.from(iterable.keys());
    if (iterable instanceof Set) return Array.from(iterable.values());
    if (Array.isArray(iterable)) return iterable;
    if (iterable && typeof iterable[Symbol.iterator] === 'function') return Array.from(iterable);
    return [];
  }

  private *executeBlockGenerator(body: any[], scope: Scope): Generator<any, any, any> {
    for (const stmt of body) {
      yield* this.executeStatementGenerator(stmt, scope);
    }
    return null;
  }

  private *executeStatementGenerator(node: any, scope: Scope): Generator<any, any, any> {
    switch (node.type) {
      case ASTNodeType.EXPRESSION_STATEMENT: {
        if (this.expressionHasYield(node.expression)) {
          yield* this.evaluateExpressionGenerator(node.expression, scope);
          return null;
        }
        this.evaluateExpression(node.expression, scope);
        return null;
      }
      case ASTNodeType.ASSIGNMENT: {
        const value = this.expressionHasYield(node.value)
          ? yield* this.evaluateExpressionGenerator(node.value, scope)
          : this.evaluateExpression(node.value, scope);
        for (const target of node.targets) {
          this.assignTarget(target, value, scope);
        }
        return null;
      }
      case ASTNodeType.IF_STATEMENT: {
        const test = this.expressionHasYield(node.test)
          ? yield* this.evaluateExpressionGenerator(node.test, scope)
          : this.evaluateExpression(node.test, scope);
        if (isTruthy(test)) {
          yield* this.executeBlockGenerator(node.body, scope);
          return null;
        }
        for (const branch of node.elifs) {
          const branchTest = this.expressionHasYield(branch.test)
            ? yield* this.evaluateExpressionGenerator(branch.test, scope)
            : this.evaluateExpression(branch.test, scope);
          if (isTruthy(branchTest)) {
            yield* this.executeBlockGenerator(branch.body, scope);
            return null;
          }
        }
        if (node.orelse?.length) {
          yield* this.executeBlockGenerator(node.orelse, scope);
        }
        return null;
      }
      case ASTNodeType.WHILE_STATEMENT: {
        while (true) {
          const test = this.expressionHasYield(node.test)
            ? yield* this.evaluateExpressionGenerator(node.test, scope)
            : this.evaluateExpression(node.test, scope);
          if (!isTruthy(test)) break;
          try {
            yield* this.executeBlockGenerator(node.body, scope);
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (err instanceof ContinueSignal) continue;
            throw err;
          }
        }
        return null;
      }
      case ASTNodeType.FOR_STATEMENT: {
        const iterable = this.expressionHasYield(node.iter)
          ? yield* this.evaluateExpressionGenerator(node.iter, scope)
          : this.evaluateExpression(node.iter, scope);
        const items = this.iterableToArray(iterable);
        for (const item of items) {
          this.assignTarget(node.target, item, scope);
          try {
            yield* this.executeBlockGenerator(node.body, scope);
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (err instanceof ContinueSignal) continue;
            throw err;
          }
        }
        return null;
      }
      case ASTNodeType.RETURN_STATEMENT: {
        const value = node.value
          ? (this.expressionHasYield(node.value)
              ? yield* this.evaluateExpressionGenerator(node.value, scope)
              : this.evaluateExpression(node.value, scope))
          : null;
        throw new ReturnSignal(value);
      }
      case ASTNodeType.BREAK_STATEMENT:
        throw new BreakSignal();
      case ASTNodeType.CONTINUE_STATEMENT:
        throw new ContinueSignal();
      case ASTNodeType.PASS_STATEMENT:
        return null;
      default:
        return this.executeStatement(node, scope);
    }
  }

  private *evaluateExpressionGenerator(node: any, scope: Scope): Generator<any, any, any> {
    switch (node.type) {
      case ASTNodeType.YIELD: {
        const value = node.value ? yield* this.evaluateExpressionGenerator(node.value, scope) : null;
        const sent = yield value;
        return sent;
      }
      case ASTNodeType.BINARY_OPERATION: {
        const left = yield* this.evaluateExpressionGenerator(node.left, scope);
        const right = yield* this.evaluateExpressionGenerator(node.right, scope);
        return this.applyBinary(node.operator, left, right);
      }
      case ASTNodeType.UNARY_OPERATION: {
        const operand = yield* this.evaluateExpressionGenerator(node.operand, scope);
        return this.evaluateExpression({ ...node, operand }, scope);
      }
      case ASTNodeType.COMPARE: {
        const left = yield* this.evaluateExpressionGenerator(node.left, scope);
        const comparators = [];
        for (const comp of node.comparators) {
          comparators.push(yield* this.evaluateExpressionGenerator(comp, scope));
        }
        return this.evaluateExpression({ ...node, left, comparators }, scope);
      }
      case ASTNodeType.CALL: {
        const callee = yield* this.evaluateExpressionGenerator(node.callee, scope);
        const positional: any[] = [];
        const kwargs: Record<string, any> = {};
        for (const arg of node.args) {
          if (arg.type === 'KeywordArg') {
            kwargs[arg.name] = yield* this.evaluateExpressionGenerator(arg.value, scope);
          } else if (arg.type === 'StarArg') {
            const value = yield* this.evaluateExpressionGenerator(arg.value, scope);
            positional.push(...(Array.isArray(value) ? value : Array.from(value)));
          } else if (arg.type === 'KwArg') {
            const value = yield* this.evaluateExpressionGenerator(arg.value, scope);
            Object.assign(kwargs, value);
          } else {
            positional.push(yield* this.evaluateExpressionGenerator(arg, scope));
          }
        }
        return this.callFunction(callee, positional, scope, kwargs);
      }
      case ASTNodeType.ATTRIBUTE: {
        const obj = yield* this.evaluateExpressionGenerator(node.object, scope);
        return this.getAttribute(obj, node.name, scope);
      }
      case ASTNodeType.SUBSCRIPT: {
        const obj = yield* this.evaluateExpressionGenerator(node.object, scope);
        const index = yield* this.evaluateExpressionGenerator(node.index, scope);
        return this.getSubscript(obj, index);
      }
      case ASTNodeType.IF_EXPRESSION: {
        const test = yield* this.evaluateExpressionGenerator(node.test, scope);
        return isTruthy(test)
          ? yield* this.evaluateExpressionGenerator(node.consequent, scope)
          : yield* this.evaluateExpressionGenerator(node.alternate, scope);
      }
      default:
        return this.evaluateExpression(node, scope);
    }
  }

  private executeStatement(node: any, scope: Scope): any {
    switch (node.type) {
      case ASTNodeType.EXPRESSION_STATEMENT:
        return this.evaluateExpression(node.expression, scope);
      case ASTNodeType.ASSIGNMENT: {
        const value = this.evaluateExpression(node.value, scope);
        for (const target of node.targets) {
          this.assignTarget(target, value, scope);
        }
        return null;
      }
      case ASTNodeType.AUG_ASSIGNMENT: {
        const current = this.evaluateExpression(node.target, scope);
        const value = this.evaluateExpression(node.value, scope);
        const result = this.applyBinary(node.operator.slice(0, -1), current, value);
        this.assignTarget(node.target, result, scope);
        return null;
      }
      case ASTNodeType.IF_STATEMENT: {
        if (isTruthy(this.evaluateExpression(node.test, scope))) {
          return this.executeBlock(node.body, scope);
        }
        for (const branch of node.elifs) {
          if (isTruthy(this.evaluateExpression(branch.test, scope))) {
            return this.executeBlock(branch.body, scope);
          }
        }
        if (node.orelse?.length) {
          return this.executeBlock(node.orelse, scope);
        }
        return null;
      }
      case ASTNodeType.WHILE_STATEMENT: {
        while (isTruthy(this.evaluateExpression(node.test, scope))) {
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
      case ASTNodeType.FUNCTION_DEF: {
        const params = (node.params || []).map((param: any) => {
          if (param.type === 'Param' && param.defaultValue) {
            return { ...param, defaultEvaluated: this.evaluateExpression(param.defaultValue, scope) };
          }
          return param;
        });
        const fn = new PyFunction(node.name, params, node.body, scope, this.containsYield(node.body));
        scope.set(node.name, fn);
        if (node.decorators && node.decorators.length > 0) {
          let decorated: any = fn;
          for (const decorator of node.decorators.reverse()) {
            const decFn = this.evaluateExpression(decorator, scope);
            decorated = this.callFunction(decFn, [decorated], scope);
          }
          scope.set(node.name, decorated);
        }
        return null;
      }
      case ASTNodeType.CLASS_DEF: {
        const bases = node.bases?.map((b: any) => this.evaluateExpression(b, scope)) || [];
        const classScope = new Scope(scope);
        this.executeBlock(node.body, classScope);
        const attributes = new Map(classScope.values.entries());
        const isException = bases.some((b: any) => b instanceof PyClass && b.isException);
        const klass = new PyClass(node.name, bases, attributes, isException);
        scope.set(node.name, klass);
        if (node.decorators && node.decorators.length > 0) {
          let decorated: any = klass;
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
        if (!isTruthy(test)) {
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
        try {
          this.executeBlock(node.body, scope);
        } catch (err) {
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
        if (node.orelse?.length) {
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

  private assignTarget(target: any, value: any, scope: Scope) {
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
      let index: any;
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
        if (index && index.type === ASTNodeType.SLICE) {
          const start = index.start !== null ? index.start : 0;
          const end = index.end !== null ? index.end : obj.length;
          obj.splice(start, end - start, ...value);
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
      if (!Array.isArray(value)) throw new PyException('TypeError', 'cannot unpack non-iterable');
      for (let i = 0; i < elements.length; i++) {
        this.assignTarget(elements[i], value[i], scope);
      }
      return;
    }
    throw new PyException('TypeError', 'invalid assignment target');
  }

  private deleteTarget(target: any, scope: Scope) {
    if (target.type === ASTNodeType.SUBSCRIPT) {
      const obj = this.evaluateExpression(target.object, scope);
      let index: any;
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
        if (index && index.type === ASTNodeType.SLICE) {
          const start = index.start !== null ? index.start : 0;
          const end = index.end !== null ? index.end : obj.length;
          obj.splice(start, end - start);
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

  private evaluateExpression(node: any, scope: Scope): any {
    switch (node.type) {
      case ASTNodeType.NUMBER_LITERAL: {
        const raw = node.value;
        if (typeof raw === 'number') return raw;
        if (typeof raw === 'string' && raw.endsWith('j')) {
          const imag = parseFloat(raw.slice(0, -1));
          return { __complex__: true, re: 0, im: imag };
        }
        if (raw.includes('.')) return new Number(parseFloat(raw));
        return parseInt(raw, 10);
      }
      case ASTNodeType.STRING_LITERAL: {
        const { value, isFString } = parseStringToken(node.value);
        if (isFString) {
          return value.replace(/\{([^}]+)\}/g, (_m, expr) => {
            const { rawExpr, rawSpec } = this.splitFormatSpec(expr);
            const inner = this.evaluateExpressionString(rawExpr.trim(), scope);
            const formatted = this.applyFormatSpec(inner, rawSpec ? rawSpec.trim() : '');
            return formatted;
          });
        }
        return value;
      }
      case ASTNodeType.BOOLEAN_LITERAL:
        return node.value;
      case ASTNodeType.NONE_LITERAL:
        return null;
      case ASTNodeType.IDENTIFIER:
        return scope.get(node.name);
      case ASTNodeType.LIST_LITERAL:
        return node.elements.map((el: any) => this.evaluateExpression(el, scope));
      case ASTNodeType.LIST_COMP: {
        const result: any[] = [];
        const compScope = new Scope(scope);
        this.evaluateComprehension(node.comprehension, compScope, () => {
          result.push(this.evaluateExpression(node.expression, compScope));
        });
        return result;
      }
      case ASTNodeType.TUPLE_LITERAL: {
        const arr = node.elements.map((el: any) => this.evaluateExpression(el, scope));
        (arr as any).__tuple__ = true;
        return arr;
      }
      case ASTNodeType.SET_COMP: {
        const result = new Set<any>();
        const compScope = new Scope(scope);
        this.evaluateComprehension(node.comprehension, compScope, () => {
          result.add(this.evaluateExpression(node.expression, compScope));
        });
        return result;
      }
      case ASTNodeType.SET_LITERAL:
        return new Set(node.elements.map((el: any) => this.evaluateExpression(el, scope)));
      case ASTNodeType.DICT_LITERAL: {
        const map = new PyDict();
        for (const entry of node.entries) {
          map.set(this.evaluateExpression(entry.key, scope), this.evaluateExpression(entry.value, scope));
        }
        return map;
      }
      case ASTNodeType.DICT_COMP: {
        const map = new PyDict();
        const compScope = new Scope(scope);
        this.evaluateComprehension(node.comprehension, compScope, () => {
          map.set(this.evaluateExpression(node.key, compScope), this.evaluateExpression(node.value, compScope));
        });
        return map;
      }
      case ASTNodeType.GENERATOR_EXPR: {
        const self = this;
        const compScope = new Scope(scope);
        const iterator = function* () {
          yield* self.generateComprehension(node.comprehension, compScope, () =>
            self.evaluateExpression(node.expression, compScope)
          );
        };
        return new PyGenerator(iterator());
      }
      case ASTNodeType.BINARY_OPERATION: {
        const left = this.evaluateExpression(node.left, scope);
        const right = this.evaluateExpression(node.right, scope);
        return this.applyBinary(node.operator, left, right);
      }
      case ASTNodeType.UNARY_OPERATION: {
        const operand = this.evaluateExpression(node.operand, scope);
        switch (node.operator) {
          case 'not':
            return !isTruthy(operand);
          case '+':
            return +operand;
          case '-':
            return -operand;
          case '~':
            return ~operand;
          default:
            throw new PyException('TypeError', `unsupported unary operator ${node.operator}`);
        }
      }
      case ASTNodeType.BOOL_OPERATION: {
        if (node.operator === 'and') {
          const left = this.evaluateExpression(node.values[0], scope);
          return isTruthy(left) ? this.evaluateExpression(node.values[1], scope) : left;
        }
        const left = this.evaluateExpression(node.values[0], scope);
        return isTruthy(left) ? left : this.evaluateExpression(node.values[1], scope);
      }
      case ASTNodeType.COMPARE: {
        let left = this.evaluateExpression(node.left, scope);
        for (let i = 0; i < node.ops.length; i++) {
          const op = node.ops[i];
          const right = this.evaluateExpression(node.comparators[i], scope);
          let result = false;
          const leftNum = left instanceof Number ? left.valueOf() : typeof left === 'number' ? left : null;
          const rightNum = right instanceof Number ? right.valueOf() : typeof right === 'number' ? right : null;
          switch (op) {
            case '==':
              if (leftNum !== null && rightNum !== null) {
                result = !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum === rightNum;
              } else {
                result = left === right;
              }
              break;
            case '!=':
              if (leftNum !== null && rightNum !== null) {
                result = Number.isNaN(leftNum) || Number.isNaN(rightNum) || leftNum !== rightNum;
              } else {
                result = left !== right;
              }
              break;
            case '<':
              if (leftNum !== null && rightNum !== null) {
                result = !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum < rightNum;
              } else {
                result = left < right;
              }
              break;
            case '>':
              if (leftNum !== null && rightNum !== null) {
                result = !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum > rightNum;
              } else {
                result = left > right;
              }
              break;
            case '<=':
              if (leftNum !== null && rightNum !== null) {
                result = !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum <= rightNum;
              } else {
                result = left <= right;
              }
              break;
            case '>=':
              if (leftNum !== null && rightNum !== null) {
                result = !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum >= rightNum;
              } else {
                result = left >= right;
              }
              break;
            case 'in':
              result = this.contains(right, left);
              break;
            case 'not in':
              result = !this.contains(right, left);
              break;
            case 'is':
              result = left === right;
              break;
            case 'is not':
              result = left !== right;
              break;
            default:
              throw new PyException('TypeError', `unsupported comparison ${op}`);
          }
          if (!result) return false;
          left = right;
        }
        return true;
      }
      case ASTNodeType.CALL: {
        const callee = this.evaluateExpression(node.callee, scope);
        const positional: any[] = [];
        const kwargs: Record<string, any> = {};
        for (const arg of node.args) {
          if (arg.type === 'KeywordArg') {
            kwargs[arg.name] = this.evaluateExpression(arg.value, scope);
          } else if (arg.type === 'StarArg') {
            const value = this.evaluateExpression(arg.value, scope);
            positional.push(...(Array.isArray(value) ? value : Array.from(value)));
          } else if (arg.type === 'KwArg') {
            const value = this.evaluateExpression(arg.value, scope);
            Object.assign(kwargs, value);
          } else {
            positional.push(this.evaluateExpression(arg, scope));
          }
        }
        return this.callFunction(callee, positional, scope, kwargs);
      }
      case ASTNodeType.ATTRIBUTE: {
        const obj = this.evaluateExpression(node.object, scope);
        return this.getAttribute(obj, node.name, scope);
      }
      case ASTNodeType.SUBSCRIPT: {
        const obj = this.evaluateExpression(node.object, scope);
        if (node.index && node.index.type === ASTNodeType.SLICE) {
          const slice = {
            type: ASTNodeType.SLICE,
            start: node.index.start ? this.evaluateExpression(node.index.start, scope) : null,
            end: node.index.end ? this.evaluateExpression(node.index.end, scope) : null,
            step: node.index.step ? this.evaluateExpression(node.index.step, scope) : null
          };
          return this.getSubscript(obj, slice);
        }
        const index = this.evaluateExpression(node.index, scope);
        return this.getSubscript(obj, index);
      }
      case ASTNodeType.IF_EXPRESSION: {
        const test = this.evaluateExpression(node.test, scope);
        return isTruthy(test)
          ? this.evaluateExpression(node.consequent, scope)
          : this.evaluateExpression(node.alternate, scope);
      }
      case ASTNodeType.LAMBDA: {
        return new PyFunction('<lambda>', node.params.map((p: string) => ({ type: 'Param', name: p })), [{
          type: ASTNodeType.RETURN_STATEMENT,
          value: node.body
        }], scope, false);
      }
      default:
        throw new Error(`Unsupported expression type: ${node.type}`);
    }
  }

  private evaluateExpressionString(expr: string, scope: Scope): any {
    const wrapped = `__f = ${expr}\n`;
    const tokens = new Lexer(wrapped).tokenize();
    const ast = new Parser(tokens).parse();
    const assignment = ast.body[0];
    if (!assignment || assignment.type !== ASTNodeType.ASSIGNMENT) {
      return this.executeExpressionInline(expr, scope);
    }
    return this.evaluateExpression(assignment.value, scope);
  }

  private executeExpressionInline(expr: string, scope: Scope): any {
    const tokens = expr.trim().split(/\s+/);
    if (tokens.length === 1 && scope.values.has(tokens[0])) {
      return scope.get(tokens[0]);
    }
    return expr;
  }

  private applyFormatSpec(value: any, spec: string): string {
    if (!spec) return pyStr(value);
    if (spec.endsWith('%')) {
      const digits = spec.includes('.') ? parseInt(spec.split('.')[1], 10) : 0;
      const num = typeof value === 'number' ? value : parseFloat(value);
      return (num * 100).toFixed(digits) + '%';
    }
    if (spec.includes('.')) {
      const parts = spec.split('.');
      const width = parts[0];
      const precision = parseInt(parts[1].replace(/[^\d]/g, ''), 10);
      const num = typeof value === 'number' ? value : parseFloat(value);
      const formatted = num.toFixed(precision);
      return this.applyWidth(formatted, width);
    }
    if (spec === 'd') return String(parseInt(value, 10));
    if (spec === 'b') return Number(value).toString(2);
    if (spec === 'x') return Number(value).toString(16);
    if (spec === 'o') return Number(value).toString(8);
    return this.applyWidth(String(value), spec);
  }

  private splitFormatSpec(expr: string): { rawExpr: string; rawSpec: string } {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      if (ch === ':' && depth === 0) {
        return { rawExpr: expr.slice(0, i), rawSpec: expr.slice(i + 1) };
      }
    }
    return { rawExpr: expr, rawSpec: '' };
  }

  private applyWidth(text: string, spec: string): string {
    const match = spec.match(/([<^>])?(\d+)/);
    if (!match) return text;
    const align = match[1] || '>';
    const width = parseInt(match[2], 10);
    if (text.length >= width) return text;
    const padding = width - text.length;
    if (align === '<') return text + ' '.repeat(padding);
    if (align === '^') {
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return ' '.repeat(left) + text + ' '.repeat(right);
    }
    return ' '.repeat(padding) + text;
  }

  private contains(container: any, value: any): boolean {
    if (Array.isArray(container)) return container.includes(value);
    if (typeof container === 'string') return container.includes(value);
    if (container instanceof Set) return container.has(value);
    if (container instanceof PyDict) return container.has(value);
    return false;
  }

  private applyBinary(op: string, left: any, right: any): any {
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
            im: a.re * b.im + a.im * b.re
          };
        default:
          throw new PyException('TypeError', `unsupported complex operator ${op}`);
      }
    }
    switch (op) {
      case '+':
        if (Array.isArray(left) && Array.isArray(right)) {
          const result = [...left, ...right];
          if ((left as any).__tuple__ && (right as any).__tuple__) {
            (result as any).__tuple__ = true;
          }
          return result;
        }
        if (isFloatObject(left) || isFloatObject(right)) {
          return new Number(numValue(left) + numValue(right));
        }
        return left + right;
      case '-':
        if (left instanceof Set && right instanceof Set) {
          const result = new Set(left);
          for (const item of right.values()) result.delete(item);
          return result;
        }
        if (isFloatObject(left) || isFloatObject(right)) {
          return new Number(numValue(left) - numValue(right));
        }
        return left - right;
      case '*':
        if (typeof left === 'string' && typeof right === 'number') return left.repeat(right);
        if (typeof right === 'string' && typeof left === 'number') return right.repeat(left);
        if (Array.isArray(left) && typeof right === 'number') {
          const result = Array(right).fill(null).flatMap(() => left);
          if ((left as any).__tuple__) {
            (result as any).__tuple__ = true;
          }
          return result;
        }
        if (isFloatObject(left) || isFloatObject(right)) {
          return new Number(numValue(left) * numValue(right));
        }
        return left * right;
      case '/':
        if (right === 0) throw new PyException('ZeroDivisionError', 'division by zero');
        return new Number(numValue(left) / numValue(right));
      case '//':
        if (right === 0) throw new PyException('ZeroDivisionError', 'division by zero');
        if (isFloatObject(left) || isFloatObject(right)) {
          return new Number(Math.floor(numValue(left) / numValue(right)));
        }
        return Math.floor(left / right);
      case '%':
        if (typeof left === 'string') {
          return this.formatPercent(left, right);
        }
        return left % right;
      case '**':
        return Math.pow(left, right);
      case '&':
        if (left instanceof Set && right instanceof Set) {
          const result = new Set<any>();
          for (const item of left.values()) {
            if (right.has(item)) result.add(item);
          }
          return result;
        }
        return left & right;
      case '|':
        if (left instanceof Set && right instanceof Set) {
          const result = new Set<any>(left);
          for (const item of right.values()) result.add(item);
          return result;
        }
        return left | right;
      case '^':
        if (left instanceof Set && right instanceof Set) {
          const result = new Set<any>();
          for (const item of left.values()) {
            if (!right.has(item)) result.add(item);
          }
          for (const item of right.values()) {
            if (!left.has(item)) result.add(item);
          }
          return result;
        }
        return left ^ right;
      case '<<':
        return left << right;
      case '>>':
        return left >> right;
      default:
        throw new PyException('TypeError', `unsupported operator ${op}`);
    }
  }

  private formatPercent(format: string, value: any): string {
    const values = Array.isArray(value) ? value : [value];
    let index = 0;
    return format.replace(/%[sdfo]/g, (match) => {
      const val = values[index++];
      if (match === '%d') return String(parseInt(val, 10));
      if (match === '%f') return String(parseFloat(val));
      return String(val);
    });
  }

  private getSubscript(obj: any, index: any): any {
    if (index && index.type === ASTNodeType.SLICE) {
      const length = obj.length;
      const startProvided = index.start !== null && index.start !== undefined;
      const endProvided = index.end !== null && index.end !== undefined;
      let start = startProvided ? index.start : null;
      let end = endProvided ? index.end : null;
      const step = index.step !== null && index.step !== undefined ? index.step : 1;
      if (start === null) start = step < 0 ? length - 1 : 0;
      if (end === null) end = step < 0 ? -1 : length;
      if (startProvided && start < 0) start = length + start;
      if (endProvided && end < 0) end = length + end;
      const result: any[] = [];
      for (let i = start; step > 0 ? i < end : i > end; i += step) {
        result.push(obj[i]);
      }
      if (typeof obj === 'string') return result.join('');
      if (Array.isArray(obj) && (obj as any).__tuple__) {
        (result as any).__tuple__ = true;
      }
      return result;
    }
    if (Array.isArray(obj) || typeof obj === 'string') {
      let idx = index;
      if (typeof idx === 'number' && idx < 0) {
        idx = obj.length + idx;
      }
      return obj[idx];
    }
    if (obj instanceof PyDict) {
      return obj.get(index);
    }
    return null;
  }

  private getAttribute(obj: any, name: string, scope: Scope): any {
    if (obj instanceof PyInstance) {
      if (obj.attributes.has(name)) return obj.attributes.get(name);
      const attr = this.findClassAttribute(obj.klass, name);
      if (attr instanceof PyFunction) {
        return (...args: any[]) => this.callFunction(attr, [obj, ...args], scope);
      }
      return attr;
    }
    if (obj instanceof PyClass) {
      const attr = this.findClassAttribute(obj, name);
      return attr;
    }
    if (obj instanceof PyFile) {
      const value = (obj as any)[name];
      if (typeof value === 'function') return value.bind(obj);
      return value;
    }
    if (obj instanceof PyGenerator) {
      const value = (obj as any)[name];
      if (typeof value === 'function') return value.bind(obj);
      return value;
    }
    if (isComplex(obj)) {
      if (name === 'real') return new Number(obj.re);
      if (name === 'imag') return new Number(obj.im);
    }
    if (typeof obj === 'string') {
      if (name === 'upper') return () => obj.toUpperCase();
      if (name === 'replace') return (a: any, b: any) => obj.replace(a, b);
      if (name === 'format') return (...args: any[]) => {
        let kwargs: Record<string, any> = {};
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
      if (name === 'count') return (ch: any) => obj.split(ch).length - 1;
    }
    if (Array.isArray(obj)) {
      if (name === 'append') return (value: any) => obj.push(value);
      if (name === 'count') return (value: any) => obj.filter((item: any) => item === value).length;
      if (name === 'index') return (value: any) => obj.indexOf(value);
    }
    if (obj instanceof PyDict) {
      if (name === 'items') return () => Array.from(obj.entries()).map(([k, v]) => {
        const tup = [k, v];
        (tup as any).__tuple__ = true;
        return tup;
      });
    }
    if (obj instanceof Set) {
      if (name === 'add') return (value: any) => obj.add(value);
      if (name === 'update') return (values: any) => {
        const items = Array.isArray(values) ? values : Array.from(values);
        for (const item of items) obj.add(item);
      };
      if (name === 'remove') return (value: any) => obj.delete(value);
    }
    if (obj && typeof obj === 'object' && obj.__typeName__) {
      if (name === '__name__') return obj.__typeName__;
    }
    if (obj && obj.__typeName__ === undefined && name === '__name__') {
      return obj.name;
    }
    return (obj as any)[name];
  }

  private setAttribute(obj: any, name: string, value: any) {
    if (obj instanceof PyInstance) {
      obj.attributes.set(name, value);
      return;
    }
    (obj as any)[name] = value;
  }

  private findClassAttribute(klass: PyClass, name: string): any {
    if (klass.attributes.has(name)) return klass.attributes.get(name);
    for (const base of klass.bases) {
      const attr = this.findClassAttribute(base, name);
      if (attr !== undefined) return attr;
    }
    return undefined;
  }

  private callFunction(func: any, args: any[], scope: Scope, kwargs: Record<string, any> = {}): any {
    if (func instanceof PyFunction) {
      const callScope = new Scope(func.closure);
      for (const param of func.params) {
        if (param.type === 'Param') {
          let argValue: any;
          if (args.length > 0) {
            argValue = args.shift();
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
          callScope.set(param.name, argValue);
        } else if (param.type === 'VarArg') {
          const varArgs = [...args];
          (varArgs as any).__tuple__ = true;
          callScope.set(param.name, varArgs);
          args = [];
        } else if (param.type === 'KwArg') {
          const kwDict = new PyDict();
          for (const [key, value] of Object.entries(kwargs)) {
            kwDict.set(key, value);
          }
          callScope.set(param.name, kwDict);
          kwargs = {};
        }
      }
      try {
        if (func.isGenerator) {
          const iterator = this.executeBlockGenerator(func.body, callScope);
          return new PyGenerator(iterator);
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

  private containsYield(body: any[]): boolean {
    for (const stmt of body) {
      if (stmt.type === ASTNodeType.YIELD) return true;
      if (stmt.expression && this.expressionHasYield(stmt.expression)) return true;
      if (stmt.value && this.expressionHasYield(stmt.value)) return true;
      if (stmt.body && Array.isArray(stmt.body) && this.containsYield(stmt.body)) return true;
    }
    return false;
  }

  private evaluateComprehension(node: any, scope: Scope, emit: () => void) {
    const clauses = node.clauses || [];
    const walk = (index: number) => {
      if (index >= clauses.length) {
        emit();
        return;
      }
      const clause = clauses[index];
      const iterable = this.evaluateExpression(clause.iter, scope);
      const items = Array.isArray(iterable) ? iterable : Array.from(iterable);
      for (const item of items) {
        this.assignTarget(clause.target, item, scope);
        const passes = clause.ifs.every((cond: any) => isTruthy(this.evaluateExpression(cond, scope)));
        if (passes) {
          walk(index + 1);
        }
      }
    };
    walk(0);
  }

  private *generateComprehension(node: any, scope: Scope, valueFactory: () => any): Generator<any, any, any> {
    const clauses = node.clauses || [];
    const walk = (index: number): Generator<any, any, any> => {
      const self = this;
      return (function* (): Generator<any, any, any> {
        if (index >= clauses.length) {
          yield valueFactory();
          return;
        }
        const clause = clauses[index];
        const iterable = self.evaluateExpression(clause.iter, scope);
        const items = Array.isArray(iterable) ? iterable : Array.from(iterable);
        for (const item of items) {
          self.assignTarget(clause.target, item, scope);
          const passes = clause.ifs.every((cond: any) => isTruthy(self.evaluateExpression(cond, scope)));
          if (passes) {
            yield* walk(index + 1);
          }
        }
      })();
    };
    yield* walk(0);
    return null;
  }

  private expressionHasYield(node: any): boolean {
    if (!node) return false;
    if (node.type === ASTNodeType.YIELD) return true;
    for (const key of Object.keys(node)) {
      const value = (node as any)[key];
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
}
