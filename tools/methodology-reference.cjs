// Independent arithmetic examples of cited equations, not the production estimator.
const profiles = require('../registry/text-reference-profiles-2026-09-09.json');
const constants = Object.fromEntries(Object.entries(profiles.coefficients).map(([key, value]) => [key, Number(value)]));

function positive(value, name, integer = false) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) throw new Error('Invalid ' + name);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isSafeInteger(number))) throw new Error('Invalid positive ' + name);
  return number;
}

function nullableFactor(value, name) {
  if (value === null || value === undefined) return null;
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) throw new Error('Invalid ' + name);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Invalid ' + name);
  return number;
}

function textReference(candidate, outputTokens, overrides = {}) {
  const n = positive(outputTokens, 'output-token count', true);
  const active = positive(candidate.activeBillions, 'active parameters');
  const total = positive(candidate.totalBillions, 'total parameters');
  const defaults = profiles.reference_settings;
  const batch = positive(overrides.batchSize ?? defaults.batchSize, 'batch size', true);
  const precision = positive(overrides.precisionBits ?? defaults.precisionBits, 'precision', true);
  const memory = positive(defaults.gpuMemoryGb, 'GPU memory');
  if (active > total || total > 200 || batch > 512 || precision !== 16) throw new Error('Outside the reduced text-reference cohort domain');
  const memoryGb = Number(defaults.memoryMultiplier) * total * precision / 8;
  const gpuCount = 2 ** Math.ceil(Math.log2(Math.ceil(memoryGb / memory)));
  const gpuWhPerToken = constants.energyAlpha * Math.exp(constants.energyBeta * batch) * active + constants.energyGamma;
  const oneGpuKwh = n * gpuWhPerToken / 1000;
  let duration = n * (constants.latencyAlpha * active + constants.latencyBeta * batch + constants.latencyGamma);
  let durationStrategy = 'regression_uncapped_reference';
  if (overrides.tokensPerSecond !== undefined) {
    duration = n / positive(overrides.tokensPerSecond, 'throughput');
    durationStrategy = 'throughput_reference';
  }
  if (overrides.timeToFirstToken !== undefined) duration += nullableFactor(overrides.timeToFirstToken, 'first-token time');
  if (overrides.requestDuration !== undefined) {
    duration = Math.min(duration, positive(overrides.requestDuration, 'request-duration cap'));
    durationStrategy += '_request_capped';
  }
  const hostKwh = duration / 3600 * Number(defaults.hostPowerKw) * (gpuCount / Number(defaults.serverGpuCount)) / batch;
  return { profileId: candidate.id, outputTokens: n, memoryGb, gpuCount, durationSeconds: duration, durationStrategy,
    oneGpuKwh, gpuKwh: gpuCount * oneGpuKwh, hostKwh, itKwh: hostKwh + gpuCount * oneGpuKwh };
}

function environmentalAllocation(energy, scenario) {
  if (!['it', 'facility', 'gpu_component'].includes(energy.boundary)) throw new Error('Unknown electricity boundary');
  const value = positive(energy.kwh, 'reference electricity');
  const pue = nullableFactor(scenario.pue, 'PUE');
  if (pue !== null && pue < 1) throw new Error('PUE cannot be below one');
  const itKwh = energy.boundary === 'facility' ? (pue === null ? null : value / pue) : value;
  const facilityKwh = energy.boundary === 'facility' ? value : (pue === null ? null : value * pue);
  const carbon = nullableFactor(scenario.carbonGramsPerKwh, 'carbon factor');
  const direct = nullableFactor(scenario.directWueLitresPerItKwh, 'direct consumptive WUE');
  const upstream = nullableFactor(scenario.electricityWaterLitresPerKwh, 'electricity consumptive water');
  if (scenario.waterKind !== undefined && scenario.waterKind !== 'consumption') throw new Error('Water withdrawal is not consumption');
  const directLitres = itKwh === null || direct === null ? null : itKwh * direct;
  const upstreamLitres = facilityKwh === null || upstream === null ? null : facilityKwh * upstream;
  const scope = { it: 'modelled_it_reference', facility: 'modelled_facility_reference', gpu_component: 'gpu_associated_reference' }[energy.boundary];
  return { scenarioId: scenario.id, scope,
    itKwh, facilityKwh, carbonGrams: facilityKwh === null || carbon === null ? null : facilityKwh * carbon,
    directLitres, upstreamLitres, totalLitres: directLitres === null || upstreamLitres === null ? null : directLitres + upstreamLitres };
}

function highestComparable(candidates, request) {
  validateSignature(request);
  for (const candidate of candidates) validateSignature(candidate);
  const eligible = candidates.filter(candidate => candidate.modality === request.modality && candidate.scope === request.scope && candidate.scenarioId === request.scenarioId && candidate.workloadKey === request.workloadKey);
  if (!eligible.length) return { status: 'no_comparable_profile', selected: null };
  validateIds(eligible);
  for (const candidate of eligible) positive(candidate.facilityKwh, 'candidate electricity');
  const sorted = [...eligible].sort((a, b) => b.facilityKwh - a.facilityKwh || compareIds(a, b));
  return { status: 'highest_comparable_estimate', selected: structuredClone(sorted[0]), eligibleCount: eligible.length };
}

function validateSignature(value) {
  for (const key of ['modality', 'scope', 'scenarioId', 'workloadKey']) {
    if (typeof value?.[key] !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(value[key])) throw new Error('Incomplete or invalid comparator signature: ' + key);
  }
}

function compareIds(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function validateIds(candidates) {
  if (candidates.some(candidate => typeof candidate.id !== 'string' || !/^[a-z0-9.-]+$/.test(candidate.id)) || new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) {
    throw new Error('Invalid or duplicate reference profile ID');
  }
}

module.exports = { textReference, environmentalAllocation, highestComparable };
