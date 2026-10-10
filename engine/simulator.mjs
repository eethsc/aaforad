import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function execute(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ ok: false, code: null, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

export async function detectNgspice() {
  const executable = process.env.NGSPICE_PATH || 'ngspice';
  const result = await execute(executable, ['-v']);
  return { available: result.ok, executable, version: result.stdout.split(/\r?\n/)[0] || null };
}

/**
 * Real NGSPICE adapter. The caller provides a complete test deck with .meas
 * statements. It does not fabricate measurements on simulator failure.
 */
export async function runNgspice(deck) {
  const status = await detectNgspice();
  if (!status.available) return { mode: 'unavailable', status, metrics: null, diagnostics: 'ngspice not found' };
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fusion-ngspice-'));
  const inputPath = path.join(directory, 'design.cir');
  const outputPath = path.join(directory, 'design.log');
  try {
    await writeFile(inputPath, deck, 'utf8');
    const result = await execute(status.executable, ['-b', '-o', outputPath, inputPath]);
    const log = await readFile(outputPath, 'utf8').catch(() => result.stdout + '\n' + result.stderr);
    const measures = {};
    for (const line of log.split(/\r?\n/)) {
      const match = line.match(/^\s*([a-zA-Z][\w-]*)\s*=\s*([-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i);
      if (match) measures[match[1].toLowerCase()] = Number(match[2]);
    }
    return {
      mode: result.ok ? 'ngspice' : 'failed',
      status,
      metrics: Object.keys(measures).length ? measures : null,
      diagnostics: result.ok ? 'ngspice completed' : (result.stderr || log).slice(-1800)
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
