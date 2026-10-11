/**
 * Process-aware design contract.
 *
 * A PDK profile owns numerical knowledge, legal device vocabulary and simulator
 * syntax.  It prevents facts trained on GPDK-45/TSMC-65 or ideal converter
 * elements from silently steering a SKY130 optimization.
 */
const SKY130A = Object.freeze({
  id: 'sky130A',
  label: 'SkyWater SKY130A · 130 nm',
  simulator: 'ngspice',
  dialect: 'ngspice',
  modelFile: '/opt/pdks/sky130A/libs.tech/ngspice/sky130.lib.spice',
  corner: 'tt',
  minChannelLengthUm: 0.15,
  nominalVoltages: [1.8, 3.3],
  maxValidatedVoltage: 3.3,
  deviceModels: {
    nmos: 'sky130_fd_pr__nfet_01v8',
    pmos: 'sky130_fd_pr__pfet_01v8'
  },
  supportsOnChipInductorTopology: false,
  supportsIdealSwitchTopology: false,
  importedQuantitativeKnowledge: 'blocked',
  requiredRecharacterization: ['gm/Id', 'Vth', 'channel-length modulation', 'unit capacitor mismatch', 'parasitics'],
  blockedSyntax: ['simulator lang=spectre', 'parameters ', 'ahdl_include', 'modelParameter'],
  notes: [
    'ATLAS GPDK-45 bounds must be regenerated for SKY130 device geometry and capacitor rules.',
    'AgenticSizing quantitative facts must be re-characterized with SKY130 simulations.',
    'EXPLORE converter grammars may not use ideal switches or assumed on-chip inductors.'
  ]
});

export function resolvePdkProfile(input = {}) {
  const requested = String(input.pdk || input.process || 'sky130A').toLowerCase();
  if (requested.includes('sky130')) return SKY130A;
  // This application currently ships one installed PDK. Unknown names are
  // retained in diagnostics but never borrow SKY130 numerical knowledge.
  return {
    ...SKY130A,
    id: 'unconfigured-external-pdk',
    label: 'External PDK not configured',
    modelFile: null,
    importedQuantitativeKnowledge: 'blocked',
    notes: ['No verified PDK profile is installed for this target. Simulation and sizing export stay gated.']
  };
}

export function pdkKnowledgeScope(profile) {
  return {
    id: profile.id + ':characterized-facts-v1',
    source: profile.id === 'sky130A' ? 'local SKY130 characterization namespace' : 'no active characterization namespace',
    importedQuantitativeKnowledge: profile.importedQuantitativeKnowledge,
    recharacterizationRequired: profile.requiredRecharacterization,
    rule: 'Only measurements tagged with this exact PDK profile may become quantitative sizing facts.'
  };
}

export function templatePdkRequirements(template) {
  const requiresExternalInductor = ['buck_converter', 'class_d_audio_amp'].includes(template.id);
  const requiresHighVoltagePowerDevices = template.id === 'class_d_audio_amp';
  return { requiresExternalInductor, requiresHighVoltagePowerDevices };
}

export function pdkTemplateCompatibility(profile, template, spec) {
  const requirements = templatePdkRequirements(template);
  const reasons = [];
  if (Number(spec.supply) > profile.maxValidatedVoltage) {
    reasons.push(`requested ${spec.supply} V exceeds ${profile.label}'s validated ${profile.maxValidatedVoltage} V domain`);
  }
  if (requirements.requiresExternalInductor && !profile.supportsOnChipInductorTopology) {
    reasons.push('topology requires an off-chip inductor/filter; ideal on-chip inductor search is disabled');
  }
  if (requirements.requiresHighVoltagePowerDevices) {
    reasons.push('topology requires high-voltage power devices unavailable in the installed profile');
  }
  if (profile.id === 'unconfigured-external-pdk') reasons.push('target PDK adapter and model file are not configured');
  return { compatible: reasons.length === 0, reasons, requirements };
}

export function assertNgspiceDeck(deck, profile) {
  const normalized = String(deck || '').toLowerCase();
  const forbidden = profile.blockedSyntax.find((token) => normalized.includes(token));
  if (forbidden) throw new Error(`Spectre-only syntax '${forbidden}' cannot be sent to the SKY130 ngspice adapter.`);
  return {
    deck,
    adapter: 'native ngspice deck; Spectre .scs syntax rejected',
    dialect: profile.dialect
  };
}
