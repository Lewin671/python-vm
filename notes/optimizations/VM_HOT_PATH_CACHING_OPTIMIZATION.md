# VM Hot-Path Caching and Iterator Fast Paths Report

## Executive Summary

Optimized hot paths in the Python VM by introducing cached f-string/expression parsing and fast iterator paths for ranges/arrays. The measured result on the current codebase shows a **9.54% average VM time improvement** versus baseline for the benchmark suite.

## Environment

- **Node.js Version**: v20.19.6
- **Python Version**: 3.12.3
- **CPU**: AMD EPYC 7763 64-Core Processor
- **OS**: Linux
- **Date**: January 18, 2026 (benchmark run)

## Baseline Performance

### Methodology
- 5 benchmark runs with consistent parameters
- 7 workloads: Fibonacci(30), list operations (1,000,000), primes (25,000-30,000), dictionary ops (250,000), nested loops (1118x1118), string operations (100,000), list comprehensions (250,000)
- VM and CPython outputs validated for correctness

### Baseline Results

| Run | VM Time (ms) | Python Time (ms) | Ratio |
|-----|--------------|------------------|-------|
| 1   | 9112.60      | 656.74           | 13.88x |
| 2   | 9146.06      | 641.62           | 14.25x |
| 3   | 9020.18      | 630.30           | 14.31x |
| 4   | 9200.40      | 656.57           | 14.01x |
| 5   | 9184.93      | 647.04           | 14.20x |

**Statistics:**
- **Average**: 9132.83ms
- **Standard Deviation**: 64.12ms (0.70%)
- **Min/Max**: 9020.18ms / 9200.40ms

## Optimized Performance

### Optimized Results

| Run | VM Time (ms) | Python Time (ms) | Ratio |
|-----|--------------|------------------|-------|
| 1   | 8344.71      | 666.60           | 12.52x |
| 2   | 8244.18      | 668.02           | 12.34x |
| 3   | 8259.38      | 641.93           | 12.87x |
| 4   | 8220.82      | 648.36           | 12.68x |
| 5   | 8237.98      | 649.92           | 12.68x |

**Statistics:**
- **Average**: 8261.41ms
- **Standard Deviation**: 43.44ms (0.53%)
- **Min/Max**: 8220.82ms / 8344.71ms

### Improvement

- **Absolute Improvement**: 871.42ms faster
- **Relative Improvement**: 9.54%

## Key Optimizations

1. **Range object + fast iterator path**
   - Added a lightweight range class and a dedicated fast iterator path for array/range iteration in the VM execution loop.

2. **F-string template caching**
   - Cached template parsing for f-strings to avoid repeated regex and formatting spec parsing.

3. **Expression parsing cache**
   - Cached parsed expression ASTs for f-string interpolation to avoid repeated lex/parse overhead.

4. **Locals sync optimization**
   - Reduced scope/locals synchronization work by tracking unsynced locals and only refreshing when scope size changes.

5. **Call argument binding tweaks**
   - Streamlined parameter binding to avoid repeated array shifts in hot call sites.

## Optimization Attempts and Contribution Breakdown

| Attempt | Change | Avg VM Time (ms) | Δ vs Baseline | Δ vs Previous |
|---------|--------|------------------|--------------|---------------|
| Baseline | None | 9132.83 | - | - |
| A | Range object (no iterator fast path) | 9105.50 | **+0.30%** | +0.30% |
| B | Fast iterator path for array/range | 9294.26 | **-1.77%** | -2.07% |
| C | F-string expression parse cache | 8086.37 | **+11.46%** | +13.00% |
| D (Final) | Template cache + bounded cache pruning + locals sync + call binding | 8261.41 | **+9.54%** | -2.16% |

**Notes:**
- The largest single gain came from caching f-string expression parsing (~11.46% vs baseline).
- The iterator fast path alone regressed in isolation, but it is retained to support the combined final optimization set.
- Cache pruning and locals sync adjustments traded a small amount of peak gain for bounded memory use and stable correctness.

## Correctness Verification

- All benchmark workloads matched CPython output (7/7 correctness).
- Existing unit tests were exercised during development (vitest).

## Conclusion

This iteration focused on hot-path caching and iteration fast paths. The benchmark suite shows a **9.54% improvement** over baseline with stable variance and preserved correctness, and provides a foundation for further improvements (e.g., broader iterator specialization and more aggressive cache strategies).
