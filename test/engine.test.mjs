import test from 'node:test';
import assert from 'node:assert/strict';
import { runPuctSearch } from '../engine/mcts.mjs';
import { runParEgo } from '../engine/parego.mjs';
import { evaluateSymbolicOracle } from '../engine/symbolic.mjs';

test('PUCT search auto-commits a structural token and explores alternatives', () => {
  const result = runPuctSearch({
    initialState: { step: 0, tokens: [] },
    actionsFor: (state) => state.step === 0
      ? [{ id: 'forced-grammar', prior: 0.997 }]
      : state.step === 1
        ? [{ id: 'good', prior: 0.7 }, { id: 'bad', prior: 0.3 }]
        : [],
    transition: (state, action) => ({ step: state.step + 1, tokens: state.tokens.concat(action.id) }),
    isTerminal: (state) => state.step >= 2,
    evaluate: (state) => ({
      reward: state.tokens.includes('good') ? 1 : 0.1,
      completions: [{ state, reward: state.tokens.includes('good') ? 1 : 0.1 }]
    }),
    budget: 12,
    pFilterThreshold: 0.99
  });
  assert.deepEqual(result.autoCommittedTokens, ['forced-grammar']);
  assert.equal(result.completions[0].state.tokens.at(-1), 'good');
  assert.equal(result.rootVisits, 12);
});

test('ParEGO identifies a Pareto-preferred sizing point', () => {
  const result = runParEgo({
    bounds: [{ min: 0, max: 1 }, { min: 0, max: 1 }],
    iterations: 10,
    seed: 'parego-test',
    evaluate: ([x, y]) => ({
      objectives: [(x - 0.7) ** 2, (y - 0.35) ** 2, 0.1 * (x + y), 0],
      payload: { x, y }
    })
  });
  assert.equal(result.trace.length, 10);
  assert.ok(result.best.payload.x >= 0 && result.best.payload.x <= 1);
  assert.ok(result.best.payload.y >= 0 && result.best.payload.y <= 1);
});

test('SymPy oracle evaluates numerical constraints outside the LLM path', async () => {
  const oracle = await evaluateSymbolicOracle({
    metrics: { gain: 64, ugbw: 32, phase: 68, power: 0.9, noise: 22 },
    spec: { gainTarget: 62, ugbwTarget: 28, phaseTarget: 62, powerTarget: 1.2, noiseTarget: 38 }
  });
  assert.equal(oracle.available, true);
  assert.equal(oracle.engine, 'SymPy');
  assert.equal(oracle.allPassed, true);
  assert.equal(oracle.passed.gain, true);
});
