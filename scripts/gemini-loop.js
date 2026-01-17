#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = {
    maxIter: 5,
    testPromptPath: "prompts/test.txt",
    promptPath: "prompts/task.txt",
    commitPromptPath: "prompts/commit.txt",
    model: undefined,
    approvalMode: "yolo",
    sandbox: false,
    debug: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--max-iter") {
      args.maxIter = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--test-prompt") {
      args.testPromptPath = argv[i + 1];
      i += 1;
    } else if (arg === "--prompt") {
      args.promptPath = argv[i + 1];
      i += 1;
    } else if (arg === "--commit-prompt") {
      args.commitPromptPath = argv[i + 1];
      i += 1;
    } else if (arg === "--model" || arg === "-m") {
      args.model = argv[i + 1];
      i += 1;
    } else if (arg === "--approval-mode") {
      args.approvalMode = argv[i + 1];
      i += 1;
    } else if (arg === "--sandbox") {
      args.sandbox = true;
    } else if (arg === "--debug" || arg === "-d") {
      args.debug = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: scripts/gemini-loop.js [options]",
    "",
    "Options:",
    "  --max-iter <n>          Max iterations (default 5)",
    "  --test-prompt <path>    Test prompt file path (default prompts/test.txt)",
    "  --prompt <path>         Task prompt file path (default prompts/task.txt)",
    "  --commit-prompt <path>  Commit prompt file (default prompts/commit.txt)",
    "  -m, --model <model>     Gemini model to use",
    "  --approval-mode <mode>  Approval mode: default, auto_edit, yolo (default yolo)",
    "  --sandbox               Run in sandbox mode",
    "  -d, --debug             Enable debug mode",
    "  -h, --help              Show this help message",
    "",
    "Workflow: Test Agent -> Task Agent -> Commit Agent (iterative)",
  ].join("\n");
}

function buildGeminiCmd(prompt, args) {
  const cmdParts = ["gemini"];

  // Add model if specified
  if (args.model) {
    cmdParts.push(`-m "${args.model}"`);
  }

  // Add approval mode
  cmdParts.push(`--approval-mode ${args.approvalMode}`);

  // Add sandbox flag if set
  if (args.sandbox) {
    cmdParts.push("--sandbox");
  }

  // Add debug flag if set
  if (args.debug) {
    cmdParts.push("--debug");
  }

  // Pass prompt as positional argument (quoted to preserve spaces/special chars)
  cmdParts.push(`"${prompt}"`);

  return cmdParts.join(" ");
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

function normalizePrompt(prompt) {
  // Escape special characters for shell
  return prompt
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

function runTest(testPromptPath, args, log, errorLog) {
  log("=== PHASE: Test (Generate test cases & find issues) ===");
  const testPrompt = readPrompt(testPromptPath);
  const normalizedPrompt = normalizePrompt(testPrompt);
  const testCmd = buildGeminiCmd(normalizedPrompt, args);

  log(`Running: ${testCmd.substring(0, 100)}...`);
  const testStatus = runShell(testCmd);

  if (testStatus !== 0) {
    errorLog(`✗ Test agent failed (exit ${testStatus}).`);
    return false;
  }

  log("✓ Test agent completed - issues identified.");
  return true;
}

function runTask(taskPromptPath, args, log, errorLog) {
  log("=== PHASE: Task (Fix issues) ===");
  const basePrompt = readPrompt(taskPromptPath);
  const normalizedPrompt = normalizePrompt(basePrompt);
  const taskCmd = buildGeminiCmd(normalizedPrompt, args);

  log(`Running: ${taskCmd.substring(0, 100)}...`);
  const taskStatus = runShell(taskCmd);

  if (taskStatus !== 0) {
    errorLog(`✗ Task command failed (exit ${taskStatus}).`);
    return false;
  }

  log("✓ Task completed successfully.");
  return true;
}

function runCommit(commitPromptPath, args, log, errorLog) {
  log("=== PHASE: Commit (Commit changes) ===");
  const commitPrompt = readPrompt(commitPromptPath);
  const normalizedPrompt = normalizePrompt(commitPrompt);
  const commitCmd = buildGeminiCmd(normalizedPrompt, args);

  log(`Running: ${commitCmd.substring(0, 100)}...`);
  const commitStatus = runShell(commitCmd);

  if (commitStatus !== 0) {
    errorLog(`✗ Commit command failed (exit ${commitStatus}).`);
    return false;
  }

  log("✓ Commit completed successfully.");
  return true;
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

  const cwd = process.cwd();

  // Initialize logging
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const logFile = path.join(os.tmpdir(), `gemini-loop-${dateStr}.log`);

  console.log(`Logging to ${logFile}`);
  const log = (message) => {
    console.log(message);
    fs.appendFileSync(logFile, `${message}\n`, "utf8");
  };

  const errorLog = (message) => {
    console.error(message);
    fs.appendFileSync(logFile, `[ERROR] ${message}\n`, "utf8");
  };

  log(`=== Gemini Loop Started ===`);
  log(`Max iterations: ${args.maxIter}`);
  log(`Model: ${args.model || "default"}`);
  log(`Approval mode: ${args.approvalMode}`);
  log(`Working directory: ${cwd}`);

  for (let i = 1; i <= args.maxIter; i += 1) {
    log(`\n========== Iteration ${i}/${args.maxIter} ==========`);

    // STEP 1: Test (AI Agent generates test cases and identifies issues)
    const testSuccess = runTest(
      path.resolve(args.testPromptPath),
      args,
      log,
      errorLog
    );
    if (!testSuccess) {
      errorLog("Test agent execution failed. Exiting.");
      process.exit(1);
    }

    // STEP 2: Task (AI Agent fixes issues)
    const taskSuccess = runTask(
      path.resolve(args.promptPath),
      args,
      log,
      errorLog
    );
    if (!taskSuccess) {
      errorLog("Task execution failed. Exiting.");
      process.exit(1);
    }

    // STEP 3: Commit
    const commitSuccess = runCommit(
      path.resolve(args.commitPromptPath),
      args,
      log,
      errorLog
    );
    if (!commitSuccess) {
      errorLog("Commit execution failed. Exiting.");
      process.exit(1);
    }

    log(`Iteration ${i} completed. Proceeding to next iteration...\n`);
  }

  log(`\n=== All ${args.maxIter} iterations completed successfully ===`);
  errorLog(`Log file: ${logFile}`);
  process.exit(0);
}

main();
