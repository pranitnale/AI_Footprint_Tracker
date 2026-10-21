// Keep the published examples tied to the reviewed numeric snapshots.
const crypto = require('node:crypto');
const { textReference, environmentalAllocation } = require('./methodology-reference.cjs');

const pinnedDigests = {
  text: '52812489ab373a7694af783d6f542bee27b6c06c976bd4e3e9b22b7716d6861f',
  published: 'deb5a6377331846ff75b45fe1a848d43dd52bf69f080e982ca75255b9e96a7e2',
};

function verifyReferencePayloads(text) {
  const actual = crypto.createHash('sha256').update(JSON.stringify(text)).digest('hex');
  if (actual !== pinnedDigests.text) throw new Error('Reviewed text registry changed. Review sources, examples and method version before updating its digest.');
}

function rowsFor(html, caption) {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].find(match => match[1].includes('<caption>' + caption + '</caption>'));
  if (!table) throw new Error('Missing calculation table: ' + caption);
  return new Map([...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1].replace(/<[^>]+>/g, '').trim())
  ).filter(cells => cells.length).map(cells => [cells[0], cells.slice(1)]));
}

function requireCell(rows, label, expected, index = 0) {
  if (rows.get(label)?.[index] !== expected) throw new Error('Methodology numeric mismatch: ' + label);
}

function validateMethodologyNumerics(html, text) {
  verifyReferencePayloads(text);
  const coefficients = rowsFor(html, 'Published regression coefficients from the pinned EcoLogits kernel');
  const symbols = { energyAlpha: 'a_E', energyBeta: 'b_E', energyGamma: 'c_E', latencyAlpha: 'a_L', latencyBeta: 'b_L', latencyGamma: 'c_L' };
  const superscript = character => ({ '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' })[character];
  for (const [key, symbol] of Object.entries(symbols)) {
    const formatted = text.coefficients[key].replace(/e(-?\d+)/, (_, exponent) => ' × 10' + [...exponent].map(superscript).join('')).replace(/^-/, '−');
    requireCell(coefficients, symbol, formatted);
  }

  const source = text.candidates.find(candidate => candidate.id === 'command-a-03-2025-h100-reference');
  const settings = text.reference_settings, environment = text.environment_scenario;
  const inputs = rowsFor(html, 'Defined inputs and their provenance');
  requireCell(inputs, 'Output tokens', '1,000');
  requireCell(inputs, 'Active / total parameters', source.activeBillions + ' / ' + source.totalBillions + ' billion');
  requireCell(inputs, 'Precision, batch, GPU memory', settings.precisionBits + ' bits, ' + settings.batchSize + ' requests, ' + settings.gpuMemoryGb + ' GB');
  requireCell(inputs, 'Host power / reference GPUs', settings.hostPowerKw + ' kW / ' + settings.serverGpuCount);
  requireCell(inputs, 'PUE / direct WUE', environment.pue + ' / ' + environment.directWueLitresPerItKwh + ' L/kWh_IT');
  requireCell(inputs, 'Electricity carbon factor', (Number(environment.carbonGramsPerKwh) / 1000).toFixed(4) + ' kg/kWh = ' + environment.carbonGramsPerKwh + ' g/kWh');
  requireCell(inputs, 'Electricity water factor', environment.electricityWaterLitresPerKwh + ' L/kWh');

  const energy = textReference(source, 1000);
  const allocation = environmentalAllocation({ boundary: 'it', kwh: energy.itKwh }, environment);
  const worked = rowsFor(html, 'Derived results using the equations above, rounded here for readability');
  const values = {
    'One GPU electricity': [energy.oneGpuKwh * 1000, 'Wh'],
    'All allocated GPU electricity': [energy.gpuKwh * 1000, 'Wh'],
    'Non-GPU host electricity': [energy.hostKwh * 1000, 'Wh'],
    'IT electricity': [energy.itKwh * 1000, 'Wh'],
    'Facility electricity': [allocation.facilityKwh * 1000, 'Wh'],
    'Electricity-related emissions': [allocation.carbonGrams, 'g CO₂e'],
    'Direct cooling water': [allocation.directLitres * 1000, 'mL'],
    'Electricity-supply water': [allocation.upstreamLitres * 1000, 'mL'],
    'Total water': [allocation.totalLitres * 1000, 'mL'],
  };
  for (const [label, [value, unit]] of Object.entries(values)) requireCell(worked, label, value.toFixed(7) + ' ' + unit);

  const cohortRows = rowsFor(html, 'Illustrative common-scenario comparison for the same 1,000-output-token workload');
  const labels = ['Meta Llama 3.1 8B Instruct', 'Meta Llama 3.1 70B Instruct', 'Cohere Command R+ 08-2024', 'Cohere Command A 03-2025'];
  if (cohortRows.size !== text.candidates.length) throw new Error('Text cohort table is incomplete');
  text.candidates.forEach((candidate, index) => {
    const result = environmentalAllocation({ boundary: 'it', kwh: textReference(candidate, 1000).itKwh }, environment);
    requireCell(cohortRows, labels[index], candidate.totalBillions + ' billion');
    requireCell(cohortRows, labels[index], '≈ ' + (result.facilityKwh * 1000).toFixed(7) + ' Wh', 1);
  });
}

