const state = {
  result: null,
  artifact: 'netlist',
  running: false,
  toastTimer: null,
  dataSheet: null,
  dataSheetContract: null,
  sessionId: null
};

const form = document.querySelector('#spec-form');
const runButton = document.querySelector('#run-button');
const toast = document.querySelector('#toast');
const target = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character]);
}

function number(value, decimals) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(decimals) : '—';
}

function metricText(value, unit, decimals) {
  return number(value, decimals) + '<span>' + escapeHtml(unit) + '</span>';
}

function setRunStatus(title, detail, running) {
  target('#run-status-title').textContent = title;
  target('#run-status-detail').textContent = detail;
  target('.status-pulse').style.background = running ? '#e3b341' : '#00b896';
  target('.status-pulse').style.boxShadow = running
    ? '0 0 0 5px rgba(227, 179, 65, 0.14)'
    : '0 0 0 5px rgba(0, 184, 150, 0.12)';
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

async function fileAsBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function formPayload() {
  const values = new FormData(form);
  const payload = Object.fromEntries(values.entries());
  // Disabled form controls are omitted by FormData. A classified datasheet is
  // authoritative, so always transmit its resolved family rather than letting
  // the server fall back to the default two-stage OTA.
  if (state.dataSheetContract?.lockedCircuit) payload.circuit = state.dataSheetContract.lockedCircuit;
  payload.sessionId = state.sessionId;
  delete payload.dataSheet;
  if (state.dataSheet) {
    payload.dataSheet = {
      fileName: state.dataSheet.name,
      mimeType: state.dataSheet.type,
      contentBase64: await fileAsBase64(state.dataSheet)
    };
  }
  return payload;
}

function contractError() {
  const contract = state.dataSheetContract;
  if (contract?.blockers?.length) return contract.blockers.join(' ');
  if (target('[name="pdk"]').value === 'external') return '외부 PDK adapter가 아직 연결되지 않았습니다.';
  const circuit = target('#circuit-input').value;
  if (['buck_converter', 'class_d_audio_amp'].includes(circuit)) {
    return '선택한 회로는 SKY130A의 온칩 수동소자·전력소자 범위를 벗어납니다.';
  }
  return '';
}

function refreshRunAvailability() {
  if (!runButton) return;
  runButton.disabled = state.running || Boolean(contractError());
}

function applyDataSheetContract(contract) {
  state.dataSheetContract = contract;
  const circuit = target('#circuit-input');
  const supply = target('[name="supply"]');
  if (contract.lockedCircuit) {
    circuit.value = contract.lockedCircuit;
    circuit.disabled = false;
    circuit.dataset.documentClass = contract.lockedCircuit;
  } else {
    circuit.disabled = false;
    delete circuit.dataset.documentClass;
  }
  if (contract.supplyRange?.minimum !== null) supply.min = String(contract.supplyRange.minimum);
  if (contract.supplyRange?.maximum !== null) supply.max = String(contract.supplyRange.maximum);
  updateCircuitLabels();
  refreshRunAvailability();
}

function clearDataSheetContract() {
  state.dataSheetContract = null;
  target('#circuit-input').disabled = false;
  const supply = target('[name="supply"]');
  supply.min = '0.6';
  supply.max = '5';
  refreshRunAvailability();
}

async function inspectDataSheet() {
  const payload = await formPayload();
  const inspected = await fetchJson('/api/datasheet/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  applyDataSheetContract(inspected.contract);
  return inspected;
}

function updateCircuitLabels() {
  const labels = Array.from(document.querySelectorAll('.target-field > span'));
  const circuit = target('#circuit-input').value;
  const names = circuit === 'sar_adc'
    ? ['Comparator gain', 'Decision speed', 'Phase guard', 'Power ceiling', 'Noise ceiling', 'Search budget']
    : circuit === 'ldo'
      ? ['Loop gain', 'Loop UGBW', 'Phase margin', 'Power ceiling', 'Output noise', 'Search budget']
      : ['DC gain', 'UGBW', 'Phase margin', 'Power ceiling', 'Noise ceiling', 'Search budget'];
  labels.forEach((label, index) => {
    if (names[index]) label.textContent = names[index];
  });
}

function pause(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '요청을 처리할 수 없습니다.');
  return payload;
}

function stageGlyph(id) {
  return {
    grounding: 'R',
    explore: '⌁',
    planner: 'P',
    critic: 'C',
    verify: '✓'
  }[id] || '•';
}

function renderTopology(topology) {
  const stage = target('#circuit-stage');
  const nodeMap = new Map(topology.nodes.map((node) => [node.id, node]));
  const boundary = topology.id === 'sar_adc'
    ? '<rect class="role-boundary" x="112" y="114" width="368" height="174"></rect><text class="role-caption" x="126" y="132">VALIDATED SAR TEMPLATE</text>'
    : topology.id === 'ldo'
      ? '<rect class="role-boundary" x="119" y="111" width="386" height="182"></rect><text class="role-caption" x="132" y="130">REGULATION LOOP</text>'
      : '<rect class="role-boundary" x="126" y="90" width="302" height="219"></rect><text class="role-caption" x="140" y="108">ANALOG CORE</text>';

  const edges = topology.edges.map((edge, index) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return '';
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - 7;
    const curve = Math.abs(from.y - to.y) > 100 ? 18 : 0;
    const path = 'M ' + from.x + ' ' + from.y
      + ' Q ' + midX + ' ' + (midY - curve) + ' ' + to.x + ' ' + to.y;
    return '<path class="edge-line ' + (index === topology.edges.length - 1 ? 'emphasis' : '') + '" d="' + path + '"></path>'
      + '<text class="edge-label" x="' + midX + '" y="' + midY + '">' + escapeHtml(edge.label) + '</text>';
  }).join('');

  const nodes = topology.nodes.map((node) => {
    const classes = 'circuit-node ' + escapeHtml(node.kind);
    const label = escapeHtml(node.label);
    if (node.kind === 'port') {
      return '<g class="' + classes + '"><rect x="' + (node.x - 30) + '" y="' + (node.y - 14)
        + '" width="60" height="28" rx="5"></rect><text x="' + node.x + '" y="' + (node.y + 4) + '">' + label + '</text></g>';
    }
    return '<g class="' + classes + '"><circle cx="' + node.x + '" cy="' + node.y + '" r="18"></circle>'
      + '<text x="' + node.x + '" y="' + (node.y + 4) + '">' + label + '</text></g>';
  }).join('');

  stage.innerHTML = '<svg class="circuit-svg" viewBox="0 0 630 405" role="img" aria-label="' + escapeHtml(topology.label)
    + ' constrained topology">' + boundary + edges + nodes + '</svg>';
  target('#topology-title').textContent = topology.label;
  target('#topology-summary').textContent = topology.template;
  target('#matrix-tag').textContent = 'B ∈ R' + topology.nodes.length + '×' + topology.edges.length + ' · valid graph';
}

