import { createHash } from 'node:crypto';

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', '및', '위한', '통해', '대한', '기반', '설계', '회로', 'agentic']);

function terms(text) {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[가-힣]{2,}/g) || [])
    .filter((term) => !STOP.has(term)))]
    .slice(0, 80);
}

function id(prefix, text) {
  return prefix + '-' + createHash('sha1').update(text).digest('hex').slice(0, 10);
}

/** Build a compact evidence graph from the local paper synthesis. Nodes are
 * paper sections and technical claims; edges encode containment and shared
 * technical concepts. This is GraphRAG, not a flat lexical top-k list. */
export function buildResearchGraph(markdown) {
  const sections = markdown.split(/(?=^###\s+2\.)/m).filter((section) => /^###\s+2\./m.test(section));
  const nodes = [];
  const edges = [];
  for (const section of sections) {
    const heading = (section.match(/^###\s+(.+)$/m) || [null, 'Unknown'])[1];
    const paperId = id('paper', heading);
    const body = section.replace(/^###.+$/m, '').trim();
    const paper = { id: paperId, type: 'paper', title: heading, text: body, terms: terms(heading + ' ' + body) };
    nodes.push(paper);
    const claims = body.split(/\n\s*\*\s+/).map((entry) => entry.replace(/^\*\s*/, '').trim())
      .filter((entry) => entry.length > 35).slice(0, 14);
    for (const claim of claims) {
      const claimNode = { id: id('claim', heading + claim), type: 'claim', title: claim.slice(0, 96), text: claim, terms: terms(claim) };
      nodes.push(claimNode);
      edges.push({ from: paperId, to: claimNode.id, type: 'contains', weight: 1 });
    }
  }
  const papers = nodes.filter((node) => node.type === 'paper');
  for (let i = 0; i < papers.length; i += 1) {
    for (let j = i + 1; j < papers.length; j += 1) {
      const shared = papers[i].terms.filter((term) => papers[j].terms.includes(term));
      if (shared.length >= 2) edges.push({ from: papers[i].id, to: papers[j].id, type: 'shares-concept', weight: shared.length, concepts: shared.slice(0, 6) });
    }
  }
  return { nodes, edges };
}

export function queryResearchGraph(graph, query, limit = 6) {
  const queryTerms = terms(query);
  const score = (node) => queryTerms.reduce((sum, term) => sum + (node.terms.includes(term) ? 1 : 0), 0);
  const seedNodes = graph.nodes.map((node) => ({ node, score: score(node) })).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title)).slice(0, limit);
  const selected = new Map(seedNodes.map((entry) => [entry.node.id, entry]));
  const paths = [];
  for (const seed of seedNodes) {
    for (const edge of graph.edges.filter((candidate) => candidate.from === seed.node.id || candidate.to === seed.node.id)) {
      const neighborId = edge.from === seed.node.id ? edge.to : edge.from;
      const neighbor = graph.nodes.find((node) => node.id === neighborId);
      if (neighbor && selected.size < limit + 4) selected.set(neighbor.id, { node: neighbor, score: score(neighbor) });
      paths.push({ from: seed.node.title, relation: edge.type, to: neighbor?.title || neighborId, concepts: edge.concepts || [] });
    }
  }
  return {
    queryTerms,
    nodes: [...selected.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(({ node, score: nodeScore }) => ({
      id: node.id, type: node.type, title: node.title, evidence: node.text.slice(0, 420), score: nodeScore
    })),
    paths: paths.slice(0, 10),
    graphStats: { nodes: graph.nodes.length, edges: graph.edges.length }
  };
}
