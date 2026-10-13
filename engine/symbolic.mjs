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

function deterministicThresholdOracle({ metrics, spec, reason }) {
  const checks = [
    ['gain', 'gainTarget', (actual, target) => actual >= target],
    ['ugbw', 'ugbwTarget', (actual, target) => actual >= target],
    ['phase', 'phaseTarget', (actual, target) => actual >= target],
    ['power', 'powerTarget', (actual, target) => actual <= target],
    ['noise', 'noiseTarget', (actual, target) => actual <= target]
  ].filter(([, target]) => spec[target] !== null && spec[target] !== undefined);
  const passed = Object.fromEntries(checks.map(([metric, target, compare]) => [
    metric,
    Number.isFinite(Number(metrics[metric])) && compare(Number(metrics[metric]), Number(spec[target]))
  ]));
  return {
    // A missing optional Python package must not turn an otherwise valid
    // generated SPICE skeleton into null. This is deterministic threshold
    // evaluation, not a claim that a SymPy proof or ngspice measurement ran.
    available: true,
    fallback: true,
    engine: 'JavaScript deterministic threshold oracle (SymPy unavailable)',
    reason,
    passed,
    allPassed: Object.values(passed).every(Boolean),
    formulas: {
      gain: '20*log10(gm*ro)',
      ugbw: 'gm/(2*pi*Cc)',
      power: 'VDD*IDD'
    }
  };
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
      resolve(deterministicThresholdOracle({ metrics, spec, reason: error.message }));
    });
    processHandle.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(deterministicThresholdOracle({ metrics, spec, reason: stderr.trim() || `oracle exited ${code}` }));
        return;
      }
      try {
        resolve({ available: true, ...JSON.parse(stdout) });
      } catch {
        resolve(deterministicThresholdOracle({ metrics, spec, reason: 'SymPy oracle emitted invalid JSON' }));
      }
    });
    processHandle.stdin.end(JSON.stringify({ metrics, spec }));
  });
}