function metricDefinitions(result) {
  const spec = result.spec;
  const metrics = result.metrics;
  const fmtTarget = (val, op, unit) => val !== null && val !== undefined ? `${op} ${val} ${unit}` : 'unconstrained';
  const passCheck = (actual, targetVal, isMax) => {
    if (targetVal === null || targetVal === undefined) return true;
    return isMax ? actual <= targetVal : actual >= targetVal;
  };

  if (result.topology.id === 'sar_adc') {
    return [
      { label: 'SNR', value: metrics.snr, unit: 'dB', target: 'dynamic range proxy', pass: true, decimals: 2 },
      { label: 'ENOB', value: metrics.enob, unit: 'bits', target: 'target 8 bits', pass: metrics.enob >= 7.5, decimals: 2 },
      { label: 'Decision speed', value: metrics.ugbw, unit: 'MHz', target: fmtTarget(spec.ugbwTarget, '≥', 'MHz'), pass: passCheck(metrics.ugbw, spec.ugbwTarget, false), decimals: 2 },
      { label: 'Power', value: metrics.power, unit: 'mW', target: fmtTarget(spec.powerTarget, '≤', 'mW'), pass: passCheck(metrics.power, spec.powerTarget, true), decimals: 3 },
      { label: 'Input noise', value: metrics.noise, unit: 'nV/√Hz', target: fmtTarget(spec.noiseTarget, '≤', 'nV/√Hz'), pass: passCheck(metrics.noise, spec.noiseTarget, true), decimals: 2 }
    ];
  }
  return [
    { label: 'DC gain', value: metrics.gain, unit: 'dB', target: fmtTarget(spec.gainTarget, '≥', 'dB'), pass: passCheck(metrics.gain, spec.gainTarget, false), decimals: 1 },
    { label: 'UGBW', value: metrics.ugbw, unit: 'MHz', target: fmtTarget(spec.ugbwTarget, '≥', 'MHz'), pass: passCheck(metrics.ugbw, spec.ugbwTarget, false), decimals: 2 },
    { label: 'Phase margin', value: metrics.phase, unit: '°', target: fmtTarget(spec.phaseTarget, '≥', '°'), pass: passCheck(metrics.phase, spec.phaseTarget, false), decimals: 1 },
    { label: 'Power', value: metrics.power, unit: 'mW', target: fmtTarget(spec.powerTarget, '≤', 'mW'), pass: passCheck(metrics.power, spec.powerTarget, true), decimals: 3 },
    { label: 'Input noise', value: metrics.noise, unit: 'nV/√Hz', target: fmtTarget(spec.noiseTarget, '≤', 'nV/√Hz'), pass: passCheck(metrics.noise, spec.noiseTarget, true), decimals: 2 }
  ];
}

function renderMetrics(result) {
  const grid = target('#metrics-grid');
  if (!grid) return;
  grid.innerHTML = metricDefinitions(result).map((metric) => (
    '<article class="metric-card">'
      + '<div class="metric-label">' + escapeHtml(metric.label) + '</div>'
      + '<div class="metric-value">' + metricText(metric.value, metric.unit, metric.decimals) + '</div>'
      + '<div class="metric-target">' + escapeHtml(metric.target) + '</div>'
      + '<div class="metric-pass ' + (metric.pass ? '' : 'fail') + '">'
      + (metric.pass ? '● constraint met' : '● review required') + '</div>'
    + '</article>'
  )).join('');
  const cacheLabel = target('#cache-label');
  if (cacheLabel) {
    cacheLabel.innerHTML = result.cache.hit
      ? '<span>◉</span> cache hit · ' + result.cache.savedEvaluations + '개 최적화 평가 재사용'
      : '<span>●</span> ' + result.mode.simulator + ' · cache key ' + result.cache.key;
  }
}

