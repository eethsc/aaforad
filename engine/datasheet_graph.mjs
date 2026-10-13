import { createHash } from 'node:crypto';

/**
 * Datasheet Knowledge Graph (DKG) Builder & GraphRAG Engine
 * 
 * Inspired by recent ArXiv papers:
 * - AnalogVerifier (Neuro-symbolic verification with Port Dependency Graphs)
 * - AaLLM (Multi-view knowledge graphs from domain literature & specs)
 * - Multimodal Hardware Datasheet GraphRAG & Entity-Relation Extraction
 */

function makeId(type, name) {
  const hash = createHash('sha1').update(`${type}:${name}`).digest('hex').slice(0, 8);
  return `${type}-${hash}`;
}

/**
 * Construct a comprehensive Datasheet Knowledge Graph from structured or semi-structured datasheet content.
 * Extracts Pins, Functional Subcircuits, Electrical Specs, and Operating Conditions,
 * and links them with directional causal and dependency edges.
 */
export function buildDatasheetGraph(datasheetData = {}) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  function addNode(node) {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, node);
      nodes.push(node);
    }
    return nodeMap.get(node.id);
  }

  function addEdge(edge) {
    edges.push(edge);
  }

  const title = datasheetData.title || datasheetData.filename || 'Datasheet';
  const rootId = makeId('doc', title);
  const rootNode = addNode({
    id: rootId,
    type: 'Document',
    label: title,
    properties: {
      circuitFamily: datasheetData.detectedCircuit || 'analog_circuit',
      rawTextLength: datasheetData.text ? datasheetData.text.length : 0
    }
  });

  const text = datasheetData.text || '';
  const requirements = datasheetData.requirements || [];
  const tables = datasheetData.tables || [];

  // 1. PIN & PORT EXTRACTION
  const pinPatterns = [
    /\b(VIN|VCC|VDD|INP?|IN\+|IN\-|VINP|VINN|VSS|GND|OUT|VOUT|FB|COMP|EN|ENABLE|SHDN|BIAS|VREF|SW|BST|BOOT|ILIM|NC|GATE|DRAIN|SOURCE)\b/gi,
    /\bPin\s+(\d+)[\s:]+([A-Z0-9_\+\-]+)/gi
  ];

  const foundPins = new Set();
  // Regex pin scan
  let match;
  const pinRegex = /\b(VIN|VCC|VDD|VIN\+|VIN\-|IN\+|IN\-|VOUT|OUT|FB|COMP|EN|ENABLE|BIAS|VREF|SW|BST|BOOT|GND|VSS)\b/gi;
  while ((match = pinRegex.exec(text)) !== null) {
    foundPins.add(match[1].toUpperCase());
  }

  // Ensure essential power/ground pins
  if (foundPins.size === 0) {
    ['VIN', 'VOUT', 'GND', 'FB'].forEach((p) => foundPins.add(p));
  }

  for (const pinName of foundPins) {
    const pinId = makeId('pin', pinName);
    const pinNode = addNode({
      id: pinId,
      type: 'Pin',
      label: pinName,
      properties: {
        isPower: ['VIN', 'VCC', 'VDD', 'VSS', 'GND'].includes(pinName),
        isGround: ['GND', 'VSS'].includes(pinName),
        isSignal: ['IN', 'IN+', 'IN-', 'VIN+', 'VIN-', 'OUT', 'VOUT', 'FB', 'COMP'].includes(pinName)
      }
    });
    addEdge({ from: rootId, to: pinId, type: 'HAS_PIN', weight: 1 });
  }

  // 2. FUNCTIONAL SUBCIRCUITS EXTRACTION
  const subcircuitSignatures = [
    { name: 'Bandgap Reference', keywords: ['bandgap', 'vref', 'reference voltage', 'internal reference'], defaultPin: 'VREF' },
    { name: 'Error Amplifier', keywords: ['error amp', 'error amplifier', 'op-amp', 'transconductance', 'ota', 'diff pair'], defaultPin: 'COMP' },
    { name: 'Power Pass Device', keywords: ['pass element', 'pass transistor', 'pass fet', 'power pmos', 'power nmos', 'ldo pass'], defaultPin: 'VOUT' },
    { name: 'Current Mirror / Bias', keywords: ['current mirror', 'bias current', 'tail current', 'current source'], defaultPin: 'BIAS' },
    { name: 'Feedback Divider', keywords: ['feedback', 'resistor divider', 'voltage divider', 'rfb', 'r1', 'r2'], defaultPin: 'FB' },
    { name: 'Frequency Compensation', keywords: ['compensation', 'miller capacitor', 'pole-zero', 'phase margin'], defaultPin: 'COMP' },
    { name: 'Comparator', keywords: ['comparator', 'hysteresis', 'trigger', 'strongarm'], defaultPin: 'OUT' },
    { name: 'Charge Pump', keywords: ['charge pump', 'dickson', 'flying capacitor', 'multiplier'], defaultPin: 'SW' },
    { name: 'Gate Driver / Level Shifter', keywords: ['gate driver', 'level shifter', 'bootstrap driver', 'dead time'], defaultPin: 'SW' }
  ];

  const detectedBlocks = [];
  const detectedCircuitStr = typeof datasheetData.detectedCircuit === 'string'
    ? datasheetData.detectedCircuit
    : (datasheetData.detectedCircuit?.circuit || datasheetData.detectedCircuit?.family || '');

  for (const sub of subcircuitSignatures) {
    const isPresent = sub.keywords.some((kw) => text.toLowerCase().includes(kw)) ||
      (detectedCircuitStr && sub.keywords.some((kw) => detectedCircuitStr.toLowerCase().includes(kw)));

    if (isPresent) {
      detectedBlocks.push(sub);
      const subId = makeId('sub', sub.name);
      addNode({
        id: subId,
        type: 'Subcircuit',
        label: sub.name,
        properties: { keywords: sub.keywords }
      });
      addEdge({ from: rootId, to: subId, type: 'CONTAINS_BLOCK', weight: 1 });

      // Link subcircuit to associated pin if exists
      for (const pinName of foundPins) {
        if (pinName.includes(sub.defaultPin) || (sub.defaultPin && pinName === sub.defaultPin)) {
          addEdge({ from: subId, to: makeId('pin', pinName), type: 'INTERFACES_WITH', weight: 2 });
        }
      }
    }
  }

  // Topological connections between subcircuits (Internal signal flow)
  const blockNames = detectedBlocks.map((b) => b.name);
  if (blockNames.includes('Bandgap Reference') && blockNames.includes('Error Amplifier')) {
    addEdge({ from: makeId('sub', 'Bandgap Reference'), to: makeId('sub', 'Error Amplifier'), type: 'PROVIDES_REFERENCE_TO', weight: 2 });
  }
  if (blockNames.includes('Error Amplifier') && blockNames.includes('Power Pass Device')) {
    addEdge({ from: makeId('sub', 'Error Amplifier'), to: makeId('sub', 'Power Pass Device'), type: 'DRIVES_GATE_OF', weight: 3 });
  }
  if (blockNames.includes('Power Pass Device') && blockNames.includes('Feedback Divider')) {
    addEdge({ from: makeId('sub', 'Power Pass Device'), to: makeId('sub', 'Feedback Divider'), type: 'FEEDBACK_OUTPUT', weight: 2 });
  }
  if (blockNames.includes('Feedback Divider') && blockNames.includes('Error Amplifier')) {
    addEdge({ from: makeId('sub', 'Feedback Divider'), to: makeId('sub', 'Error Amplifier'), type: 'FEEDS_ERROR_SIGNAL_TO', weight: 3 });
  }

  // 3. ELECTRICAL SPECIFICATIONS & CONDITIONS
  const specList = requirements.length > 0 ? requirements : (datasheetData.specLedger || []);
  for (const req of specList) {
    const metricName = req.metric || req.label || req.name || 'Unknown_Metric';
    const specId = makeId('spec', metricName + (req.operator || '') + (req.value || ''));
    
    addNode({
      id: specId,
      type: 'Specification',
      label: `${metricName} ${req.operator || ''} ${req.value ?? ''} ${req.unit || ''}`.trim(),
      properties: {
        metric: metricName,
        operator: req.operator || '>=',
        value: req.value,
        unit: req.unit,
        testType: req.testType || 'ac'
      }
    });

    addEdge({ from: rootId, to: specId, type: 'DEFINES_SPEC', weight: 1 });

    // Link spec to relevant functional subcircuit
    const lowerMetric = metricName.toLowerCase();
    for (const block of detectedBlocks) {
      if (
        (lowerMetric.includes('gain') || lowerMetric.includes('ugbw') || lowerMetric.includes('bandwidth') || lowerMetric.includes('offset')) && block.name === 'Error Amplifier' ||
        (lowerMetric.includes('dropout') || lowerMetric.includes('load reg') || lowerMetric.includes('current limit')) && block.name === 'Power Pass Device' ||
        (lowerMetric.includes('vref') || lowerMetric.includes('tempco')) && block.name === 'Bandgap Reference' ||
        (lowerMetric.includes('phase margin') || lowerMetric.includes('stability')) && block.name === 'Frequency Compensation'
      ) {
        addEdge({ from: makeId('sub', block.name), to: specId, type: 'GOVERNED_BY', weight: 2 });
      }
    }

    // Link operating conditions
    if (req.conditions && Array.isArray(req.conditions)) {
      for (const cond of req.conditions) {
        const condId = makeId('cond', cond);
        addNode({
          id: condId,
          type: 'Condition',
          label: cond,
          properties: { conditionString: cond }
        });
        addEdge({ from: specId, to: condId, type: 'TESTED_UNDER', weight: 1 });
      }
    }
  }

  // 4. PORT DEPENDENCY GRAPH (AnalogVerifier PDG)
  // Derive causal dependency edges among pins and specs
  for (const pinA of foundPins) {
    for (const pinB of foundPins) {
      if (pinA === pinB) continue;
      // Power rails precede everything
      if (['VIN', 'VDD', 'VCC'].includes(pinA) && !['VIN', 'VDD', 'VCC', 'GND', 'VSS'].includes(pinB)) {
        addEdge({ from: makeId('pin', pinA), to: makeId('pin', pinB), type: 'PDG_PRECEDES', weight: 1, reason: 'Power rail energization order' });
      }
      // Reference precedes inputs and control
      if (pinA === 'VREF' && ['FB', 'IN+', 'IN-'].includes(pinB)) {
        addEdge({ from: makeId('pin', pinA), to: makeId('pin', pinB), type: 'PDG_PRECEDES', weight: 1, reason: 'Reference establishment' });
      }
      // Input precedes Output
      if (['IN+', 'IN-', 'VINP', 'VINN', 'FB'].includes(pinA) && ['OUT', 'VOUT'].includes(pinB)) {
        addEdge({ from: makeId('pin', pinA), to: makeId('pin', pinB), type: 'PDG_PRECEDES', weight: 2, reason: 'Forward signal propagation' });
      }
    }
  }

  return {
    title,
    graphStats: {
      nodes: nodes.length,
      edges: edges.length,
      pins: foundPins.size,
      subcircuits: detectedBlocks.length,
      specs: specList.length
    },
    nodes,
    edges
  };
}

