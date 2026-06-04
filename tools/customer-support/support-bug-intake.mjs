#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SUPPORTED_COMMANDS = new Set(['hourly', 'chatwoot', 'evidence', 'issues']);
const LOCAL_RUNTIME_ENV_KEYS = [
  'OPENTRAIN_SUPPORT_BUG_INTAKE_RUNTIME',
  'OPEN_TRAIN_SUPPORT_BUG_INTAKE_RUNTIME',
];
const LOCAL_RUNTIME_CANDIDATES = [
  path.join('scripts', 'support-bug-intake-runtime.mjs'),
  path.join('tools', 'support-bug-intake-runtime.mjs'),
];

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || args.includes('--help') || args.includes('-h')) {
    await printHelp(0);
    return;
  }

  if (!SUPPORTED_COMMANDS.has(command)) {
    console.error(`Unsupported support bug intake command: ${command}`);
    await printHelp(1);
    return;
  }

  const runtimePath = await resolveLocalRuntimePath();
  if (!runtimePath) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error:
            'Canonical Paperclip bug-intake entrypoint is installed, but no repo-local collector runtime is configured.',
          command,
          canonicalEntryPoint: path.resolve(process.argv[1]),
          searchedPaths: buildRuntimeCandidates(),
          nextAction:
            'Add scripts/support-bug-intake-runtime.mjs to the invoking repo or set OPENTRAIN_SUPPORT_BUG_INTAKE_RUNTIME.',
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  await execNode(runtimePath, args);
}

async function printHelp(exitCode) {
  const runtimePath = await resolveLocalRuntimePath();
  const lines = [
    'Paperclip support bug intake runtime',
    '',
    `Canonical entrypoint: ${path.resolve(process.argv[1])}`,
    'Supported commands: hourly, chatwoot, evidence, issues',
    '',
    'This entrypoint is intentionally stable in Paperclip.',
    'The repo-local collector implementation can be supplied by:',
    ...LOCAL_RUNTIME_ENV_KEYS.map((key) => `- ${key}`),
    ...LOCAL_RUNTIME_CANDIDATES.map((candidate) => `- ${path.join('<invoking-repo>', candidate)}`),
    '',
    runtimePath
      ? `Resolved collector runtime: ${runtimePath}`
      : 'Resolved collector runtime: none',
  ];

  const output = exitCode === 0 ? console.log : console.error;
  output(lines.join('\n'));
  process.exit(exitCode);
}

function buildRuntimeCandidates() {
  const candidates = [];

  for (const key of LOCAL_RUNTIME_ENV_KEYS) {
    const configured = process.env[key]?.trim();
    if (configured) candidates.push(path.resolve(configured));
  }

  for (const relativePath of LOCAL_RUNTIME_CANDIDATES) {
    candidates.push(path.resolve(process.cwd(), relativePath));
  }

  return Array.from(new Set(candidates));
}

async function resolveLocalRuntimePath() {
  for (const candidate of buildRuntimeCandidates()) {
    try {
      await access(candidate);
      if (path.resolve(candidate) !== path.resolve(process.argv[1])) {
        return candidate;
      }
    } catch {
      // Continue through configured candidates.
    }
  }

  return null;
}

function execNode(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    });

    resolve();
  });
}

await main();