function renderPipeline(result) {
  const container = target('#agent-pipeline');
  if (!container) return;
  container.innerHTML = result.agents.map((agent) => (
    '<article class="agent-step ' + (agent.state === 'attention' ? 'attention' : '') + '">'
      + '<div class="agent-step-icon">' + stageGlyph(agent.id) + '</div>'
      + '<strong>' + escapeHtml(agent.label) + '</strong>'
      + '<small>' + escapeHtml(agent.family) + '</small>'
      + '<div class="agent-state">' + (agent.state === 'complete' ? 'COMPLETE' : 'ATTENTION') + '</div>'
    + '</article>'
  )).join('');
  const action = result.planner.action;
  const actionSuffix = action
    ? ' · 적용 action: ' + action.targetRole + ' / device ×' + action.deviceScale
      + ' / comp ×' + action.compensationScale
    : '';
  const decomposition = result.agentLoop?.netlistDecomposition;
  const delegated = result.agentLoop?.delegatedSizing || [];
  const decompositionSuffix = decomposition
    ? ' · 넷리스트 분해: ' + decomposition.elementCount + ' elements / '
      + (decomposition.substructures || []).map((item) => item.name).join(', ')
    : '';
  const delegationSuffix = delegated.length
    ? ' · 역할별 복구: ' + delegated.filter((item) => item.accepted).length + '/' + delegated.length + ' accepted'
    : '';
  const plannerText = target('#planner-text');
  if (plannerText) plannerText.textContent = result.planner.text + actionSuffix + decompositionSuffix + delegationSuffix;
  const iterationPill = target('#iteration-pill');
  if (iterationPill) iterationPill.textContent = result.iterationHistory.length + ' optimization records';
}

function renderCandidates(result) {
  const container = target('#candidate-list');
  if (!container) return;
  container.innerHTML = result.candidates.map((candidate) => (
    '<article class="candidate-row ' + (candidate.status === 'selected' ? 'selected' : '') + '">'
      + '<div class="candidate-name">'
      + '<strong>' + escapeHtml(candidate.label) + '</strong>'
      + '<small>' + escapeHtml(candidate.templateMatch) + ' · PUCT ' + candidate.puctScore + ' · ' + candidate.visits + ' visits</small>'
      + '</div>'
      + '<div class="candidate-stats"><b>' + Math.round(candidate.feasibility * 100) + '%</b>'
      + '<span>' + (candidate.status === 'selected' ? 'SELECTED' : candidate.status.toUpperCase()) + '</span></div>'
      + '</article>'
  )).join('');
  const filterStat = target('#filter-stat');
  if (filterStat) {
    filterStat.textContent = result.search.autoCommittedTokens.length + ' auto-committed / '
      + result.search.searchBudget + ' search steps';
  }
}

function renderVerification(result) {
  target('#constraint-list').innerHTML = result.constraints.map((constraint) => (
    '<article class="constraint-row ' + (constraint.passed ? '' : 'fail') + '">'
      + '<div class="constraint-mark">' + (constraint.passed ? '✓' : '!') + '</div>'
      + '<div class="constraint-content"><strong>' + escapeHtml(constraint.label) + '</strong>'
      + '<small>' + escapeHtml(constraint.actual) + ' / ' + escapeHtml(constraint.target) + '</small>'
      + '<span>' + escapeHtml(constraint.oracle) + '</span></div>'
      + '</article>'
  )).join('');
  const pdgContent = result.pdg.topologicalOrder.map((id, index) => (
    '<span class="pdg-step">' + (index + 1) + '. ' + escapeHtml(id.replace(/_/g, ' ')) + '</span>'
      + (index < result.pdg.topologicalOrder.length - 1 ? '<span class="pdg-arrow">→</span>' : '')
  )).join('');
  const coverage = result.specCoverage;
  target('#pdg-flow').innerHTML = '<span class="pdg-title">PDG ORDER · ' + coverage.mapped + '/' + coverage.total + ' specs mapped</span>' + pdgContent;
  const verificationPass = result.verification.exportAllowed;
  const badge = target('#verification-status');
  badge.textContent = verificationPass ? 'ALL CHECKS PASS' : 'REVIEW REQUIRED';
  badge.classList.toggle('pass', verificationPass);
  target('#repair-callout').className = 'repair-callout active';
  target('#repair-callout').innerHTML = '<strong>↻ CLOSED-LOOP REPAIR</strong>' + escapeHtml(result.verification.repair.note);
}

function renderTrace(history) {
  const chart = target('#chart-wrap');
  const width = 540;
  const height = 200;
  const left = 36;
  const right = 13;
  const top = 12;
  const bottom = 28;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const maxValue = Math.max(0.75, ...history.map((item) => item.violation));
  const points = history.map((item, index) => {
    const x = left + (innerWidth * index / Math.max(1, history.length - 1));
    const y = top + innerHeight - (item.violation / maxValue * innerHeight);
    return { x, y, item };
  });
  const linePath = points.map((point, index) => (index ? 'L ' : 'M ') + point.x + ' ' + point.y).join(' ');
  const areaPath = linePath + ' L ' + points[points.length - 1].x + ' ' + (top + innerHeight)
    + ' L ' + points[0].x + ' ' + (top + innerHeight) + ' Z';
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const y = top + innerHeight - fraction * innerHeight;
    return '<line class="chart-grid-line" x1="' + left + '" x2="' + (width - right) + '" y1="' + y + '" y2="' + y + '"></line>'
      + '<text class="chart-axis-text" x="0" y="' + (y + 3) + '">' + (fraction * maxValue).toFixed(2) + '</text>';
  }).join('');
  const dots = points.map((point, index) => (
    '<circle class="chart-dot" cx="' + point.x + '" cy="' + point.y + '" r="3.5"></circle>'
      + '<text class="chart-axis-text" text-anchor="middle" x="' + point.x + '" y="' + (height - 6) + '">i' + index + '</text>'
  )).join('');
  chart.innerHTML = '<svg class="trace-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="constraint violation over optimization iterations">'
    + '<defs><linearGradient id="traceGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#0aa789" stop-opacity=".22"></stop><stop offset="100%" stop-color="#0aa789" stop-opacity=".01"></stop></linearGradient></defs>'
    + grid + '<path class="chart-area" d="' + areaPath + '"></path><path class="chart-line" d="' + linePath + '"></path>' + dots + '</svg>';
}

