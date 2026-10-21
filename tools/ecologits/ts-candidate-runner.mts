import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const rootIndex = process.argv.indexOf("--core-root");
if (rootIndex < 0 || !process.argv[rootIndex + 1])
  throw new Error("--core-root is required");
const catalogIndex = process.argv.indexOf("--catalog");
if (catalogIndex < 0 || !process.argv[catalogIndex + 1])
  throw new Error("--catalog is required");
const coreRoot = resolve(process.argv[rootIndex + 1]);
const core: any = await import(
  pathToFileURL(join(coreRoot, "src/index.ts")).href
);
const candidateCatalog = JSON.parse(
  readFileSync(resolve(process.argv[catalogIndex + 1]), "utf8"),
);
const runtime = core.createCatalogRuntime(candidateCatalog);

function encode(value: any): any {
  if (typeof value === "number" && !Number.isFinite(value))
    return { $float: String(value) };
  if (typeof value === "number" && Object.is(value, -0))
    return { $float: "-0" };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, encode(child)]),
    );
  return value;
}

function decode(value: any): any {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    if (Object.keys(value).length === 1 && "$float" in value)
      return Number(value.$float);
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, decode(child)]),
    );
  }
  return value;
}

function rangeMeans(value: any, path = ""): Record<string, number> {
  if (core.isRange(value)) return { [path]: core.mean(value) };
  const result: Record<string, number> = {};
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value))
      Object.assign(result, rangeMeans(child, `${path}.${key}`));
  }
  return result;
}

function execute(case_: any): any {
  const args = decode(case_.args ?? {});
  switch (case_.op) {
    case "llm":
      return core.computeLlmImpacts(args);
    case "llm_dag":
      return core.computeLlmImpactsDag(args);
    case "llm_execute":
      return core.executeLlmDag(args);
    case "video":
      return core.computeVideoImpacts(args);
    case "video_dag":
      return core.computeVideoImpactsDag(args);
    case "video_execute":
      return core.executeVideoDag(args);
    case "llm_lookup":
      return runtime.llmImpacts(args);
    case "video_lookup":
      return runtime.videoImpacts(args);
    case "model":
      return runtime.findModel(args.provider, args.model_name);
    case "mix":
      return runtime.findElectricityMix(args.zone);
    case "status_from_code":
      return args.kind === "warning"
        ? runtime.warningFromCode(args.code)
        : runtime.errorFromCode(args.code);
    case "output_status": {
      let result: any = {
        energy: null,
        gwp: null,
        adpe: null,
        pe: null,
        wcf: null,
        usage: null,
        embodied: null,
        warnings: null,
        errors: null,
      };
      for (const code of args.warnings)
        result = core.addOutputWarning(result, runtime.warningFromCode(code));
      for (const code of args.errors)
        result = core.addOutputError(result, runtime.errorFromCode(code));
      return {
        output: result,
        has_warnings: !!result.warnings?.length,
        has_errors: !!result.errors?.length,
      };
    }
    case "electricity_from_json":
      return runtime.electricityMixFromJson(args);
    case "electricity_repository":
      return runtime.createElectricityRepository(
        args.mixes.map(runtime.electricityMixFromJson),
      );
    case "model_from_json":
      return runtime.modelFromJson(args);
    case "repository":
      return runtime.createModelRepository(
        args.models.map(runtime.modelFromJson),
        args.aliases,
      );
    case "resolution":
      return core.parseResolution(args.resolution);
    case "frames":
      return core.durationToFrames(args.duration);
    case "gpu_count":
      return core.gpuRequiredCount(args.model_required_memory, args.gpu_memory);
    case "parse_value_or_range":
      return core.parseValueOrRange(args.value);
    case "range": {
      if (args.action === "mean") return core.mean(args.a);
      const actions: Record<string, string> = {
        add: "add",
        multiply: "multiply",
        divide: "divide",
        equal: "equal",
        less: "less",
        lessEqual: "lessEqual",
        greater: "greater",
        greaterEqual: "greaterEqual",
      };
      return core[actions[args.action]](args.a, args.b);
    }
    case "impact_add":
      return core.addImpacts(
        core.impact(args.left, args.a),
        core.impact(args.right, args.b),
      );
    case "impact_compare":
      return core.compareImpacts(
        core.impact(args.left, args.a),
        core.impact(args.right, args.b),
        args.action,
      );
    default:
      throw new Error(`Unknown operation ${case_.op}`);
  }
}

const cases = JSON.parse(readFileSync(0, "utf8"));
const results = cases.map((case_: any) => {
  try {
    const value = execute(case_);
    return {
      id: case_.id,
      value: encode(value),
      range_means: encode(rangeMeans(value)),
    };
  } catch (error) {
    if (!(error instanceof core.EcoLogitsError)) throw error;
    return { id: case_.id, error: { pythonType: error.pythonType } };
  }
});
process.stdout.write(JSON.stringify(results));
