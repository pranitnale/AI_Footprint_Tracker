import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsageFilters, zonedMidnight } from '../../apps/extension/lib/ui-model';

test('independent calendar oracle keeps Sunday in its existing Monday-started week', () => {
  const result = buildUsageFilters(
    { period: 'week', start: '', end: '', site: '', model: '' },
    'Europe/Berlin',
    new Date('2026-09-13T12:00:00Z'),
    'my',
  );
  assert.equal(result.local.start, '2026-09-06T22:00:00.000Z');
  assert.equal(result.local.end, '2026-09-13T22:00:00.000Z');
});

test('independent midnight-gap oracle never selects the previous civil date', () => {
  assert.equal(zonedMidnight('2026-09-06', 'America/Santiago'), '2026-09-06T04:00:00.000Z');
  assert.equal(zonedMidnight('2026-09-07', 'America/Santiago'), '2026-09-07T03:00:00.000Z');
});

test('independent calendar oracle rejects impossible dates rather than moving records into March', () => {
  assert.throws(() => zonedMidnight('2026-02-30', 'UTC'));
  assert.throws(() => zonedMidnight('not-a-date', 'UTC'));
});
