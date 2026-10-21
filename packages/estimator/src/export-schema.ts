import { z } from "zod";
import { writeFileSync } from "node:fs";
import { BundleSchema } from "./bundle";
writeFileSync(
  new URL("../data/bundle.schema.json", import.meta.url),
  JSON.stringify(z.toJSONSchema(BundleSchema), null, 2) + "\n",
);