function renderSources(sources, retrieval) {
  target('#source-grid').innerHTML = sources.map((source) => (
    '<article class="source-card"><h3>' + escapeHtml(source.title) + '</h3>'
      + '<span>' + escapeHtml(source.tag) + '</span>'
      + '<p>' + escapeHtml(source.detail) + '</p></article>'
  )).join('');
  target('#knowledge-count').textContent = retrieval
    ? retrieval.mode + ' · ' + sources.length + ' sources'
    : sources.length + ' research patterns fused';
}

function variableArtifact(result) {
  return result.variables.map((variable) => (
    '[' + variable.role + ']  ' + variable.name + ' = ' + variable.value + ' ' + variable.unit
  )).join('\n');
}

function artifactText() {
  if (!state.result) return '실행 후 템플릿 제약 넷리스트가 이곳에 표시됩니다.';
  if (state.artifact === 'variables') return variableArtifact(state.result);
  if (!state.result.verification.exportAllowed) {
    const eligibility = state.result.platformEligibility;
    if (eligibility && !eligibility.compatible) {
      return 'EXPORT BLOCKED — TARGET / PDK MISMATCH\n\n이 데이터시트는 현재 PDK와 검증 어댑터 범위를 벗어납니다.\n\n'
        + eligibility.reasons.map((reason) => '• ' + reason).join('\n') + '\n\n'
        + '선택된 토폴로지는 데이터시트 분류에 따른 검토용 Class-D 후보입니다. 적합한 고전압/파워 PDK와 Class-D load·THD·효율 검증 어댑터를 연결한 후에만 export할 수 있습니다.';
    }
    const failed = state.result.constraints
      .filter((constraint) => !constraint.passed)
      .map((constraint) => constraint.label)
      .join(', ');
    const candidate = state.artifact === 'testbench' ? state.result.testbench : state.result.netlist;
    if (candidate) {
      return 'CANDIDATE ONLY — EXPORT BLOCKED\n\n미충족 제약: ' + (failed || 'unknown') + '\n'
        + '아래는 LLM 에이전트가 생성한 검토용 SPICE 아티팩트입니다. 수치 검증·데이터시트 assertion이 모두 통과할 때까지 다운로드/제조 사용은 차단됩니다.\n\n'
        + candidate;
    }
    if (state.result.circuitAdapter?.level === 'not-implemented') {
      return 'CIRCUIT ADAPTER NOT IMPLEMENTED\n\n' + state.result.circuitAdapter.reason
        + '\n\n이 회로군은 토폴로지 후보와 데이터시트 분석까지만 지원합니다. 가짜 behavioral SPICE deck을 출력하거나 검증 통과로 표시하지 않습니다.';
    }
    return 'EXPORT BLOCKED\n\n미충족 제약: ' + (failed || 'unknown') + '\n'
      + '현재 PDK/회로 도메인에서는 후보 SPICE 아티팩트도 생성할 수 없습니다.';
  }
  if (state.artifact === 'testbench') return state.result.testbench;
  return state.result.netlist;
}

function renderArtifact() {
  target('#artifact-code').textContent = artifactText();
  target('#download-netlist-button').disabled = Boolean(state.result && !state.result.verification.exportAllowed);
  document.querySelectorAll('.artifact-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.artifact === state.artifact);
    button.setAttribute('aria-selected', String(button.dataset.artifact === state.artifact));
  });
}

