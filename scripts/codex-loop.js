#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = {
    maxIter: 5,
    promptPath: "prompts/task.txt",
    commitPromptPath: "prompts/commit.txt",
    taskCmd: "codex -a never --sandbox workspace-write exec",
    commitCmd: "codex -a never --sandbox workspace-write --add-dir .git exec",
    testCmd: "npm test",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--max-iter") {
      args.maxIter = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--prompt") {
      args.promptPath = argv[i + 1];
      i += 1;
    } else if (arg === "--task-cmd") {
      args.taskCmd = argv[i + 1];
      i += 1;
    } else if (arg === "--commit-prompt") {
      args.commitPromptPath = argv[i + 1];
      i += 1;
    } else if (arg === "--commit-cmd") {
      args.commitCmd = argv[i + 1];
      i += 1;
    } else if (arg === "--test-cmd") {
      args.testCmd = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: scripts/codex-loop.js [options]",
    "",
    "Options:",
    "  --max-iter <n>      Max iterations (default 5)",
    "  --prompt <path>     Prompt file path (default prompts/task.txt)",
    "  --task-cmd <cmd>    Codex task command (default \"codex -a never --sandbox workspace-write exec\")",
    "  --commit-prompt <path>  Commit prompt file (default prompts/commit.txt)",
    "  --commit-cmd <cmd>  Codex commit command (default \"codex -a never --sandbox workspace-write --add-dir .git exec\")",
    "  --test-cmd <cmd>    Test command (default \"npm test\")",
  ].join("\n");
}

function runShell(cmd, opts = {}) {
  const result = spawnSync(cmd, {
    shell: true,
    stdio: ["pipe", "inherit", "inherit"],
    env: opts.env || process.env,
    input: opts.input || undefined,
  });
  return result.status ?? 1;
}

function readPrompt(promptPath) {
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptPath}`);
  }
  return fs.readFileSync(promptPath, "utf8");
}

function buildPrompt(base, testOutput) {
  if (!testOutput) return base;
  return `${base}\n\n[Test failures]\n${testOutput}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!Number.isFinite(args.maxIter) || args.maxIter < 1) {
    console.error("Invalid --max-iter value.");
    process.exit(1);
  }

  let lastTestOutput = "";
  const promptPath = path.resolve(args.promptPath);

  for (let i = 1; i <= args.maxIter; i += 1) {
    console.log(`\n=== Iteration ${i}/${args.maxIter} ===`);
    const basePrompt = readPrompt(promptPath);
    const combinedPrompt = buildPrompt(basePrompt, lastTestOutput);
    const taskStatus = runShell(args.taskCmd, { input: combinedPrompt });
    if (taskStatus !== 0) {
      console.error(`Task command failed (exit ${taskStatus}).`);
      process.exit(taskStatus);
    }

    const commitPrompt = readPrompt(path.resolve(args.commitPromptPath));
    const commitStatus = runShell(args.commitCmd, { input: commitPrompt });
    if (commitStatus !== 0) {
      console.error(`Commit command failed (exit ${commitStatus}).`);
      process.exit(commitStatus);
    }

    const testResult = spawnSync(args.testCmd, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = testResult.stdout ? testResult.stdout.toString() : "";
    const stderr = testResult.stderr ? testResult.stderr.toString() : "";
    const testOutput = `${stdout}${stderr}`.trim();

    if ((testResult.status ?? 1) === 0) {
      console.log("Tests passed.");
      process.exit(0);
    }

    lastTestOutput = testOutput || "Tests failed with no output.";
    console.log("Tests failed; continuing to next iteration.");
  }

  console.error("Reached max iterations without passing tests.");
  process.exit(1);
}

main();
