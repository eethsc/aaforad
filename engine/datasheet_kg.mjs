import { createHash } from 'node:crypto';

const RELATIONS = new Set(['mentions', 'defines', 'specifies', 'measured_under', 'depends_on', 'has_limit', 'has_unit', 'applies_to']);

function stableId(prefix, value) {
  return `${prefix}_${createHash('sha1').update(String(value)).digest('hex').slice(0, 12)}`;
}

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase().replace(/[μµ]/g, 'u').replace(/[^a-z0-9가-힣]+/g, ' ').trim()
    .replace(/\b(?:typical|minimum|maximum|value|voltage|current)\b/g, '').replace(/\s+/g, ' ').trim();
}

function evidenceChunks(text, blocks = []) {
  const fromBlocks = Array.isArray(blocks) ? blocks
    .map((block, index) => ({ id: `ev_block_${index + 1}`, text: String(block.text || block.content || '').replace(/\s+/g, ' ').trim(), page: block.page ?? null }))
    .filter((item) => item.text.length >= 12) : [];
  if (fromBlocks.length) return fromBlocks.slice(0, 120);
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 12);
  const chunks = [];
  for (let index = 0; index < lines.length; index += 3) {
    const joined = lines.slice(index, index + 3).join(' ').slice(0, 700);
    if (joined) chunks.push({ id: `ev_text_${chunks.length + 1}`, text: joined, page: null });
  }
  return chunks.slice(0, 120);
}

function addNode(nodes, node) {
  if (!nodes.some((item) => item.id === node.id)) nodes.push(node);
}

function addEdge(edges, edge) {
  if (!edges.some((item) => item.from === edge.from && item.to === edge.to && item.type === edge.type)) edges.push(edge);
}

/** GT2KG-like evidence-first graph. This never infers a relation without a
 * source chunk; the LLM enrichment layer may only attach to these chunks. */
export function buildEvidenceKnowledgeGraph({ fileName, text, requirements = [], globalConditions = [], layout = {}, classification = null }) {
  const nodes = [];
  const edges = [];
  const documentId = stableId('document', fileName || 'datasheet');
  addNode(nodes, { id: documentId, type: 'document', label: fileName || 'datasheet' });
  const chunks = evidenceChunks(text, layout.blocks);
  for (const chunk of chunks) {
    addNode(nodes, { ...chunk, type: 'evidence' });
    addEdge(edges, { from: documentId, to: chunk.id, type: 'contains', evidence: [chunk.id], confidence: 1 });
  }
  const sourceFor = (source) => chunks.find((chunk) => chunk.text.includes(String(source || '').slice(0, 48)))?.id || chunks[0]?.id || null;
  for (const requirement of requirements) {
    const metricLabel = String(requirement.metric || 'unclassified requirement');
    const metricId = stableId('metric', normalizeLabel(metricLabel));
    const assertionId = stableId('assertion', `${requirement.id}|${metricLabel}|${requirement.operator}|${requirement.value}|${requirement.unit}`);
    const evidence = sourceFor(requirement.source);
    addNode(nodes, { id: metricId, type: 'metric', label: metricLabel, canonical: normalizeLabel(metricLabel) });
    addNode(nodes, { id: assertionId, type: 'assertion', label: `${metricLabel} ${requirement.operator} ${requirement.value} ${requirement.unit || ''}`.trim(), requirementId: requirement.id, adapter: requirement.adapter?.metric || null, evidence: evidence ? [evidence] : [] });
    addEdge(edges, { from: documentId, to: assertionId, type: 'specifies', evidence: evidence ? [evidence] : [], confidence: 1 });
    addEdge(edges, { from: assertionId, to: metricId, type: 'applies_to', evidence: evidence ? [evidence] : [], confidence: 1 });
    if (evidence) addEdge(edges, { from: evidence, to: assertionId, type: 'supports', evidence: [evidence], confidence: 1 });
    for (const condition of requirement.conditions || []) {
      const conditionId = stableId('condition', `${condition.id}|${condition.value}|${condition.unit}`);
      addNode(nodes, { id: conditionId, type: 'condition', label: `${condition.label || condition.id}=${condition.value} ${condition.unit || ''}`.trim(), canonical: normalizeLabel(condition.id) });
      addEdge(edges, { from: assertionId, to: conditionId, type: 'measured_under', evidence: evidence ? [evidence] : [], confidence: 1 });
    }
  }
  for (const condition of globalConditions) {
    const conditionId = stableId('condition', `${condition.id}|${condition.value}|${condition.unit}`);
    addNode(nodes, { id: conditionId, type: 'condition', label: `${condition.label || condition.id}=${condition.value} ${condition.unit || ''}`.trim(), canonical: normalizeLabel(condition.id) });
  }
  if (classification?.circuit) {
    const familyId = stableId('circuit_family', classification.circuit);
    addNode(nodes, { id: familyId, type: 'circuit_family', label: classification.circuit, evidence: classification.evidence || null });
    addEdge(edges, { from: documentId, to: familyId, type: 'defines', evidence: chunks[0] ? [chunks[0].id] : [], confidence: classification.confidence === 'high' ? 0.9 : 0.5 });
  }
  return clusterKnowledgeGraph({ nodes, edges, mode: 'deterministic-evidence' });
}

/** KGGen-style entity/edge consolidation. Canonicalization is deterministic,
 * so it cannot turn unrelated supplier wording into a new electrical fact. */