function renderPdgGraph(pdg, specCoverage) {
  const canvas = target('#pdg-svg-canvas');
  if (!canvas || !pdg || !pdg.nodes) return;
  const nodes = pdg.nodes;
  const edges = pdg.edges || [];
  const width = canvas.clientWidth || 600;
  const height = 220;

  // Layout nodes along layers or topologicalOrder
  const orderMap = new Map((pdg.topologicalOrder || []).map((id, index) => [id, index]));
  const cols = Math.min(6, Math.max(3, Math.ceil(nodes.length / 3)));
  const rows = Math.ceil(nodes.length / cols);
  const colSpacing = (width - 70) / Math.max(1, cols - 1);
  const rowSpacing = (height - 60) / Math.max(1, rows - 1);

  const nodePositions = new Map();
  nodes.forEach((node, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 35 + col * colSpacing;
    const y = 30 + row * rowSpacing;
    nodePositions.set(node.id, { x, y, node });
  });

  const arrowDef = '<defs><marker id="pdg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="#00b896" /></marker></defs>';

  const renderedEdges = edges.map((edge) => {
    const from = nodePositions.get(edge.from);
    const to = nodePositions.get(edge.to);
    if (!from || !to) return '';
    const active = edge.type === 'depends-on';
    return `<path class="pdg-edge ${active ? 'active' : ''}" d="M ${from.x} ${from.y} L ${to.x} ${to.y}" />`;
  }).join('');

  const renderedNodes = nodes.map((node) => {
    const pos = nodePositions.get(node.id);
    if (!pos) return '';
    const isAssertion = node.kind === 'assertion' || node.kind === 'assertion_group';
    const isAnalysis = node.kind === 'analysis';
    const isCondition = node.kind === 'condition_stimulus';
    const rectColor = isAssertion ? 'rgba(227, 179, 65, 0.2)' : isAnalysis ? 'rgba(59, 130, 246, 0.2)' : isCondition ? 'rgba(139, 92, 246, 0.2)' : 'rgba(0, 184, 150, 0.2)';
    const strokeColor = isAssertion ? '#e3b341' : isAnalysis ? '#3b82f6' : isCondition ? '#8b5cf6' : '#00b896';
    const title = escapeHtml(node.id.replace(/_/g, ' '));
    const label = escapeHtml((node.condition?.label || node.metric || (node.kind === 'assertion_group' ? node.metrics?.join(', ') : node.kind) || '').slice(0, 12));

    return `<g class="pdg-node" transform="translate(${pos.x - 42}, ${pos.y - 16})">
      <rect width="84" height="32" rx="6" fill="${rectColor}" stroke="${strokeColor}" stroke-width="1.2" />
      <text class="pdg-node-text" x="42" y="14" text-anchor="middle">${title.slice(0, 14)}</text>
      <text class="pdg-node-kind" x="42" y="25" text-anchor="middle">${label}</text>
    </g>`;
  }).join('');

  canvas.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}">${arrowDef}${renderedEdges}${renderedNodes}</svg>`;
  target('#pdg-graph-meta').textContent = (specCoverage?.complete ? '✓ 전 사양 매핑 완료' : '⚠ 미매핑 사양 존재') + ` (${nodes.length} nodes · ${edges.length} edges)`;
}

function renderKnowledgeGraph(retrieval) {
  const container = target('#graphrag-canvas');
  const pathsContainer = target('#graphrag-paths');
  if (!container || !retrieval) return;

  const graph = retrieval.graph;
  if (!graph || !graph.fullGraph) return;

  const fullNodes = graph.fullGraph.nodes || [];
  const fullEdges = graph.fullGraph.edges || [];
  const width = container.clientWidth || 600;
  const height = 320;

  target('#graphrag-stats-chip').textContent = `${graph.graphStats.nodes} Nodes · ${graph.graphStats.edges} Edges · ${graph.queryTerms.length} 쿼리 키워드`;

  // Circular layout grouped by type: papers in inner circle, claims in outer circle
  const centerX = width / 2;
  const centerY = height / 2;
  const paperRadius = Math.min(width, height) * 0.24;
  const claimRadius = Math.min(width, height) * 0.42;

  const papers = fullNodes.filter((n) => n.type === 'paper');
  const claims = fullNodes.filter((n) => n.type === 'claim');

  const positions = new Map();

  papers.forEach((p, idx) => {
    const angle = (2 * Math.PI * idx) / Math.max(1, papers.length);
    positions.set(p.id, {
      x: centerX + paperRadius * Math.cos(angle),
      y: centerY + paperRadius * Math.sin(angle),
      node: p
    });
  });

  claims.forEach((c, idx) => {
    const angle = (2 * Math.PI * idx) / Math.max(1, claims.length);
    positions.set(c.id, {
      x: centerX + claimRadius * Math.cos(angle),
      y: centerY + claimRadius * Math.sin(angle),
      node: c
    });
  });

  const renderedEdges = fullEdges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const active = edge.active;
    return `<line class="rag-edge ${active ? 'highlighted' : ''}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
  }).join('');

  const renderedNodes = fullNodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) return '';
    const isPaper = node.type === 'paper';
    const isSelected = node.selected;
    const r = isSelected ? (isPaper ? 14 : 9) : (isPaper ? 9 : 5.5);
    const fill = isSelected ? '#22c55e' : (isPaper ? '#3b82f6' : '#8b5cf6');
    const stroke = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
    const strokeWidth = isSelected ? 2.5 : 1;
    const label = escapeHtml(node.title.replace(/###\s*2\.\d*\.?\s*/g, '').slice(0, 16));

    return `<g class="rag-node" transform="translate(${pos.x}, ${pos.y})" title="${escapeHtml(node.title)}">
      <circle r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />
      ${(isPaper || isSelected) ? `<text class="rag-node-label" y="${r + 11}" text-anchor="middle">${label}</text>` : ''}
    </g>`;
  }).join('');

  container.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}">${renderedEdges}${renderedNodes}</svg>`;

  if (pathsContainer) {
    const paths = graph.paths || [];
    pathsContainer.innerHTML = paths.slice(0, 6).map((p) => (
      `<div class="traversal-step active">
        <span>🔗 ${escapeHtml(p.from.replace(/###\s*2\.\d*\.?\s*/g, ''))}</span>
        <span class="traversal-rel">${escapeHtml(p.relation)}</span>
        <span>${escapeHtml(p.to.slice(0, 36))}</span>
      </div>`
    )).join('');
  }
}

