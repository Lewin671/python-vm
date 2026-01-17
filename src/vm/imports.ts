import * as fs from 'fs';
import * as path from 'path';
import type { VirtualMachine } from './vm';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { PyValue, PyException, PyFunction, PyGenerator, Scope } from './runtime-types';

export function importModule(this: VirtualMachine, name: string, scope: Scope): PyValue {
  if (this.moduleCache.has(name)) {
    return this.moduleCache.get(name);
  }
  let module: PyValue;
  if (name === 'asyncio') {
    module = this.createAsyncioModule(scope);
  } else {
    module = this.loadModuleFromFile(name, scope);
  }
  this.moduleCache.set(name, module);
  return module;
}

export function createAsyncioModule(this: VirtualMachine, scope: Scope): PyValue {
  return {
    __name__: 'asyncio',
    run: (value: PyValue) => {
      if (value instanceof PyFunction) {
        return this.callFunction(value, [], scope);
      }
      if (value instanceof PyGenerator) {
        return value.next();
      }
      return value;
    }
  };
}

export function loadModuleFromFile(this: VirtualMachine, name: string, scope: Scope): PyValue {
  const modulePath = this.resolveModulePath(name);
  if (!modulePath) {
    throw new PyException('ImportError', `No module named '${name}'`);
  }
  const code = fs.readFileSync(modulePath, 'utf-8');
  const lexer = new Lexer(code);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const moduleScope = new Scope(scope.root());
  moduleScope.set('__name__', name);
  this.executeBlock(ast['body'], moduleScope);
  return { __name__: name, __moduleScope__: moduleScope };
}

export function resolveModulePath(this: VirtualMachine, name: string): string | null {
  for (const basePath of this.moduleSearchPaths) {
    const directPath = path.join(basePath, `${name}.py`);
    if (fs.existsSync(directPath)) return directPath;
    const initPath = path.join(basePath, name, '__init__.py');
    if (fs.existsSync(initPath)) return initPath;
  }
  return null;
}
