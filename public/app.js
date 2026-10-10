const state = {
  result: null,
  artifact: 'netlist',
  running: false,
  toastTimer: null
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

function formPayload() {
  const values = new FormData(form);
  return Object.fromEntries(values.entries());
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
  if (result.topology.id === 'sar_adc') {
    return [
      { label: 'SNR', value: metrics.snr, unit: 'dB', target: 'dynamic range proxy', pass: true, decimals: 2 },
      { label: 'ENOB', value: metrics.enob, unit: 'bits', target: 'target 8 bits', pass: metrics.enob >= 7.5, decimals: 2 },
      { label: 'Decision speed', value: metrics.ugbw, unit: 'MHz', target: '≥ ' + spec.ugbwTarget + ' MHz', pass: metrics.ugbw >= spec.ugbwTarget, decimals: 2 },
      { label: 'Power', value: metrics.power, unit: 'mW', target: '≤ ' + spec.powerTarget + ' mW', pass: metrics.power <= spec.powerTarget, decimals: 3 },
      { label: 'Input noise', value: metrics.noise, unit: 'nV/√Hz', target: '≤ ' + spec.noiseTarget + ' nV/√Hz', pass: metrics.noise <= spec.noiseTarget, decimals: 2 }
    ];
  }
  return [
    { label: 'DC gain', value: metrics.gain, unit: 'dB', target: '≥ ' + spec.gainTarget + ' dB', pass: metrics.gain >= spec.gainTarget, decimals: 1 },
    { label: 'UGBW', value: metrics.ugbw, unit: 'MHz', target: '≥ ' + spec.ugbwTarget + ' MHz', pass: metrics.ugbw >= spec.ugbwTarget, decimals: 2 },
    { label: 'Phase margin', value: metrics.phase, unit: '°', target: '≥ ' + spec.phaseTarget + '°', pass: metrics.phase >= spec.phaseTarget, decimals: 1 },
    { label: 'Power', value: metrics.power, unit: 'mW', target: '≤ ' + spec.powerTarget + ' mW', pass: metrics.power <= spec.powerTarget, decimals: 3 },
    { label: 'Input noise', value: metrics.noise, unit: 'nV/√Hz', target: '≤ ' + spec.noiseTarget + ' nV/√Hz', pass: metrics.noise <= spec.noiseTarget, decimals: 2 }
  ];
}

function renderMetrics(result) {
  target('#metrics-grid').innerHTML = metricDefinitions(result).map((metric) => (
    '<article class="metric-card">'
      + '<div class="metric-label">' + escapeHtml(metric.label) + '</div>'
      + '<div class="metric-value">' + metricText(metric.value, metric.unit, metric.decimals) + '</div>'
      + '<div class="metric-target">' + escapeHtml(metric.target) + '</div>'
      + '<div class="metric-pass ' + (metric.pass ? '' : 'fail') + '">'
      + (metric.pass ? '● constraint met' : '● review required') + '</div>'
    + '</article>'
  )).join('');
  target('#cache-label').innerHTML = result.cache.hit
    ? '<span>◉</span> cache hit · ' + result.cache.savedEvaluations + '개 최적화 평가 재사용'
    : '<span>●</span> ' + result.mode.simulator + ' · cache key ' + result.cache.key;
}

function renderPipeline(result) {
  target('#agent-pipeline').innerHTML = result.agents.map((agent) => (
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
  target('#planner-text').textContent = result.planner.text + actionSuffix;
  target('#iteration-pill').textContent = result.iterationHistory.length + ' optimization records';
}

function renderCandidates(result) {
  target('#candidate-list').innerHTML = result.candidates.map((candidate) => (
    '<article class="candidate-row ' + (candidate.status === 'selected' ? 'selected' : '') + '">'
      + '<div class="candidate-name">'
      + '<strong>' + escapeHtml(candidate.label) + '</strong>'
      + '<small>' + escapeHtml(candidate.templateMatch) + ' · PUCT ' + candidate.puctScore + ' · ' + candidate.visits + ' visits</small>'
      + '</div>'
      + '<div class="candidate-stats"><b>' + Math.round(candidate.feasibility * 100) + '%</b>'
      + '<span>' + (candidate.status === 'selected' ? 'SELECTED' : candidate.status.toUpperCase()) + '</span></div>'
      + '</article>'
  )).join('');
  target('#filter-stat').textContent = result.search.autoCommittedTokens.length + ' auto-committed / '
    + result.search.searchBudget + ' search steps';
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
  const pdgContent = result.pdg.map((step, index) => (
    '<span class="pdg-step">' + (index + 1) + '. ' + escapeHtml(step.id.replace(/_/g, ' ')) + '</span>'
      + (index < result.pdg.length - 1 ? '<span class="pdg-arrow">→</span>' : '')
  )).join('');
  target('#pdg-flow').innerHTML = '<span class="pdg-title">PDG ORDER</span>' + pdgContent;
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
  if (!state.result.verification.exportAllowed) {
    const failed = state.result.constraints
      .filter((constraint) => !constraint.passed)
      .map((constraint) => constraint.label)
      .join(', ');
    return 'EXPORT BLOCKED\n\n미충족 제약: ' + (failed || 'unknown') + '\n'
      + '수치 제약을 모두 통과한 뒤에만 SPICE 넷리스트와 testbench를 내보낼 수 있습니다.\n'
      + '현재 결과는 deterministic local estimator의 검토용 기록입니다.';
  }
  if (state.artifact === 'testbench') return state.result.testbench;
  if (state.artifact === 'variables') return variableArtifact(state.result);
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

function renderAll(result) {
  state.result = result;
  renderTopology(result.topology);
  renderMetrics(result);
  renderPipeline(result);
  renderCandidates(result);
  renderVerification(result);
  renderTrace(result.iterationHistory);
  renderSources(result.sources, result.retrieval);
  renderArtifact();
  target('#session-meta').textContent = result.mode.llm;
}

function startRunAnimation() {
  const pipeline = target('#agent-pipeline');
  pipeline.innerHTML = ['Grounding', 'Topology search', 'Role sizing', 'Critic loop', 'Verifier'].map((label, index) => (
    '<article class="agent-step"><div class="agent-step-icon" style="animation: sheen 1.2s linear infinite">' + (index + 1) + '</div>'
      + '<strong>' + label + '</strong><small>running...</small><div class="agent-state">ACTIVE</div></article>'
  )).join('');
}

async function runDesign(event) {
  if (event) event.preventDefault();
  if (state.running) return;
  state.running = true;
  runButton.disabled = true;
  runButton.innerHTML = '<span class="play-icon">◌</span> 에이전트가 설계 중입니다 <span class="button-shortcut">ESC to wait</span>';
  setRunStatus('에이전트 파이프라인 실행 중', 'RAG → constrained search → sizing → neuro-symbolic verification', true);
  startRunAnimation();

  try {
    const request = fetchJson('/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formPayload())
    });
    const results = await Promise.all([request, pause(540)]);
    renderAll(results[0]);
    const isCached = results[0].cache.hit;
    const verified = results[0].verification.exportAllowed;
    setRunStatus(
      isCached ? '캐시에서 설계 기록 복원' : (verified ? '설계 앵커 준비 완료' : '검증 미통과 · export 차단'),
      isCached
        ? '동일 사양의 최적화 기록을 재사용했습니다.'
        : (verified ? '템플릿·PDG·수치 제약을 통과했습니다.' : '미충족 제약을 조정한 뒤 다시 실행해 주세요.'),
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
  await runDesign();
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

target('#new-session-button').addEventListener('click', () => {
  form.reset();
  updateCircuitLabels();
  state.result = null;
  target('#workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setRunStatus('새 설계 세션', '사양을 조정한 뒤 에이전트 설계를 실행하세요.', false);
  showToast('새 설계 사양으로 초기화했습니다.');
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
});

updateCircuitLabels();
bootstrap();
