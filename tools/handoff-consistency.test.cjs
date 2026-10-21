// These checks catch handoff drift. They do not exercise a production service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plan = read('IMPLEMENTATION-PLAN.md');
const contracts = read('docs/implementation/CONTRACTS.md');
const acceptance = read('docs/implementation/ACCEPTANCE-AND-FAILURES.md');
const product = read('docs/implementation/PRODUCT-AND-ENROLLMENT-SPEC.md');
const handoff = read('IMPLEMENTER-HANDOFF.md');

test('every current product requirement has a verification mapping', () => {
  const requirements = [...plan.matchAll(/^\| (R\d{2}) \|/gm)].map(match => match[1]);
  assert.equal(requirements.length, 24);
  assert.equal(new Set(requirements).size, requirements.length);
  for (const id of requirements) assert.match(acceptance, new RegExp(`^\\| ${id}:`, 'm'));
});

test('all added personal and hosted scenarios have unique acceptance rows', () => {
  const ids = [...acceptance.matchAll(/^\| (PE\d{2}) \|/gm)].map(match => match[1]);
  assert.deepEqual(ids, Array.from({ length: 24 }, (_, index) => `PE${String(index + 1).padStart(2, '0')}`));
  assert.match(product, /production tests|Implement and run PE01-PE24/);
});

test('active identity contracts no longer expose invitation and recovery endpoints', () => {
  // Web approval of browser connections and the registration address check were retired on
  // 13 October 2026; members connect in the extension with an email code instead.
  for (const endpoint of ['/v1/enrollment/exchange', '/v1/recovery/exchange', '/v1/pairings', '/v1/admin/session', '/v1/admin/invitations', '/v1/connections/approve', '/v1/organizations/address-availability']) {
    assert.ok(!contracts.includes(endpoint), `Retired endpoint remains: ${endpoint}`);
  }
  // Self-hosted registration keeps the bootstrap hand-over, so its exchange stays documented.
  for (const endpoint of ['/v1/auth/otp/verify', '/v1/auth/bootstrap/exchange', '/v1/connections/otp/request', '/v1/connections', '/v1/connections/exchange', '/v1/operator/organizations']) {
    assert.ok(contracts.includes(endpoint), `Missing endpoint: ${endpoint}`);
  }
  assert.match(contracts, /same verified canonical work email|unique verified canonical work email/);
  assert.ok(!plan.includes('Do not collect employee names or email addresses'));
  assert.ok(/same device ID/.test(product), 'Reconnect must preserve the original installation identity');
  assert.match(product, /Administrative\/security revocation does not/);
  assert.match(contracts, /`__Host-` prefixed Secure\/HttpOnly/);
  assert.match(acceptance, /parent-domain cookie injection/);
  assert.match(acceptance, /never-uploaded records and newer accepted-record revisions/);
  assert.match(contracts, /only strict-JSON request-body exception/);
  assert.match(product, /application\/x-www-form-urlencoded/);
  assert.match(acceptance, /exact bounded urlencoded form/);
});

test('observation version and terminal retention receipt agree', () => {
  assert.match(contracts, /Observation schema: proposed `1\.1\.0`/);
  assert.match(contracts, /^\|\s+`retention_expired`\s+\|/m);
  assert.match(acceptance, /terminal retention_expired receipt/);
  // Hosted free usage is kept until an administrator deletes it (owner decision of 11 October 2026);
  // a plan maximum or an administrator's shorter choice applies as a rolling calendar-month window.
  assert.match(product, /kept until an administrator deletes them/);
  assert.match(product, /rolling N-calendar-month window/);
  assert.ok(!product.includes('six-calendar-month'), 'The retired six-month hosted window remains');
  assert.match(product, /Self-hosted default|self-hosted default/);
});

test('warning and details requirements preserve the approved interaction', () => {
  assert.ok(!plan.includes('Keep warnings inside the bar'));
  assert.ok(!contracts.includes('notice in the bottom information bar'));
  assert.match(contracts, /exceeds 0\.50/);
  assert.match(contracts, /banner directly above the composer/);
  assert.match(acceptance, /in-chat Details is nonmodal/);
  assert.match(handoff, /E02 is the enrolled browser-toolbar popup/);
});

test('personal mode and research-only evidence cannot be mistaken for hosted calibrated use', () => {
  assert.match(product, /Personal counting produces no network outbox/);
  assert.match(product, /Earlier stored personal history is not uploaded/);
  assert.match(plan, /Holdout evaluation is required for candidate promotion\/calibrated claims/);
  assert.match(handoff, /does \*\*not explicitly adjust for growing input length\*\*/);
  for (const file of ['registry/published-reference-evidence-2026-09-09.json', 'fixtures/context-energy-study-2026-09-09/sweetspot-llama31-8b.json']) {
    assert.match(read(file), /"runtime_selection_allowed"\s*:\s*false/);
  }
});

test('owner decisions and actual implementation state remain visible', () => {
  assert.match(product, /IP history duration/);
  assert.match(product, /Meaning of the free 50-person cap/);
  assert.match(product, /Reuse of a work-email domain/);
  assert.match(handoff, /There is no released extension/);
  assert.match(handoff, /await confirmation/);
  assert.match(handoff, /88 draft\/reference screens/);
});

test('curated handoff links resolve to local files', () => {
  const files = ['IMPLEMENTER-HANDOFF.md', 'IMPLEMENTATION-PLAN.md', 'docs/implementation/PRODUCT-AND-ENROLLMENT-SPEC.md', 'docs/implementation/CONTRACTS.md', 'docs/implementation/ACCEPTANCE-AND-FAILURES.md', 'docs/implementation/BREVO-PRIVACY-SETUP.md', 'docs/implementation/BRAND-ROLES-AND-DESIGN-HANDOFF.md', 'docs/implementation/OPEN-SOURCE-AND-REUSE.md', 'docs/research/README.md'];
  for (const file of files) {
    for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href)) continue;
      const relative = decodeURIComponent(href.split('#')[0]);
      const target = path.resolve(root, path.dirname(file), relative);
      assert.ok(fs.existsSync(target), `${file}: missing linked file ${relative}`);
    }
  }
});
