// SPDX-License-Identifier: MPL-2.0
// Derived from EcoLogits 0.11.1 impacts/dag.py. See ../NOTICE.md.
import { EcoLogitsError, type ValueOrRange } from './values.js';

export type DagValues = Record<string, ValueOrRange | null>;
export interface Asset {
  readonly dependencies: readonly string[];
  readonly optional?: readonly string[];
  readonly run: (values: DagValues) => ValueOrRange;
}
/** Explicit supplied assets, including null, skip execution just as in upstream DAG.execute. */
export function executeDag(assets: Readonly<Record<string, Asset>>, inputs: DagValues): DagValues {
  const results = { ...inputs };
  const active = new Set<string>();
  function visit(key: string): void {
    if (active.has(key)) throw new EcoLogitsError('CycleError', `Cycle at ${key}`);
    const task = assets[key];
    if (!task) {
      if (!(key in results)) throw new EcoLogitsError('KeyError', key);
      return;
    }
    active.add(key);
    // Upstream traverses dependencies even when the asset itself was overridden.
    for (const dep of task.dependencies) visit(dep);
    active.delete(key);
    if (Object.hasOwn(results, key)) return;
    for (const dep of task.dependencies) {
      if (results[dep] === null && !task.optional?.includes(dep)) {
        throw new EcoLogitsError('TypeError', `Missing required argument: ${dep}`);
      }
    }
    results[key] = task.run(results);
  }
  for (const key of Object.keys(assets)) visit(key);
  return results;
}
