// Runs `npm install` automatically when the workspace dependencies are missing
// or out of date, so `npm run dev` works on a fresh clone or after a
// package.json change without a separate install step.

import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// One representative package per workspace (all hoisted to the root).
const sentinels = ['concurrently', 'express', 'vite', 'react'].map((p) => join(root, 'node_modules', p, 'package.json'));

const lock = join(root, 'package-lock.json');
const installed = join(root, 'node_modules', '.package-lock.json');

const missing = sentinels.some((p) => !existsSync(p));
const stale = existsSync(lock) && existsSync(installed) && statSync(lock).mtimeMs > statSync(installed).mtimeMs;

if (missing || stale) {
  console.log(`[ensure-deps] ${missing ? 'dependencies missing' : 'lockfile changed'} - running npm install...`);
  execSync('npm install --no-audit --no-fund', { cwd: root, stdio: 'inherit' });
} else {
  console.log('[ensure-deps] dependencies up to date');
}