function renderAll(result) {
  state.result = result;
  renderTopology(result.topology);
  renderMetrics(result);
  renderPipeline(result);
  renderCandidates(result);
  renderVerification(result);
  renderPdgGraph(result.pdg, result.specCoverage);
  renderTrace(result.iterationHistory);
  renderSources(result.sources, result.retrieval);
  renderKnowledgeGraph(result.retrieval);
  renderArtifact();
  refreshSessions();
  const sessionTitle = result.dataSheet
    ? result.dataSheet.fileName.replace(/\.[^.]+$/, '')
    : result.topology.shortLabel + ' · ' + result.topology.family;
  const sessionTitleEl = target('#session-title');
  if (sessionTitleEl) sessionTitleEl.textContent = sessionTitle;
  const sessionMetaEl = target('#session-meta');
  if (sessionMetaEl) sessionMetaEl.textContent = result.mode?.llm || 'local estimator';
  const breadcrumbCategory = target('#breadcrumb-category');
  if (breadcrumbCategory) breadcrumbCategory.textContent = result.topology.family || 'Workspace';
  const breadcrumbTitle = target('#breadcrumb-title');
  if (breadcrumbTitle) breadcrumbTitle.textContent = result.topology.label || sessionTitle;
  if (result.dataSheet) {
    const status = target('#datasheet-status');
    if (status) {
      const review = result.dataSheet.reviewCandidates?.length
        ? ' · ' + result.dataSheet.reviewCandidates.length + '개 문맥 검토 대기'
        : '';
      status.textContent = result.dataSheet.fileName + ' · ' + result.dataSheet.requirements.length
        + '개 사양 추출' + review + (result.dataSheet.classification?.circuit ? ' · 자동 분류: ' + (result.dataSheet.classification.evidence || result.dataSheet.classification.circuit) : '')
        + ' · ' + result.dataSheet.parser + ' · hash ' + result.dataSheet.sha256;
      status.className = 'ready';
    }
  }
}

function clearResults() {
  target('#metrics-grid').innerHTML = Array.from({ length: 5 }, () => '<div class="metric-card skeleton-card"></div>').join('');
  const candidateList = target('#candidate-list');
  if (candidateList) candidateList.innerHTML = '';
  target('#constraint-list').innerHTML = '';
  target('#pdg-flow').innerHTML = '';
  target('#chart-wrap').innerHTML = '';
  const agentPipeline = target('#agent-pipeline');
  if (agentPipeline) agentPipeline.innerHTML = '';
  target('#circuit-stage').innerHTML = `
    <div class="circuit-empty-placeholder">
      <div class="circuit-empty-icon">⚡</div>
      <p>회로 유형과 사양을 입력한 후 <strong>'에이전트 설계 실행'</strong>을 누르면<br>검증된 넷리스트 토폴로지가 여기에 시각화됩니다.</p>
    </div>`;
  target('#topology-title').textContent = '회로 토폴로지 대기 중';
  target('#topology-summary').textContent = '설계를 실행하면 선택된 회로군의 템플릿과 그래프가 렌더링됩니다.';
  target('#matrix-tag').textContent = 'B ∈ Rⁿˣᵐ · awaiting run';
  target('#artifact-code').textContent = '실행 후 템플릿 제약 넷리스트가 이곳에 표시됩니다.';
  target('#download-netlist-button').disabled = false;
  target('#cache-label').innerHTML = '<span>◌</span> 아직 실행되지 않음';
  const iterationPill = target('#iteration-pill');
  if (iterationPill) iterationPill.textContent = '0 optimization records';
  target('#verification-status').textContent = '대기';
  target('#verification-status').classList.remove('pass');
  target('#repair-callout').className = 'repair-callout';
  const breadcrumbCategory = target('#breadcrumb-category');
  if (breadcrumbCategory) breadcrumbCategory.textContent = 'Workspace';
  const breadcrumbTitle = target('#breadcrumb-title');
  if (breadcrumbTitle) breadcrumbTitle.textContent = '대기 중';
}

function startRunAnimation() {
  const pipeline = target('#agent-pipeline');
  if (!pipeline) return;
  pipeline.innerHTML = ['Grounding', 'Topology search', 'Role sizing', 'Critic loop', 'Verifier'].map((label, index) => (
    '<article class="agent-step"><div class="agent-step-icon" style="animation: sheen 1.2s linear infinite">' + (index + 1) + '</div>'
      + '<strong>' + label + '</strong><small>running...</small><div class="agent-state">ACTIVE</div></article>'
  )).join('');
}

async function runDesign(event) {
  if (event) event.preventDefault();
  if (state.running) return;
  const invalid = contractError();
  if (invalid) {
    setRunStatus('입력 계약 불일치', invalid, false);
    showToast('설계 실행을 차단했습니다: ' + invalid);
    refreshRunAvailability();
    return;
  }
  state.running = true;
  runButton.disabled = true;
  runButton.innerHTML = '<span class="play-icon">◌</span> 에이전트가 설계 중입니다 <span class="button-shortcut">ESC to wait</span>';
  setRunStatus('에이전트 파이프라인 실행 중', 'RAG → constrained search → sizing → neuro-symbolic verification', true);
  startRunAnimation();

  try {
    const request = fetchJson('/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await formPayload())
    });
    const results = await Promise.all([request, pause(540)]);
    renderAll(results[0]);
    const isCached = results[0].cache.hit;
    const verified = results[0].verification.exportAllowed;
    setRunStatus(
      isCached ? '캐시에서 설계 기록 복원' : (verified ? '설계 앵커 준비 완료' : '검증 미통과 · export 차단'),
      isCached
        ? '동일 사양의 최적화 기록을 재사용했습니다.'
      : (verified ? '템플릿·PDG·수치 제약을 통과했습니다.' : (results[0].platformEligibility?.compatible === false ? '데이터시트 목표와 현재 PDK/검증 어댑터가 호환되지 않습니다.' : '미충족 제약을 조정한 뒤 다시 실행해 주세요.')),
      false
    );
    showToast(isCached
      ? 'Cache hit — 이전 최적화 기록을 재사용했습니다.'
      : (verified ? '설계 완료 — 검증된 아티팩트를 확인하세요.' : '설계 결과는 검토용으로만 표시되며 export가 차단되었습니다.'));
  } catch (error) {
    setRunStatus('실행 실패', error.message || '로컬 서버 연결을 확인하세요.', false);
    showToast('실행에 실패했습니다: ' + (error.message || 'unknown error'));
  } finally {
    state.running = false;
    runButton.disabled = false;
    runButton.innerHTML = '<span class="play-icon">▶</span> 에이전트 설계 실행 <span class="button-shortcut">⌘ ↵</span>';
  }
}

