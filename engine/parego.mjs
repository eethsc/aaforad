/** Lightweight, dependency-free ParEGO implementation (augmented Chebyshev
 * scalarisation + RBF surrogate + lower-confidence-bound acquisition). */

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function hashFraction(seed, index) {
  let value = 2166136261;
  const text = `${seed}:${index}`;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return ((value >>> 0) + 0.5) / 4294967296;
}

function halton(index, base) {
  let fraction = 1;
  let result = 0;
  let value = index + 1;
  while (value > 0) {
    fraction /= base;
    result += fraction * (value % base);
    value = Math.floor(value / base);
  }
  return result;
}

function distanceSquared(left, right) {
  return left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
}

function normaliseObjectives(records) {
  const width = records[0].objectives.length;
  const mins = Array.from({ length: width }, (_, index) => Math.min(...records.map((r) => r.objectives[index])));
  const maxs = Array.from({ length: width }, (_, index) => Math.max(...records.map((r) => r.objectives[index])));
  return records.map((record) => ({
    ...record,
    normalised: record.objectives.map((value, index) => {
      const span = maxs[index] - mins[index];
      return span < 1e-9 ? 0 : (value - mins[index]) / span;
    })
  }));
}

function scalarise(record, weights) {
  const weighted = record.normalised.map((value, index) => weights[index] * value);
  return Math.max(...weighted) + 0.05 * weighted.reduce((sum, value) => sum + value, 0);
}

function predict(candidate, samples, weights) {
  const bandwidth = 0.18;
  let weightedSum = 0;
  let mass = 0;
  for (const sample of samples) {
    const kernel = Math.exp(-distanceSquared(candidate, sample.point) / (2 * bandwidth * bandwidth));
    weightedSum += kernel * scalarise(sample, weights);
    mass += kernel;
  }
  const mean = mass > 1e-10 ? weightedSum / mass : 1;
  // Small density means large uncertainty; this is the exploration term of LCB.
  const uncertainty = 1 / Math.sqrt(1 + mass * samples.length);
  return { mean, uncertainty };
}

export function runParEgo({ bounds, evaluate, iterations = 12, initialSamples = 5, seed = 'fusion' }) {
  const dimensions = bounds.length;
  const points = [];
  const toActual = (normalised) => normalised.map((value, index) => (
    bounds[index].min + clamp(value, 0, 1) * (bounds[index].max - bounds[index].min)
  ));
  const objectiveCount = 4;
  const weights = Array.from({ length: objectiveCount }, (_, index) => 0.1 + hashFraction(seed, index));
  const sum = weights.reduce((total, value) => total + value, 0);
  const normalizedWeights = weights.map((value) => value / sum);

  const add = (point, stage) => {
    const result = evaluate(toActual(point));
    points.push({ point, objectives: result.objectives, payload: result.payload, stage });
  };
  for (let index = 0; index < Math.min(initialSamples, iterations); index += 1) {
    add(Array.from({ length: dimensions }, (_, dimension) => halton(index, [2, 3, 5, 7][dimension])), 'sobol-like initial');
  }

  while (points.length < iterations) {
    const samples = normaliseObjectives(points);
    let selected = null;
    let selectedAcquisition = Infinity;
    for (let candidateIndex = 0; candidateIndex < 96; candidateIndex += 1) {
      const point = Array.from({ length: dimensions }, (_, dimension) => (
        (halton(candidateIndex + points.length * 7, [2, 3, 5, 7][dimension])
          + hashFraction(seed, candidateIndex * 11 + dimension) * 0.04) % 1
      ));
      const prediction = predict(point, samples, normalizedWeights);
      const lcb = prediction.mean - 0.45 * prediction.uncertainty;
      if (lcb < selectedAcquisition) {
        selectedAcquisition = lcb;
        selected = point;
      }
    }
    add(selected, 'RBF-LCB proposal');
  }

  const normalised = normaliseObjectives(points);
  const ranked = normalised.map((record) => ({ ...record, scalar: scalarise(record, normalizedWeights) }))
    .sort((left, right) => left.scalar - right.scalar);
  return {
    weights: normalizedWeights,
    best: ranked[0],
    trace: ranked.map((record, index) => ({
      iteration: index + 1,
      stage: record.stage,
      scalar: Number(record.scalar.toFixed(5)),
      objectives: record.objectives
    }))
  };
}
