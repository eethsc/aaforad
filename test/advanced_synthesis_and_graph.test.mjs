import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatasheetGraph, queryDatasheetGraph } from '../engine/datasheet_graph.mjs';
import { synthesizeNetlist, verifyNetlistRules } from '../engine/netlist_synthesizer.mjs';
import { runDesignCycle } from '../server.mjs';

test('builds Datasheet Knowledge Graph with Pins, Subcircuits, and Causal Edges', () => {
  const sampleDatasheet = {
    title: 'Precision LDO Regulator',
    text: `
      Features: Ultra low dropout 200mV, bandgap reference 0.6V, error amplifier with Miller compensation.
      Pin configuration:
      Pin 1: VIN
      Pin 2: VOUT
      Pin 3: FB
      Pin 4: GND
      Electrical characteristics:
      Quiescent current <= 25 uA
      Open loop gain >= 65 dB
      PSRR >= 60 dB at 10kHz
    `,
    detectedCircuit: 'ldo',
    requirements: [
      { metric: 'gain', operator: '>=', value: 65, unit: 'dB' },
      { metric: 'dropout', operator: '<=', value: 200, unit: 'mV' }
    ]
  };

  const graph = buildDatasheetGraph(sampleDatasheet);
  assert.ok(graph.nodes.length >= 6, 'Should extract document, pins, subcircuits, and specs');
  assert.ok(graph.edges.length >= 6, 'Should establish causal and structural edges');

  // Verify Pin extraction
  const pinLabels = graph.nodes.filter((n) => n.type === 'Pin').map((n) => n.label);
  assert.ok(pinLabels.includes('VIN'), 'Must include VIN pin');
  assert.ok(pinLabels.includes('VOUT'), 'Must include VOUT pin');
  assert.ok(pinLabels.includes('FB'), 'Must include FB pin');

  // Verify Subcircuit detection
  const subcircuitLabels = graph.nodes.filter((n) => n.type === 'Subcircuit').map((n) => n.label);
  assert.ok(subcircuitLabels.includes('Bandgap Reference'), 'Must detect Bandgap Reference');
  assert.ok(subcircuitLabels.includes('Error Amplifier'), 'Must detect Error Amplifier');

  // Verify GraphRAG querying
  const queryResult = queryDatasheetGraph(graph, 'error amplifier feedback loop');
  assert.ok(queryResult.matchedNodes.length > 0, 'Query must return matched entity nodes');
  assert.ok(queryResult.architecturalSummary.includes('Error Amplifier'), 'Summary must mention Error Amplifier');
});

test('synthesizes verified netlists across all 16 diverse analog families without floating nodes', () => {
  const families = [
    'two_stage_ota',
    'folded_cascode_ota',
    'telescopic_cascode_ota',
    'ldo',
    'bandgap',
    'comparator',
    'charge_pump',
    'transimpedance_amp',
    'lc_oscillator',
    'ring_oscillator',
    'active_filter',
    'sar_adc',
    'class_d_audio_amp',
    'buck_converter',
    'current_mirror',
    'instrumentation_amp'
  ];

  for (const familyId of families) {
    const synthesized = synthesizeNetlist({
      template: { id: familyId, label: familyId },
      spec: { supply: 1.8, process: 'sky130A' },
      variables: [
        { name: 'W(M1, M2)', value: 16 },
        { name: 'L(M1, M2)', value: 0.36 },
        { name: 'Cc', value: 2.0 },
        { name: 'Rz', value: 750 },
        { name: 'Ibias', value: 25 }
      ],
      pdkProfile: {
        deviceModels: {
          nmos: 'sky130_fd_pr__nfet_01v8',
          pmos: 'sky130_fd_pr__pfet_01v8'
        }
      }
    });

    assert.equal(synthesized.status, 'verified', `${familyId} must be rule-verified`);
    assert.ok(synthesized.elementCount >= 3, `${familyId} must have valid elements`);
    assert.match(synthesized.netlist, /\.title/, `${familyId} must have .title directive`);
    assert.match(synthesized.netlist, /\.end/, `${familyId} must have .end directive`);
    assert.match(synthesized.netlist, /VDD vdd 0 DC/, `${familyId} must have supply rail`);

    // Strict electrical rule verification
    const ruleCheck = verifyNetlistRules(synthesized.netlist);
    assert.equal(ruleCheck.valid, true, `${familyId} must pass strict KCL and connectivity rules`);
    assert.equal(ruleCheck.errors.length, 0, `${familyId} must have zero floating node errors`);
  }
});

test('runs an end-to-end design cycle on a Folded Cascode OTA and synthesizes verified deck', async () => {
  const result = await runDesignCycle({
    circuit: 'folded_cascode_ota',
    supply: 1.8,
    gainTarget: 70,
    ugbwTarget: 40,
    phaseTarget: 60,
    powerTarget: 1.8,
    searchBudget: 16
  });

  assert.equal(result.topology.id, 'folded_cascode_ota');
  assert.ok(result.netlist, 'Netlist must be generated for folded cascode OTA');
  assert.match(result.netlist, /Folded-Cascode OTA/i, 'Netlist must contain Folded-Cascode title');
  assert.equal(result.artifactStatus, 'candidate-unverified');
  assert.ok(result.metrics.gain >= 50, 'Physics surrogate must calculate meaningful gain');
});
