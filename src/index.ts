#!/usr/bin/env node

import { PythonCompiler } from './python_compiler';
import * as fs from 'fs';

// 导出公共 API
export { PythonCompiler };

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: python-compiler-ts <file.py>');
    process.exit(1);
  }

  const filePath = args[0];

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File '${filePath}' not found`);
    process.exit(1);
  }

  const compiler = new PythonCompiler();

  try {
    const result = compiler.runFile(filePath);
    if (result !== undefined) {
      console.log(result);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}