import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PATH = path.join(ROOT, 'data', 'agentic-sizing-knowledge.json');

function storePath() {
  return process.env.FUSION_AGENTIC_KNOWLEDGE_PATH || DEFAULT_PATH;
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storePath(), 'utf8'));
    return Array.isArray(parsed.records) ? parsed : { version: 1, records: [] };
  } catch {
    return { version: 1, records: [] };
  }
}

function compact(record) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    pdkId: record.pdkId,
    templateId: record.templateId,
    views: record.views
  };
}

export async function retrieveSizingKnowledge({ pdkId, templateId, limit = 12 }) {
  const store = await readStore();
  const matched = store.records
    .filter((record) => record.pdkId === pdkId && (record.templateId === templateId || record.templateId === '*'))
    .slice(-limit)
    .reverse()
    .map(compact);
  return { count: matched.length, records: matched };
}

export async function persistSizingKnowledge(record) {
  const file = storePath();
  const store = await readStore();
  store.records.push(record);
  store.records = store.records.slice(-500);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8');
  return { path: file, count: store.records.length };
}

export function extractFourViewKnowledge({ id, pdkId, templateId, action, metrics, constraints, decomposition, transferableHint }) {
  const failures = constraints.filter((item) => !item.passed).map((item) => item.id);
  const passed = constraints.filter((item) => item.passed).map((item) => item.id);
  const role = action.targetRole;
  return {
    id,
    createdAt: new Date().toISOString(),
    pdkId,
    templateId,
    views: {
      performanceTradeoff: [{
        action: { deviceScale: action.deviceScale, compensationScale: action.compensationScale },
        metrics: { gain: metrics.gain, ugbw: metrics.ugbw, phase: metrics.phase, power: metrics.power, noise: metrics.noise },
        satisfied: passed,
        violated: failures
      }],
      rolePerformance: [{ role, satisfied: passed, violated: failures }],
      substructureParameterPerformance: (decomposition?.substructures || []).map((substructure) => ({
        substructure: substructure.name || substructure.type || 'unknown',
        ownerRole: substructure.ownerRole || role,
        action: { deviceScale: action.deviceScale, compensationScale: action.compensationScale },
        observed: { gain: metrics.gain, ugbw: metrics.ugbw, phase: metrics.phase, power: metrics.power, noise: metrics.noise }
      })),
      transferableHeuristics: [{
        text: transferableHint || `${role}: device and compensation scales were evaluated under ${pdkId}; reuse only after PDK-matched simulation.`,
        pdkScoped: true
      }]
    }
  };
}
