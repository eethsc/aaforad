/**
 * EXPLORE-style language-prior guided Monte-Carlo tree search.
 * This module deliberately contains no UI code: callers supply a circuit grammar,
 * action priors, terminal checker and evaluator.
 */

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function keyOf(state) {
  return JSON.stringify(state);
}

function makeNode(state, parent = null, action = null, prior = 1) {
  return {
    state,
    parent,
    action,
    prior,
    visits: 0,
    valueSum: 0,
    children: [],
    expanded: false,
    evaluation: null
  };
}

function score(node, exploration) {
  if (!node.parent) return Infinity;
  const exploitation = node.visits ? node.valueSum / node.visits : 0;
  const bonus = exploration * node.prior
    * Math.sqrt(Math.max(1, node.parent.visits)) / (1 + node.visits);
  return exploitation + bonus;
}

function selectChild(node, exploration) {
  return node.children.reduce((best, child) => (
    score(child, exploration) > score(best, exploration) ? child : best
  ));
}

function backpropagate(node, value) {
  let cursor = node;
  while (cursor) {
    cursor.visits += 1;
    cursor.valueSum += value;
    cursor = cursor.parent;
  }
}

function expand(node, actionsFor, transition, pFilterThreshold) {
  let state = node.state;
  const autoCommitted = [];
  // EXPLORE p-filtering: only grammar actions with a near-certain prior are
  // committed without spending a tree expansion budget.
  for (;;) {
    const actions = actionsFor(state);
    if (!actions.length) break;
    const forced = actions.filter((entry) => entry.prior >= pFilterThreshold);
    if (forced.length !== 1) break;
    const action = forced[0];
    state = transition(state, action);
    autoCommitted.push(action.id);
  }

  if (autoCommitted.length) node.state = state;
  const actions = actionsFor(state);
  node.children = actions.map((action) => makeNode(
    transition(state, action), node, action.id, clamp(action.prior, 0.0001, 0.9999)
  ));
  node.expanded = true;
  return autoCommitted;
}

/**
 * Run PUCT search over an arbitrary finite grammar. `evaluate` must return a
 * normalized reward in [0, 1] for terminal or beam-completed states.
 */
export function runPuctSearch({
  initialState,
  actionsFor,
  transition,
  isTerminal,
  evaluate,
  budget = 48,
  exploration = 1.25,
  pFilterThreshold = 0.99,
  beamWidth = 3
}) {
  const root = makeNode(initialState);
  const autoCommitted = [];
  const completed = new Map();

  for (let iteration = 0; iteration < budget; iteration += 1) {
    let node = root;
    while (node.expanded && node.children.length && !isTerminal(node.state)) {
      node = selectChild(node, exploration);
    }

    if (!isTerminal(node.state) && !node.expanded) {
      autoCommitted.push(...expand(node, actionsFor, transition, pFilterThreshold));
      if (node.children.length) node = selectChild(node, exploration);
    }

    const evaluation = evaluate(node.state, { beamWidth });
    const reward = clamp(Number(evaluation.reward) || 0, 0, 1);
    node.evaluation = evaluation;
    backpropagate(node, reward);

    for (const completion of evaluation.completions || []) {
      const key = keyOf(completion.state);
      const old = completed.get(key);
      if (!old || completion.reward > old.reward) completed.set(key, completion);
    }
  }

  const frontier = [];
  const visit = (node) => {
    if (node !== root && node.evaluation) {
      frontier.push({
        action: node.action,
        state: node.state,
        visits: node.visits,
        value: node.visits ? node.valueSum / node.visits : 0,
        puctScore: score(node, exploration),
        evaluation: node.evaluation
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  frontier.sort((a, b) => b.value - a.value || b.visits - a.visits);

  return {
    rootVisits: root.visits,
    autoCommittedTokens: [...new Set(autoCommitted)],
    frontier: frontier.slice(0, 16),
    completions: [...completed.values()].sort((a, b) => b.reward - a.reward).slice(0, beamWidth)
  };
}