async function bootstrap() {
  try {
    const config = await fetchJson('/api/config');
    const chip = target('#runtime-chip');
    chip.innerHTML = '<i></i> ' + escapeHtml(config.llmConfigured ? 'OpenAI planner enabled' : config.simulator);
  } catch {
    target('#runtime-chip').innerHTML = '<i></i> local server offline';
  }
  // Auto-run removed: wait for explicit user click or keypress
}

form.addEventListener('submit', runDesign);
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') runDesign(event);
});

document.querySelectorAll('.artifact-tab').forEach((button) => {
  button.addEventListener('click', () => {
    state.artifact = button.dataset.artifact;
    renderArtifact();
  });
});

target('#copy-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(artifactText());
    showToast('현재 아티팩트를 클립보드에 복사했습니다.');
  } catch {
    showToast('브라우저가 클립보드 접근을 허용하지 않았습니다.');
  }
});

target('#download-netlist-button').addEventListener('click', () => {
  if (!state.result || !state.result.verification.exportAllowed || !state.result.netlist) {
    showToast('수치 제약을 모두 통과한 설계만 SPICE 넷리스트로 내보낼 수 있습니다.');
    return;
  }
  const blob = new Blob([state.result.netlist], { type: 'text/plain;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'fusion-' + state.result.topology.id + '.sp';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
  showToast('SPICE 넷리스트 다운로드를 시작했습니다.');
});

target('#theme-button').addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
  showToast(document.body.classList.contains('light-theme') ? '따뜻한 라이트 테마를 적용했습니다.' : '기본 테마를 적용했습니다.');
});

target('#focus-circuit-button').addEventListener('click', () => {
  target('#circuit-stage').classList.toggle('focused');
});

target('#fit-circuit-button').addEventListener('click', () => {
  target('#circuit-stage').classList.remove('focused');
  showToast('캔버스를 전체 토폴로지에 맞췄습니다.');
});

async function refreshSessions() {
  const container = target('#session-list');
  if (!container) return;
  try {
    const data = await fetchJson('/api/sessions');
    const sessions = data.sessions || [];
    container.innerHTML = sessions.map((sess) => {
      const isSelected = sess.id === state.sessionId;
      return `<div class="session-card ${isSelected ? 'selected' : ''}" data-session-id="${escapeHtml(sess.id)}">
        <div class="session-card-content">
          <span class="session-card-title">${escapeHtml(sess.title)}</span>
          <span class="session-card-meta">${escapeHtml(sess.meta)}</span>
        </div>
        ${sessions.length > 1 ? `<button class="session-delete-btn" data-delete-id="${escapeHtml(sess.id)}" title="세션 삭제">×</button>` : ''}
      </div>`;
    }).join('');

    container.querySelectorAll('.session-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.session-delete-btn')) return;
        const id = card.dataset.sessionId;
        const targetSession = sessions.find((s) => s.id === id);
        if (targetSession) selectSession(targetSession);
      });
    });

    container.querySelectorAll('.session-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        await fetchJson('/api/sessions/' + id, { method: 'DELETE' });
        showToast('세션을 삭제했습니다.');
        if (state.sessionId === id) {
          const remaining = sessions.filter((s) => s.id !== id);
          if (remaining[0]) selectSession(remaining[0]);
          else createNewSession();
        } else {
          await refreshSessions();
        }
      });
    });
  } catch (e) {
    console.error('Failed to load sessions', e);
  }
}

async function selectSession(sess) {
  if (!sess.result && sess.hasResult) {
    try {
      sess = await fetchJson('/api/sessions/' + encodeURIComponent(sess.id));
    } catch (err) {
      showToast('세션을 불러오지 못했습니다: ' + err.message);
      return;
    }
  }
  state.sessionId = sess.id;
  const titleEl = target('#session-title');
  if (titleEl) titleEl.textContent = sess.title;
  const metaEl = target('#session-meta');
  if (metaEl) metaEl.textContent = sess.meta;
  if (sess.circuit) target('#circuit-input').value = sess.circuit;
  updateCircuitLabels();
  if (sess.result) {
    renderAll(sess.result);
    showToast(`'${sess.title}' 세션을 로드했습니다.`);
  } else {
    clearResults();
    const breadcrumbCategory = target('#breadcrumb-category');
    if (breadcrumbCategory) breadcrumbCategory.textContent = 'Session';
    const breadcrumbTitle = target('#breadcrumb-title');
    if (breadcrumbTitle) breadcrumbTitle.textContent = sess.title;
    showToast(`새 세션 '${sess.title}'(으)로 전환했습니다.`);
  }
  refreshSessions();
}

