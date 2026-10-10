import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createApp, normalizeInput, runDesignCycle } from '../server.mjs';

// Unit tests deliberately bypass paid network agents; production defaults to
// FUSION_REQUIRE_LLM=true and refuses a deterministic design-only run.
process.env.FUSION_REQUIRE_LLM = 'false';

function requestApp(app, method, url, body) {
  return new Promise((resolve) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    request.method = method;
    request.url = url;
    const response = {
      statusCode: 200,
      headers: {},
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(data) {
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: data ? JSON.parse(String(data)) : null
        });
      }
    };
    app.emit('request', request, response);
  });
}

test('normalizes unsafe or out-of-range design inputs', () => {
  const input = normalizeInput({
    circuit: 'not-a-template',
    supply: 99,
    gainTarget: -10,
    prompt: 'hello\u0000world'
  });

  assert.equal(input.circuit, 'two_stage_ota');
  assert.equal(input.supply, 5);
  assert.equal(input.gainTarget, 20);
  assert.equal(input.prompt, 'hello world');
});

test('runs a constrained OTA design cycle with verifiable artifacts', async () => {
  const result = await runDesignCycle({
    circuit: 'two_stage_ota',
    gainTarget: 62,
    ugbwTarget: 28,
    phaseTarget: 62,
    powerTarget: 1.2,
    noiseTarget: 38,
    searchBudget: 48
  });

  assert.equal(result.topology.id, 'two_stage_ota');
  assert.equal(result.agents.length, 5);
  assert.equal(result.constraints.every((constraint) => constraint.passed), true);
  assert.match(result.netlist, /\.title 2-stage OTA/);
  assert.match(result.testbench, /\.ac dec/);
  assert.equal(result.verification.templateConstrained, true);
  assert.equal(result.verification.exportAllowed, true);
  assert.equal(result.retrieval.mode, 'local GraphRAG (evidence graph traversal)');
  assert.ok(result.retrieval.graph.graphStats.nodes > 0);
  assert.equal(result.sources.length, 5);
  assert.equal(result.search.algorithm, 'LM-prior PUCT MCTS + structured-token p-filter');
  assert.equal(result.topology.bipartiteMatrix.valid, true);
  assert.equal(result.topology.bipartiteMatrix.incidence.length, result.topology.edges.length);
  assert.equal(Number.isFinite(result.candidates[0].puctScore), true);
  assert.equal(result.candidates.filter((candidate) => candidate.status === 'selected').length, 1);
  assert.equal(result.candidates.find((candidate) => candidate.status === 'selected').exportable, true);
});

test('blocks artifacts when local feasibility constraints fail', async () => {
  const result = await runDesignCycle({
    circuit: 'two_stage_ota',
    gainTarget: 120,
    ugbwTarget: 10000,
    phaseTarget: 120,
    powerTarget: 0.01,
    noiseTarget: 1,
    prompt: 'deliberately over-constrained test case'
  });

  assert.equal(result.verification.exportAllowed, false);
  assert.equal(result.netlist, null);
  assert.equal(result.testbench, null);
  assert.equal(result.constraints.some((constraint) => constraint.id === 'feasibility_guard'), true);
});

test('applies only a validated structured planner action from the server-side LLM adapter', async () => {
  const originalFetch = global.fetch;
  const originalEnabled = process.env.FUSION_ENABLE_OPENAI;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  process.env.FUSION_ENABLE_OPENAI = 'true';
  process.env.OPENAI_API_KEY = 'test-key-never-sent';
  process.env.OPENAI_MODEL = 'test-model';
  global.fetch = async () => new Response(JSON.stringify({
    output_text: JSON.stringify({
      summary: '보상보다 이득단을 우선 조정합니다.',
      targetRole: 'gain_stage',
      deviceScale: 1.12,
      compensationScale: 1.04,
      explorationBias: 0.1
    })
  }), { status: 200 });

  try {
    const result = await runDesignCycle({
      circuit: 'two_stage_ota',
      prompt: 'structured planner adapter test'
    });
    assert.equal(result.planner.enabled, true);
    assert.equal(result.planner.actionAccepted, true);
    assert.equal(result.planner.action.targetRole, 'gain_stage');
    assert.equal(result.planner.action.deviceScale, 1.12);
    assert.match(result.planner.text, /이득단/);
  } finally {
    global.fetch = originalFetch;
    if (originalEnabled === undefined) delete process.env.FUSION_ENABLE_OPENAI;
    else process.env.FUSION_ENABLE_OPENAI = originalEnabled;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  }
});

test('serves the health endpoint and the agent endpoint', async () => {
  const app = createApp();
  const health = await requestApp(app, 'GET', '/api/health');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.body, { ok: true, service: 'fusion-analog-agent-studio' });

  const design = await requestApp(app, 'POST', '/api/agent/run', { circuit: 'ldo', powerTarget: 2.5 });
  const payload = design.body;
  assert.equal(design.statusCode, 200);
  assert.equal(payload.topology.id, 'ldo');
  assert.match(payload.netlist, /MPASS/);
});
