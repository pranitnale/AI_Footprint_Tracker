import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  ObservationSchema,
  UsageBatchSchema,
  HistoryPageSchema,
  EngineBuildConfigurationSchema,
  EnginePreferenceRecordSchema,
  EstimationEnvelopeSchema,
  EcoLogitsMethodDefinitionSchema,
  HistorySummarySchema,
} from "./index";
const folder = new URL("../schema/", import.meta.url);
mkdirSync(folder, { recursive: true });
for (const [name, schema] of [
  ["observation-3.0.0", ObservationSchema],
  ["usage-batch-3.0.0", UsageBatchSchema],
  ["history-page-3.0.0", HistoryPageSchema],
  ["engine-build-configuration-1.0.0", EngineBuildConfigurationSchema],
  ["engine-preference-1.0.0", EnginePreferenceRecordSchema],
  ["estimation-envelope-3.0.0", EstimationEnvelopeSchema],
  ["ecologits-method-definition-1.0.0", EcoLogitsMethodDefinitionSchema],
  ["history-summary-3.0.0", HistorySummarySchema],
] as const)
  writeFileSync(
    new URL(name + ".schema.json", folder),
    JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n",
  );
