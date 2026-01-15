import { PythonCompiler } from '../src/index';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const pythonCommandCandidates = [
  process.env.PYTHON,
  'python3',
  'python',
].filter(Boolean) as string[];

const runPythonFile = (filePath: string): string => {
  let lastError: unknown;
  for (const cmd of pythonCommandCandidates) {
    try {
      return execFileSync(cmd, [filePath], { encoding: 'utf8' });
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to execute Python interpreter. Tried: ${pythonCommandCandidates.join(', ')}. ` +
      `Last error: ${String(lastError)}`
  );
};

const captureOutput = (fn: () => void): string => {
  const outputChunks: string[] = [];
  const writeSpy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: any) => {
      const normalized =
        typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      outputChunks.push(normalized);
      return true;
    });

  try {
    fn();
  } finally {
    writeSpy.mockRestore();
  }

  return outputChunks.join('');
};

describe('PythonCompiler - Public API Tests', () => {
  let compiler: PythonCompiler;

  beforeEach(() => {
    compiler = new PythonCompiler();
  });

  describe('runFile() method', () => {
    const examplesDir = path.join(__dirname, '../examples');
    const exampleFiles = fs
      .readdirSync(examplesDir)
      .filter((file) => file.endsWith('.py'))
      .sort();

    it('should match output for example files', () => {
      for (const fileName of exampleFiles) {
        const filePath = path.join(examplesDir, fileName);
        const expectedOutput = runPythonFile(filePath);
        const actualOutput = captureOutput(() => {
          compiler.runFile(filePath);
        });
        expect(actualOutput).toBe(expectedOutput);
      }
    });
  });
});
