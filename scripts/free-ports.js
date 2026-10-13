// Frees the dev ports before `npm run dev` so a stale server from a previous
// run (crashed terminal, orphaned watcher, background task) can never block
// startup with EADDRINUSE / "Port 5180 is already in use".
//
// Ports come from the same places the servers read them:
//   API  -> server/.env PORT (default 4010)
//   Web  -> web/vite.config.ts server.port (default 5180)
// Override with: FREE_PORTS="4010,5180" node scripts/free-ports.js

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const readEnvPort = () => {
  const envFile = join(root, 'server', '.env');
  if (!existsSync(envFile)) return 4010;
  const m = readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
  return m ? Number(m[1]) : 4010;
};

const readVitePort = () => {
  const cfg = join(root, 'web', 'vite.config.ts');
  if (!existsSync(cfg)) return 5180;
  const m = readFileSync(cfg, 'utf8').match(/port:\s*(\d+)/);
  return m ? Number(m[1]) : 5180;
};

const ports = process.env.FREE_PORTS
  ? process.env.FREE_PORTS.split(',').map((p) => Number(p.trim())).filter(Boolean)
  : [readEnvPort(), readVitePort()];

const run = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

const pidsOnPort = (port) => {
  if (process.platform === 'win32') {
    const out = run('netstat -ano -p tcp');
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // Proto  Local Address  Foreign Address  State  PID
      if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
        pids.add(Number(cols[4]));
      }
    }
    return [...pids].filter((pid) => pid > 0);
  }
  const out = run(`lsof -ti tcp:${port} -sTCP:LISTEN`);
  return out.split(/\s+/).map(Number).filter(Boolean);
};

const kill = (pid) => {
  if (process.platform === 'win32') {
    run(`taskkill /F /T /PID ${pid}`);
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
};

const self = process.pid;
let freed = 0;
for (const port of ports) {
  for (const pid of pidsOnPort(port)) {
    if (pid === self) continue;
    kill(pid);
    freed += 1;
    console.log(`[free-ports] stopped stale process ${pid} on port ${port}`);
  }
}

if (freed === 0) {
  console.log(`[free-ports] ports ${ports.join(', ')} are free`);
}
