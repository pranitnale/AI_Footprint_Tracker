import { test } from 'node:test';
import { catalogCases, differential, numericalCases } from '../tools/differential.js';

test('EL01-EL14, EL20, EV01/04-09: full catalogs and 1000 seeded inputs against locked actual Python', () => {
  const report = differential([...catalogCases(), ...numericalCases(1000)]);
  console.log(JSON.stringify(report));
});