/**
 * Query the Datasheet Knowledge Graph with natural language or parametric queries.
 * Returns grounded entity subgraphs, causal paths, and architectural guidelines.
 */
export function queryDatasheetGraph(graph, queryText, limit = 8) {
  if (!graph || !graph.nodes) return { matchedNodes: [], paths: [], architecturalSummary: '' };

  const queryTerms = queryText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const scoredNodes = graph.nodes.map((node) => {
    let score = 0;
    const labelLower = node.label.toLowerCase();
    for (const term of queryTerms) {
      if (labelLower.includes(term)) score += 3;
      if (node.properties && JSON.stringify(node.properties).toLowerCase().includes(term)) score += 1;
    }
    return { node, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  const topNodes = scoredNodes.slice(0, limit).map((item) => item.node);
  const topNodeIds = new Set(topNodes.map((n) => n.id));

  // Find relevant paths connecting top nodes
  const relevantEdges = graph.edges.filter((e) => topNodeIds.has(e.from) || topNodeIds.has(e.to));
  const paths = relevantEdges.slice(0, 12).map((e) => {
    const fromNode = graph.nodes.find((n) => n.id === e.from);
    const toNode = graph.nodes.find((n) => n.id === e.to);
    return `${fromNode?.label || e.from} --[${e.type}]--> ${toNode?.label || e.to}`;
  });

  const subcircuitNodes = graph.nodes.filter((n) => n.type === 'Subcircuit').map((n) => n.label);
  const pinNodes = graph.nodes.filter((n) => n.type === 'Pin').map((n) => n.label);
  const specNodes = graph.nodes.filter((n) => n.type === 'Specification').map((n) => n.label);

  const architecturalSummary = [
    `Datasheet Knowledge Graph: ${graph.title}`,
    `Recognized Functional Subcircuits: ${subcircuitNodes.join(', ') || 'Standard Core'}`,
    `Extracted Interface Pins: ${pinNodes.join(', ')}`,
    `Core Specifications: ${specNodes.slice(0, 6).join('; ') || 'Standard Bounds'}`
  ].join('\n');

  return {
    matchedNodes: topNodes,
    relevantEdges,
    paths,
    architecturalSummary
  };
}
