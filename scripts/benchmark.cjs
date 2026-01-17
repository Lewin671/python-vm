#!/usr/bin/env node
/* eslint-disable */
// @ts-nocheck

const { PythonCompiler } = require('../dist/index.js');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pythonCmd = process.env['PYTHON'] || 'python3';

// Read package.json for version info
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const vmVersion = packageJson.version;
const vmName = packageJson.name;

const color = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${color.blue}ℹ${color.reset} ${msg}`),
  success: (msg) => console.log(`${color.green}✓${color.reset} ${msg}`),
  error: (msg) => console.log(`${color.red}✗${color.reset} ${msg}`),
  warn: (msg) => console.log(`${color.yellow}⚠${color.reset} ${msg}`),
};

function measureTime(fn) {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

function runVM(code) {
  const compiler = new PythonCompiler();
  const outputChunks = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk) => {
    outputChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };

  try {
    const time = measureTime(() => {
      compiler.run(code);
    });

    return {
      output: outputChunks.join(''),
      time,
    };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function runPython(code) {
  const tempFile = path.join(__dirname, `_bench_${Date.now()}_${Math.random()}.py`);

  try {
    fs.writeFileSync(tempFile, code);

    const start = process.hrtime.bigint();
    const output = execFileSync(pythonCmd, [tempFile], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const end = process.hrtime.bigint();

    return {
      output,
      time: Number(end - start) / 1_000_000,
    };
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

function benchmark(name, code) {
  process.stdout.write(`  ${name}... `);

  try {
    const vmResult = runVM(code);
    const pythonResult = runPython(code);

    const vmOutput = vmResult.output.trim();
    const pythonOutput = pythonResult.output.trim();
    const correct = vmOutput === pythonOutput;

    process.stdout.write('\n');

    return {
      name,
      vmTime: vmResult.time,
      pythonTime: pythonResult.time,
      ratio: vmResult.time / pythonResult.time,
      vmOutput,
      pythonOutput,
      correct,
    };
  } catch (error) {
    process.stdout.write('\n');
    log.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function main() {
  console.log(`\n${color.bright}${color.cyan}🚀 Performance Benchmark: VM vs CPython${color.reset}\n`);

  try {
    execFileSync(pythonCmd, ['--version'], { stdio: 'pipe' });
    log.success(`Using Python: ${pythonCmd}`);
  } catch {
    log.error(`Python not found: ${pythonCmd}`);
    log.info('Set PYTHON environment variable to specify Python path');
    process.exit(1);
  }

  log.success(`VM: ${vmName} v${vmVersion}`);

  console.log('\n' + '─'.repeat(60));
  console.log('Running Benchmarks');
  console.log('─'.repeat(60) + '\n');

  const results = [];

  results.push(benchmark(
    'Fibonacci(27)',
    `
def fib(n):
    if n <= 1:
        return n
    return fib(n-1) + fib(n-2)

print(fib(27))
`
  ));

  results.push(benchmark(
    'List Operations (200000)',
    `
lst = []
for i in range(200000):
    lst.append(i)
print(sum(lst))
`
  ));

  results.push(benchmark(
    'Primes (5000-6000)',
    `
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n**0.5) + 1):
        if n % i == 0:
            return False
    return True

primes = [i for i in range(5000, 6000) if is_prime(i)]
print(len(primes))
`
  ));

  results.push(benchmark(
    'Dictionary Ops (50000)',
    `
d = {}
for i in range(50000):
    d[str(i)] = i * 2

count = 0
for v in d.values():
    if v > 25000:
        count += 1
print(count)
`
  ));

  results.push(benchmark(
    'Nested Loops (500x500)',
    `
total = 0
for i in range(500):
    for j in range(500):
        total += i * j
print(total)
`
  ));

  results.push(benchmark(
    'String Operations (20000)',
    `
result = []
for i in range(20000):
    s = f"Value: {i}, Double: {i*2}, Triple: {i*3}"
    result.append(s.upper() + s.lower())
print(len(result))
`
  ));

  results.push(benchmark(
    'List Comprehension (50000)',
    `
result = [x*x for x in range(50000) if x % 2 == 0]
print(sum(result))
`
  ));

  console.log('\n' + '═'.repeat(60));
  console.log('Results');
  console.log('═'.repeat(60) + '\n');

  let correctCount = 0;
  let totalVMTime = 0;
  let totalPyTime = 0;

  results.forEach((r) => {
    if (r.correct) {
      correctCount++;
      log.success(r.name);
    } else {
      log.error(r.name);
      console.log(`    Expected: ${r.pythonOutput.substring(0, 50)}`);
      console.log(`    Got:      ${r.vmOutput.substring(0, 50)}`);
    }

    const ratio = r.ratio.toFixed(2);
    const vmMs = r.vmTime.toFixed(3);
    const pyMs = r.pythonTime.toFixed(3);

    console.log(`    VM: ${vmMs}ms | Python: ${pyMs}ms | Ratio: ${ratio}x`);
    totalVMTime += r.vmTime;
    totalPyTime += r.pythonTime;
  });

  console.log('\n' + '─'.repeat(60));
  console.log('Summary');
  console.log('─'.repeat(60) + '\n');

  const avgRatio = totalVMTime / totalPyTime;
  const percentage = ((avgRatio - 1) * 100).toFixed(0);

  console.log(`  ✓ Correctness:    ${correctCount}/${results.length} passed`);
  console.log(`  ⏱  Total VM Time:  ${totalVMTime.toFixed(2)}ms`);
  console.log(`  ⏱  Total Py Time:  ${totalPyTime.toFixed(2)}ms`);
  console.log(`  📊 Average Ratio:  ${avgRatio.toFixed(2)}x (${percentage}% slower)\n`);

  if (avgRatio < 2) {
    log.success('Excellent performance! Less than 2x slower than CPython');
  } else if (avgRatio < 5) {
    log.warn('Good performance, but 2-5x slower than CPython');
  } else if (avgRatio < 20) {
    log.warn('Moderate performance, 5-20x slower than CPython');
  } else {
    log.warn('Slow execution, 20x+ slower than CPython (expected for interpreted VM)');
  }

  const reportDir = path.join(__dirname, '../reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = path.join(
    reportDir,
    `benchmark_v${vmVersion}.json`
  );

  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        vmName,
        vmVersion,
        timestamp: new Date().toISOString(),
        pythonVersion: execFileSync(pythonCmd, ['--version'], { encoding: 'utf8' }).trim(),
        averageRatio: avgRatio,
        correctnessRate: correctCount / results.length,
        results,
      },
      null,
      2
    )
  );

  console.log(`📄 Report saved to: ${reportPath}\n`);
}

main().catch((error) => {
  log.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
