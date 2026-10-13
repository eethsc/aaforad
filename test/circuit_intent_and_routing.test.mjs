import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCircuitIntent, runDesignCycle } from '../server.mjs';
import { canonicalCircuitId, synthesizeNetlist, buildParametricNetlist, verifyNetlistRules } from '../engine/netlist_synthesizer.mjs';

test('classifyCircuitIntent correctly routes diverse natural-language requests without defaulting to OTA', () => {
  const ldoIntent = classifyCircuitIntent({ naturalRequest: '1.2V 저전력 LDO 레귤레이터 설계해줘', spec: { circuit: 'auto' } });
  assert.equal(ldoIntent.primaryCircuit, 'ldo');
  assert.equal(ldoIntent.source, 'natural_language_intent');

  const bgrIntent = classifyCircuitIntent({ naturalRequest: 'Precision bandgap voltage reference 회로 구성해줘', spec: { circuit: 'auto' } });
  assert.equal(bgrIntent.primaryCircuit, 'bandgap_reference');

  const compIntent = classifyCircuitIntent({ naturalRequest: '고속 StrongARM dynamic comparator 비교기 만들어줘', spec: { circuit: 'auto' } });
  assert.equal(compIntent.primaryCircuit, 'dynamic_comparator');

  const filterIntent = classifyCircuitIntent({ naturalRequest: '2차 Active-RC low-pass filter 설계해줘', spec: { circuit: 'auto' } });
  assert.equal(filterIntent.primaryCircuit, 'active_rc_filter');

  const tiaIntent = classifyCircuitIntent({ naturalRequest: '광센서 입력을 위한 transimpedance amplifier (TIA) 설계해줘', spec: { circuit: 'auto' } });
  assert.equal(tiaIntent.primaryCircuit, 'tia');

  const sarIntent = classifyCircuitIntent({ naturalRequest: '8-bit SAR ADC 데이터 컨버터 만들어줘', spec: { circuit: 'auto' } });
  assert.equal(sarIntent.primaryCircuit, 'sar_adc');

  const teleIntent = classifyCircuitIntent({ naturalRequest: '초고이득 초고속 telescopic cascode ota 증폭기 설계', spec: { circuit: 'auto' } });
  assert.equal(teleIntent.primaryCircuit, 'telescopic_ota');
});

test('canonicalCircuitId maps frontend aliases to internal synthesizer family IDs', () => {
  assert.equal(canonicalCircuitId('bandgap_reference'), 'bandgap');
  assert.equal(canonicalCircuitId('dynamic_comparator'), 'comparator');
  assert.equal(canonicalCircuitId('active_rc_filter'), 'active_filter');
  assert.equal(canonicalCircuitId('tia'), 'transimpedance_amp');
  assert.equal(canonicalCircuitId('telescopic_ota'), 'telescopic_cascode_ota');
  assert.equal(canonicalCircuitId('ldo'), 'ldo');
  assert.equal(canonicalCircuitId('sar_adc'), 'sar_adc');
});

test('netlist synthesizer generates family-specific netlists instead of 2-stage OTA when passed UI template IDs', () => {
  // Bandgap
  const bgrDeck = buildParametricNetlist('bandgap_reference', { process: 'sky130A' });
  assert.match(bgrDeck, /sky130_fd_pr__pnp_05v5/);
  assert.match(bgrDeck, /Brokaw \/ Kuijk Bandgap/);
  assert.doesNotMatch(bgrDeck, /Parametric Generic Core: 2-Stage OTA/);

  // Dynamic Comparator
  const compDeck = buildParametricNetlist('dynamic_comparator', { process: 'sky130A' });
  assert.match(compDeck, /Dynamic Latch Comparator/);
  assert.match(compDeck, /VCLK clk 0/);
  assert.doesNotMatch(compDeck, /Parametric Generic Core: 2-Stage OTA/);

  // Active-RC Filter
  const filterDeck = buildParametricNetlist('active_rc_filter', { process: 'sky130A' });
  assert.match(filterDeck, /Tow-Thomas 2nd-Order Biquad Active Filter/);
  assert.doesNotMatch(filterDeck, /Parametric Generic Core: 2-Stage OTA/);

  // Transimpedance Amp (TIA)
  const tiaDeck = buildParametricNetlist('tia', { process: 'sky130A' });
  assert.match(tiaDeck, /Transimpedance Amplifier \(TIA\)/);
  assert.doesNotMatch(tiaDeck, /Parametric Generic Core: 2-Stage OTA/);

  // Telescopic Cascode OTA
  const teleDeck = buildParametricNetlist('telescopic_ota', { process: 'sky130A' });
  assert.match(teleDeck, /Telescopic Cascode High-Gain OTA/);
  assert.doesNotMatch(teleDeck, /Parametric Generic Core: 2-Stage OTA/);
});

test('runDesignCycle autonomously routes and synthesizes LDO and Bandgap when requested in natural language with circuit auto', async () => {
  // Test 1: LDO request
  const ldoResult = await runDesignCycle({
    naturalRequest: '1.8V 입력에서 1.2V 출력을 내는 저전력 LDO 전원 레귤레이터 설계해줘',
    circuit: 'auto'
  });
  assert.equal(ldoResult.circuit, 'ldo');
  assert.equal(ldoResult.template.id, 'ldo');
  assert.match(ldoResult.netlist, /Low-Dropout Regulator/);
  assert.match(ldoResult.netlist, /XPASS/);
  assert.doesNotMatch(ldoResult.netlist, /2-stage OTA/);

  // Test 2: Bandgap request
  const bgrResult = await runDesignCycle({
    naturalRequest: '온도 보상된 1.2V 기준 전압을 제공하는 bandgap reference 설계해줘',
    circuit: 'auto'
  });
  assert.equal(bgrResult.circuit, 'bandgap_reference');
  assert.equal(bgrResult.template.id, 'bandgap_reference');
  assert.match(bgrResult.netlist, /Bandgap Voltage Reference/);
  assert.match(bgrResult.netlist, /pnp/);

  // Test 3: Comparator request
  const compResult = await runDesignCycle({
    naturalRequest: '클록 신호에 동기화되는 초고속 dynamic comparator 비교기 만들어줘',
    circuit: 'auto'
  });
  assert.equal(compResult.circuit, 'dynamic_comparator');
  assert.equal(compResult.template.id, 'dynamic_comparator');
  assert.match(compResult.netlist, /Dynamic Latch Comparator/);
});
