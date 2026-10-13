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
  assert.equal(result.search.algorithm, 'dual-track LM-prior PUCT MCTS + structured-token p-filter');
  assert.equal(result.topology.bipartiteMatrix.valid, true);
  assert.equal(result.topology.bipartiteMatrix.incidence.length, result.topology.edges.length);
  assert.equal(Number.isFinite(result.candidates[0].puctScore), true);
  assert.equal(result.candidates.filter((candidate) => candidate.status === 'selected').length, 1);
  assert.equal(result.candidates.find((candidate) => candidate.status === 'selected').exportable, true);
  assert.equal(result.agentLoop.hierarchy.strategy, '1+N coordinator/local-sizer decomposition');
  assert.equal(result.verification.topologyPolicy.productionTrack, 'template-constrained composition');
  assert.ok(result.candidates.some((candidate) => candidate.track === 'research'));
});

test('reliability mode disables exploratory topology candidates but retains hierarchical deterministic gates', async () => {
  const result = await runDesignCycle({
    circuit: 'two_stage_ota',
    architectureMode: 'reliability',
    gainTarget: 62,
    ugbwTarget: 28,
    phaseTarget: 62,
    powerTarget: 1.2,
    noiseTarget: 38
  });
  assert.equal(result.spec.architectureMode, 'reliability');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].track, 'production');
  assert.equal(result.verification.topologyPolicy.noveltyAllowed, false);
  assert.match(result.verification.hierarchicalIntegration, /PDG and symbolic oracle/);
});

test('keeps inspect-only candidate artifacts when local feasibility constraints fail', async () => {
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
  assert.match(result.netlist, /2-stage OTA/);
  assert.match(result.testbench, /Generated ngspice testbench/);
  assert.equal(result.artifactStatus, 'candidate-unverified');
  assert.equal(result.constraints.some((constraint) => constraint.id === 'feasibility_guard'), true);
});

test('ingests a TLV271 datasheet attachment into the PDG ledger', async () => {
  const result = await runDesignCycle({
    circuit: 'two_stage_ota',
    supply: 2.7,
    dataSheet: {
      fileName: 'tlv271.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('TLV271 3-MHz rail-to-rail operational amplifier').toString('base64')
    }
  });
  assert.equal(result.dataSheet.parser, 'TI TLV271 deterministic profile');
  assert.equal(result.dataSheet.requirements.length, 12);
  assert.equal(result.pdg.valid, true);
  assert.ok(result.constraints.some((item) => item.id === 'datasheet_slew_rate_typ'));
  assert.equal(result.verification.exportAllowed, false);
});

test('rejects a recognized Class-D datasheet when the selected PDK is incompatible', async () => {
  await assert.rejects(() => runDesignCycle({
    circuit: 'auto',
    dataSheet: {
      fileName: 'tpa3116d2.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('TPA3116D2 50-W Class-D Audio Power Amplifier 4.5 V to 26 V').toString('base64')
    }
  }), /topology requires an off-chip inductor/);
});

test('classifies a voltage-reference datasheet as bandgap rather than inheriting an amplifier', async () => {
  const result = await runDesignCycle({
    circuit: 'auto',
    dataSheet: {
      fileName: 'ref30e.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('REF30E Precision Voltage Reference. Reference voltage 4.096 V.').toString('base64')
    }
  });
  assert.equal(result.dataSheet.classification.circuit, 'bandgap_reference');
  assert.equal(result.topology.id, 'bandgap_reference');
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

test('creates server-issued sessions and keeps result payloads out of the session list', async () => {
  const app = createApp();
  const created = await requestApp(app, 'POST', '/api/sessions', {
    id: 'client-controlled-id',
    title: 'Session API test',
    payload: { shouldNot: 'persist' },
    result: { shouldNot: 'persist' }
  });
  assert.equal(created.statusCode, 201);
  assert.notEqual(created.body.id, 'client-controlled-id');
  assert.equal(created.body.hasResult, false);
  assert.equal('payload' in created.body, false);
  assert.equal('result' in created.body, false);

  const listed = await requestApp(app, 'GET', '/api/sessions');
  const summary = listed.body.sessions.find((session) => session.id === created.body.id);
  assert.ok(summary);
  assert.equal('result' in summary, false);

  const detail = await requestApp(app, 'GET', '/api/sessions/' + created.body.id);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.id, created.body.id);
  assert.equal(detail.body.result, null);
});

test('does not return internal error stacks to API clients', async () => {
  const app = createApp();
  const response = await requestApp(app, 'POST', '/api/agent/run', {
    dataSheet: { fileName: 'unsupported.exe', contentBase64: 'dGVzdA==' }
  });
  assert.equal(response.statusCode, 415);
  assert.match(response.body.error, /Only PDF/);
  assert.equal('stack' in response.body, false);
});