async function createNewSession() {
  const newTitle = '세션 ' + (document.querySelectorAll('.session-card').length + 1) + ' · ' + target('#circuit-input').value;
  try {
    const created = await fetchJson('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle,
        meta: 'local custom sandbox',
        circuit: target('#circuit-input').value
      })
    });
    form.reset();
    state.sessionId = created.id;
    state.dataSheet = null;
    clearDataSheetContract();
    state.result = null;
    state.artifact = 'netlist';
    target('#datasheet-input').value = '';
    const dsStatus = target('#datasheet-status');
    if (dsStatus) {
      dsStatus.textContent = '파일을 선택하면 서버가 텍스트를 추출하고, 사양 ledger·PDG assertion에 원문 근거로 추가합니다. 7 MB 이하.';
      dsStatus.className = '';
    }
    const sessionTitleEl = target('#session-title');
    if (sessionTitleEl) sessionTitleEl.textContent = created.title;
    const sessionMetaEl = target('#session-meta');
    if (sessionMetaEl) sessionMetaEl.textContent = created.meta;
    clearResults();
    updateCircuitLabels();
    await refreshSessions();
    setRunStatus('새 설계 세션', '사양을 조정한 뒤 에이전트 설계를 실행하세요.', false);
    showToast('새 설계 세션을 생성했습니다.');
  } catch (err) {
    showToast('세션 생성 오류: ' + err.message);
  }
}

target('#new-session-button').addEventListener('click', createNewSession);

target('#datasheet-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0] || null;
  const status = target('#datasheet-status');
  state.dataSheet = null;
  clearDataSheetContract();
  if (!file) {
    status.textContent = '파일을 선택하면 서버가 텍스트를 추출하고, 사양 ledger·PDG assertion에 원문 근거로 추가합니다. 7 MB 이하.';
    status.className = '';
    return;
  }
  if (file.size > 7 * 1024 * 1024) {
    status.textContent = '7 MB 이하의 데이터시트만 첨부할 수 있습니다.';
    status.className = 'error';
    event.target.value = '';
    return;
  }
  state.dataSheet = file;
  status.textContent = file.name + ' · 데이터시트와 PDK 계약을 검사 중입니다.';
  status.className = 'ready';
  try {
    const inspected = await inspectDataSheet();
    const blockers = inspected.contract.blockers || [];
    if (blockers.length) {
      status.textContent = '실행 차단: ' + blockers.join(' ');
      status.className = 'error';
    } else {
      const lock = inspected.contract.lockedCircuitLabel ? ' · 회로군: ' + inspected.contract.lockedCircuitLabel : '';
      const review = inspected.contract.reviewRequired
        ? ' · 숫자 문맥 ' + inspected.contract.reviewCandidates.length + '개는 검토 대기이며 설계 탐색은 가능, export 승인은 보류됩니다.'
        : '';
      status.textContent = file.name + lock + ' · 데이터시트/PDK 계약을 확인했습니다.' + review;
      status.className = inspected.contract.reviewRequired ? '' : 'ready';
    }
  } catch (error) {
    state.dataSheet = null;
    state.dataSheetContract = { blockers: [error.message || '데이터시트 사전 검사를 완료하지 못했습니다.'] };
    status.textContent = '데이터시트 검사 실패: ' + state.dataSheetContract.blockers[0];
    status.className = 'error';
    refreshRunAvailability();
  }
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    const element = document.querySelector('#' + button.dataset.scrollTarget);
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

target('#circuit-input').addEventListener('change', () => {
  const circuit = target('#circuit-input').value;
  updateCircuitLabels();
  if (circuit === 'sar_adc') {
    showToast('SAR ADC는 검증된 서브블록 템플릿에서만 구성됩니다.');
  }
  refreshRunAvailability();
});

target('[name="pdk"]').addEventListener('change', async () => {
  if (!state.dataSheet) {
    refreshRunAvailability();
    return;
  }
  const status = target('#datasheet-status');
  status.textContent = '선택한 PDK와 데이터시트의 호환성을 다시 검사 중입니다.';
  try {
    const inspected = await inspectDataSheet();
    status.textContent = inspected.contract.valid
      ? '데이터시트/PDK 계약을 확인했습니다.'
      : '실행 차단: ' + inspected.contract.blockers.join(' ');
    status.className = inspected.contract.valid ? 'ready' : 'error';
  } catch (error) {
    status.textContent = 'PDK 계약 검사 실패: ' + error.message;
    status.className = 'error';
  }
});

target('[name="naturalRequest"]').addEventListener('input', (event) => {
  if (event.target.value.trim().length > 0) target('#circuit-input').value = 'auto';
  updateCircuitLabels();
});

updateCircuitLabels();
refreshRunAvailability();

async function initialize() {
  try {
    const created = await fetchJson('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '새 설계 세션 (대기 중)',
        meta: '사양 입력 후 실행하세요',
        circuit: target('#circuit-input').value
      })
    });
    state.sessionId = created.id;
    const sessionTitleEl = target('#session-title');
    if (sessionTitleEl) sessionTitleEl.textContent = created.title;
    const sessionMetaEl = target('#session-meta');
    if (sessionMetaEl) sessionMetaEl.textContent = created.meta;
  } catch (err) {
    showToast('세션 초기화 오류: ' + err.message);
  }
  await refreshSessions();
  await bootstrap();
}

initialize();