function validatePublishedReferences(html, catalog) {
  if (catalog.schema_version !== '1.0.0' || catalog.kind !== 'published_reference_evidence' || catalog.runtime_selection_allowed !== false) throw new Error('External references are not runtime method bundles');
  if (!Array.isArray(catalog.references) || catalog.references.length !== 10 || new Set(catalog.references.map(item => item.id)).size !== 10) throw new Error('Invalid published reference inventory');
  const evidenceTypes = new Set(['provider_measurement', 'controlled_hardware_measurement', 'statistical_or_inventory_model', 'analytical_hardware_scenario', 'api_performance_plus_hardware_assumptions', 'first_party_assertion', 'secondary_summary']);
  for (const item of catalog.references) {
    if (!evidenceTypes.has(item.evidence_type)) throw new Error('Unsupported evidence class: ' + item.id);
    if (!item.statistic || !item.population || !item.adoption || !/^https:\/\//.test(item.source) || !Object.hasOwn(item, 'activity_period')) throw new Error('Incomplete published evidence: ' + item.id);
  }
  const byId = new Map(catalog.references.map(item => [item.id, item]));
  const epoch = byId.get('epoch-gpt4o-february-2025');
  const p = Object.fromEntries(Object.entries(epoch.inputs).map(([key, value]) => [key, Number(value)]));
  const epochWh = 2 * p.active_parameters * p.output_tokens / (p.peak_flops_per_second * p.compute_utilization) * p.allocated_power_watts * p.power_utilization / 3600;
  const section = html.match(/<section id="method-reference-checks">([\s\S]*?)<\/section>/)?.[1] || '';
  const lbnl = byId.get('lbnl-us-datacenter-electricity-2023');
  const eia = byId.get('eia-us-electricity-co2-2024');
  const iea = byId.get('iea-world-electricity-co2-2025');
  for (const text of [epochWh.toFixed(7) + ' Wh', lbnl.electricity_water.value + ' L/kWh', lbnl.electricity_ghg.value + ' g generation-associated CO₂e/kWh', eia.carbon.value + ' lb CO₂/MWh', (Number(eia.carbon.value) * 453.59237 / 1000).toFixed(2) + ' g CO₂/kWh', iea.carbon.value + ' g CO₂/kWh']) {
    if (!section.includes(text)) throw new Error('Published reference and article mismatch: ' + text);
  }
  if (lbnl.direct_water !== null) throw new Error('Unresolved LBNL direct water cannot become a complete scenario');
  if (epoch.energy.boundary !== 'facility_including_host' || byId.get('altman-chatgpt-june-2025').energy.boundary !== 'unknown') throw new Error('Published electricity boundary changed');
  const digest = crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
  if (digest !== pinnedDigests.published) throw new Error('Published evidence snapshot changed. Review the source, scope, units and article before updating its digest.');
}

module.exports = { verifyReferencePayloads, validateMethodologyNumerics, validatePublishedReferences };
