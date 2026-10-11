import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(ENGINE_DIR, '..');
const ORACLE_PATH = path.join(ENGINE_DIR, 'symbolic_oracle.py');

function ensureLocalEnv() {
  if (process.env.PYTHON_PATH) return;
  const envPath = path.join(ROOT_DIR, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

/** Execute the SymPy oracle in a separate process, keeping symbolic evaluation
 * deterministic and independent from any LLM response. */
export function evaluateSymbolicOracle({ metrics, spec }) {
  ensureLocalEnv();
  const python = process.env.PYTHON_PATH || 'python';
  return new Promise((resolve) => {
    const processHandle = spawn(python, [ORACLE_PATH], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => processHandle.kill(), 5000);
    processHandle.stdout.on('data', (chunk) => { stdout += chunk; });
    processHandle.stderr.on('data', (chunk) => { stderr += chunk; });
    processHandle.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ available: false, error: error.message, passed: {}, allPassed: false });
    });
    processHandle.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({ available: false, error: stderr.trim() || `oracle exited ${code}`, passed: {}, allPassed: false });
        return;
      }
      try {
        resolve({ available: true, ...JSON.parse(stdout) });
      } catch {
        resolve({ available: false, error: 'Oracle emitted invalid JSON', passed: {}, allPassed: false });
      }
    });
    processHandle.stdin.end(JSON.stringify({ metrics, spec }));
  });
}