export function clusterKnowledgeGraph(graph) {
  const representative = new Map();
  const aliases = new Map();
  const idMap = new Map();
  const nodes = [];
  for (const node of graph.nodes || []) {
    const key = ['metric', 'condition', 'circuit_family'].includes(node.type)
      ? `${node.type}|${node.canonical || normalizeLabel(node.label)}` : `${node.type}|${node.id}`;
    if (!representative.has(key)) {
      representative.set(key, node);
      aliases.set(node.id, [node.label]);
      nodes.push(node);
    } else {
      const existing = representative.get(key);
      aliases.get(existing.id).push(node.label);
      idMap.set(node.id, existing.id);
    }
  }
  const edges = [];
  for (const edge of graph.edges || []) {
    const normalized = { ...edge, from: idMap.get(edge.from) || edge.from, to: idMap.get(edge.to) || edge.to };
    addEdge(edges, normalized);
  }
  for (const node of nodes) {
    const names = [...new Set(aliases.get(node.id) || [])];
    if (names.length > 1) node.aliases = names;
  }
  return {
    ...graph,
    nodes,
    edges,
    clustering: { entityCountBefore: (graph.nodes || []).length, entityCountAfter: nodes.length, edgeCountBefore: (graph.edges || []).length, edgeCountAfter: edges.length }
  };
}

function validateLlmGraph(output, evidenceIds) {
  const entities = Array.isArray(output?.entities) ? output.entities.slice(0, 80) : [];
  const relations = Array.isArray(output?.relations) ? output.relations.slice(0, 160) : [];
  const normalizedEntities = entities.filter((entity) => entity && typeof entity.name === 'string' && typeof entity.type === 'string')
    .map((entity) => ({ name: entity.name.slice(0, 120), type: entity.type.slice(0, 40), canonical: normalizeLabel(entity.canonical || entity.name), evidence: (Array.isArray(entity.evidence) ? entity.evidence : []).filter((id) => evidenceIds.has(id)) }));
  const names = new Set(normalizedEntities.map((entity) => entity.name));
  const normalizedRelations = relations.filter((relation) => relation && names.has(relation.source) && names.has(relation.target) && RELATIONS.has(relation.type))
    .map((relation) => ({ ...relation, evidence: (Array.isArray(relation.evidence) ? relation.evidence : []).filter((id) => evidenceIds.has(id)) }))
    .filter((relation) => relation.evidence.length > 0);
  return { entities: normalizedEntities, relations: normalizedRelations };
}

/** LLMGraphTransformer-inspired enrichment. The model proposes semantic
 * relations, but evidence identifiers are validated before graph mutation. */
export async function enrichKnowledgeGraphWithLlm(graph, callAgent) {
  if (typeof callAgent !== 'function') return { ...graph, enrichment: { mode: 'deterministic-evidence', reason: 'LLM graph transformer unavailable' } };
  const evidence = (graph.nodes || []).filter((node) => node.type === 'evidence').slice(0, 48).map(({ id, text, page }) => ({ id, page, text: String(text).slice(0, 650) }));
  if (!evidence.length) return { ...graph, enrichment: { mode: 'deterministic-evidence', reason: 'No evidence chunks' } };
  const result = await callAgent({
    name: 'DataSheetGraphTransformer',
    system: 'You transform analog IC datasheet evidence into a knowledge graph. Extract only facts stated by cited evidence chunks. Do not infer electrical limits, topology, or test conditions. Reuse exact entity names from evidence where possible.',
    prompt: `Evidence chunks: ${JSON.stringify(evidence)}\nReturn JSON {"entities":[{"name":"string","canonical":"string","type":"metric|condition|component|pin|circuit_family","evidence":["ev_id"]}],"relations":[{"source":"entity name","target":"entity name","type":"defines|specifies|measured_under|depends_on|has_limit|has_unit|applies_to|mentions","evidence":["ev_id"]}]}. Every relation must cite at least one evidence id.`,
    schema: 'datasheet-evidence-graph-v1',
    temperature: 0
  });
  const validated = validateLlmGraph(result.output, new Set(evidence.map((item) => item.id)));
  const nodes = [...(graph.nodes || [])];
  const edges = [...(graph.edges || [])];
  const byName = new Map();
  for (const entity of validated.entities) {
    const entityId = stableId('semantic', `${entity.type}|${entity.canonical}`);
    byName.set(entity.name, entityId);
    addNode(nodes, { id: entityId, type: entity.type, label: entity.name, canonical: entity.canonical, evidence: entity.evidence, provenance: 'llm-evidence-grounded' });
    for (const evidenceId of entity.evidence) addEdge(edges, { from: evidenceId, to: entityId, type: 'mentions', evidence: [evidenceId], confidence: 0.7, provenance: 'llm-evidence-grounded' });
  }
  for (const relation of validated.relations) {
    const from = byName.get(relation.source);
    const to = byName.get(relation.target);
    if (from && to) addEdge(edges, { from, to, type: relation.type, evidence: relation.evidence, confidence: 0.7, provenance: 'llm-evidence-grounded' });
  }
  const clustered = clusterKnowledgeGraph({ nodes, edges, mode: 'llm-evidence-grounded' });
  return { ...clustered, enrichment: { mode: 'LLMGraphTransformer + KGGen clustering', model: result.model, generatedRelations: validated.relations.length, generatedEntities: validated.entities.length } };
}
