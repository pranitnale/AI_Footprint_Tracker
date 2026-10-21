"""One-time reviewed map migration. Explicit correspondences, not a code translator."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "source-to-port-map.json"
mapping = json.loads(path.read_text(encoding="utf8"))


def assign(row, file, symbol, fixtures, disposition="implemented", reason=None):
    row.update(port=file, implementation=symbol, fixtures=fixtures, disposition=disposition)
    row.pop("reason", None)
    if reason:
        row["reason"] = reason


def exclude(row, reason):
    assign(row, None, None, [], "excluded", reason)


for row in mapping["functions_and_types"]:
    file, symbol = row["upstream_file"], row["symbol"]
    name = symbol.split(".")[-1]
    if file in ("ecologits/impacts/llm.py", "ecologits/impacts/video.py"):
        llm = file.endswith("llm.py")
        target = "src/llm.ts" if llm else "src/video.ts"
        if name.startswith("compute_"):
            camel = "".join(part.title() if i else part for i, part in enumerate(name.split("_")))
            fixtures = ["EL20-dag-0" if name.endswith("_dag") else "EL20-0"] if llm else ["EV04-0" if name.endswith("_dag") else "EV08-range-environment"]
            assign(row, target, camel, fixtures)
        else:
            assign(row, target, ("llmAssets." if llm else "videoAssets.") + name,
                   ["EL20-dag-0", "EL08-override-" + name] if llm else ["EV04-0", "EV10-override-" + name])
    elif file.endswith("impacts/dag.py"):
        if symbol == "DAG.execute":
            assign(row, "src/dag.ts", "executeDag", ["EL22-null-asset", "EL22-null-dependency", "EL22-absent-optional-node", "EV10-override-request_energy"])
        else:
            assign(row, "src/dag.ts", "Asset", ["EL08-override-gpu_energy", "EV10-override-request_energy"], "adapted",
                   "Python mutable registration, decorated wrappers and graph-builder objects are replaced by explicit Asset tables. The port does not expose the Python registration API; executing those tables preserves the tested dependency and override behavior.")
    elif file.endswith("utils/range_value.py"):
        table = {"RangeValue": "RangeValue", "mean": "mean", "check_order": "range", "__add__": "add", "__mul__": "multiply", "__truediv__": "divide", "__eq__": "equal", "__le__": "lessEqual", "__lt__": "less", "__ge__": "greaterEqual", "__gt__": "greater"}
        if name == "__format__":
            exclude(row, "Python CLI/display formatting, including format specifiers, is outside the numeric core. No TypeScript formatter counterpart is claimed; the product formats its own retained values.")
        elif symbol == "RangeValue":
            assign(row, "src/values.ts", "RangeValue", ["EL05-midpoint", "EL22-reverse-division"], "domain-limited", "The Pydantic class is represented by a typed min/max interface and range constructor. Arbitrary Python object coercion is outside this API; numeric endpoints, ordering and range shape are tested.")
        else:
            assign(row, "src/values.ts", table[name], ["EL05-midpoint"] if name == "mean" else ["EL16-negative-range-multiplier"] if name == "check_order" else ["EL22-reverse-division"] if name == "__truediv__" else ["EL21-compare-energy-placeholder"])
            # Direct range fixtures use deterministic generated IDs; resolved below.
            if row["fixtures"] == ["EL21-compare-energy-placeholder"]:
                row["fixtures"] = ["@range:" + table[name]]
    elif file.endswith("impacts/modeling.py"):
        if name == "__add__":
            assign(row, "src/modeling.ts", "addImpacts", ["EL21-add-energy", "EL21-mismatch-energy"])
        elif name in ("__eq__", "__le__", "__ge__"):
            assign(row, "src/modeling.ts", "compareImpacts", ["@impact:" + {"__eq__":"equal","__le__":"lessEqual","__ge__":"greaterEqual"}[name]])
        else:
            implementation = symbol if symbol in ("Usage", "Embodied", "Impacts") else "Impact"
            assign(row, "src/modeling.ts", implementation, ["EL20-0", "EV08-range-environment"], "adapted", "Pydantic phase/impact classes are represented by immutable typed records. impact and impactsFromDag construct the source names, units, values and phase fields; Python class identity and arbitrary construction/coercion are not public runtime APIs.")
    elif file.endswith("model_repository.py"):
        if symbol == "Model.from_json":
            assign(row, "src/catalog.ts", "modelFromJson", ["EL22-source-loader", "EL22-singular-source", "EL22-singular-missing-sources", "EL15-provider-enum"], "domain-limited", "The helper preserves the typed numeric loader domain and source-key defect. Arbitrary malformed/coercible Pydantic objects are explicitly excluded; this helper is not the strict product schema validator.")
        elif symbol == "ModelRepository.find_model":
            assign(row, "src/catalog.ts", "findModel", ["EL02-model-0", "EL02-output-0"])
        elif symbol == "ModelRepository.from_json":
            assign(row, "tools/generate_catalog.py", "generate", ["EL02-model-0"], "build-time", "Filesystem loading executes the real pinned upstream loader during deterministic conversion. Runtime consumes the retained-source-derived immutable catalog; no runtime file loader is claimed.")
        elif symbol in ("ModelRepository", "ModelRepository.__init__", "ModelRepository.add_model"):
            assign(row, "src/catalog.ts", "createModelRepository", ["EL02-duplicate-model", "EL02-missing-alias", "EL22-alias-overwrite"], "adapted", "Mutable constructor/add-model behavior is represented by pure repository construction from an explicit model list. Combining prior records with a new record and constructing again preserves duplicate/alias checks without a mutable repository API.")
        elif symbol == "ModelRepository.list_models":
            assign(row, "src/catalog.ts", "Catalog", ["EL02-model-0"], "adapted", "The source list method is an immutable catalog.models array in the port. No list_models method is exported; each normalized record and alias is independently compared to the actual source repository.")
        elif symbol == "Model.has_warnings":
            assign(row, "src/catalog.ts", "Model", ["EL02-model-0", "EL02-output-0"], "adapted", "The Pydantic boolean property is represented by the warnings array and lookup bridge concatenation. Callers may test its length; the port does not claim a has_warnings accessor on Model records.")
        else:
            assign(row, "src/catalog.ts", "Provider" if symbol == "Providers" else "Catalog" if symbol == "Alias" else "Model", ["EL02-model-0"], "domain-limited", "The source enum/nested Pydantic model is represented by the corresponding typed provider, model or catalog fields. Runtime JSON coercion and arbitrary Pydantic validation are excluded; accepted catalog values are loaded by the pinned upstream converter.")
    elif file.endswith("electricity_mix_repository.py"):
        if symbol == "ElectricityMix.from_json":
            assign(row, "src/catalog.ts", "electricityMixFromJson", ["EL15-mix-loader-1.2", "EL15-mix-loader-invalid"], "domain-limited", "The raw helper supports numeric/boolean values and ASCII Python-style numeric text. Unicode decimal text accepted by Python float is explicitly outside this helper's domain; the pinned dataset uses supported forms. Product inputs never rely on this coercing loader.")
        elif symbol == "ElectricityMixRepository.from_json":
            assign(row, "tools/generate_catalog.py", "generate", ["EL12-mix-0"], "build-time", "Filesystem loading uses the actual pinned upstream repository during deterministic conversion. Runtime consumes the immutable catalog and does not expose filesystem access.")
        elif symbol == "ElectricityMixRepository.find_electricity_mix":
            assign(row, "src/catalog.ts", "findElectricityMix", ["EL12-mix-0", "EL12-dense-0"])
        elif symbol in ("ElectricityMixRepository", "ElectricityMixRepository.__init__"):
            assign(row, "src/catalog.ts", "createElectricityRepository", ["EL15-duplicate-mix"], "adapted", "The source mutable repository constructor becomes pure array construction with the same duplicate-zone rejection. Runtime lookup uses a private immutable index built from accepted records.")
        else:
            assign(row, "src/catalog.ts", "ElectricityMix" if symbol.startswith("ElectricityMix.") or symbol == "ElectricityMix" else "Catalog", ["EL12-mix-0", "EL12-dense-0"], "adapted", "The source dataclass, list method and warning property are represented by typed immutable records, catalog.electricity_mixes and warning arrays. No equivalent Python object method/accessor identity is claimed.")
    elif file.endswith("estimations/video.py"):
        target = {"video_impacts": ("src/catalog.ts", "videoImpacts", "EV01-0-true-undefined"), "parse_resolution": ("src/video.ts", "parseResolution", "EV02-720p"), "parse_value_or_range": ("src/catalog.ts", "parseValueOrRange", "EV02-parse-range"), "duration_to_frames": ("src/video.ts", "durationToFrames", "EV03-5")}[symbol]
        assign(row, target[0], target[1], [target[2]])
    elif file.endswith("tracers/utils.py"):
        if symbol == "llm_impacts":
            assign(row, "src/catalog.ts", "llmImpacts", ["EL02-output-0", "EL10-exact-40"], "adapted", "The numeric bridge is preserved. TypeScript additionally permits omitted request_latency and lowers it to null; the Python oracle explicitly supplies None for this convenience. Identical callable signatures are not claimed.")
        elif name in ("add_warning", "add_errors"):
            assign(row, "src/modeling.ts", "addOutputWarning" if name == "add_warning" else "addOutputError", ["EL21-output-empty", "EL21-output-dedup"], "adapted", "The source mutates its output object; the TypeScript helper returns a new output while preserving warning-code deduplication, error append order and prior values. Mutation identity is deliberately not preserved.")
        elif symbol == "_ProviderConfig":
            assign(row, "src/catalog.ts", "ProviderConfiguration", ["EL02-output-0"], "adapted", "The provider dataclass is a typed immutable record populated by deterministic upstream conversion. The bridge uses its exact location/PUE/WUE fields; no dataclass object API is exposed.")
        else:
            assign(row, "src/modeling.ts", "ImpactsOutput", ["EL21-output-empty", "EL21-output-dedup"], "adapted", "Pydantic output fields are plain typed records. has_warnings/has_errors are represented by nonempty array tests in consumers, verified against source properties; no getter methods or arbitrary model_validate API is claimed.")
    elif file.endswith("status_messages.py"):
        if symbol in ("_StatusMessage.__str__", "_StatusMessage.from_code"):
            exclude(row, "This Python-only logging/string formatter or abstract NotImplementedError method is not used by numeric result consumers. The port returns code/message records and does not implement its documentation-URL string or abstract method.")
        elif symbol in ("WarningMessage.from_code", "ErrorMessage.from_code"):
            warning = symbol.startswith("Warning")
            assign(row, "src/catalog.ts", "warningFromCode" if warning else "errorFromCode", ["EL21-status-model-arch-not-released" if warning else "EL21-status-zone-not-registered"])
        else:
            codes = {"ModelArchNotReleasedWarning":"model-arch-not-released", "ModelArchMultimodalWarning":"model-arch-multimodal", "ElectricityMixADPeDefaultWarning":"electricity-mix-adpe-world", "ElectricityMixPEDefaultWarning":"electricity-mix-pe-world", "ElectricityMixWUEDefaultWarning":"electricity-mix-wue-world", "ModelNotRegisteredError":"model-not-registered", "ZoneNotRegisteredError":"zone-not-registered"}
            fixture_ids = ["EL21-status-" + codes[symbol]] if symbol in codes else ["EL21-status-model-arch-not-released", "EL21-status-zone-not-registered"]
            assign(row, "src/modeling.ts", "StatusMessage", fixture_ids, "adapted", "Source status classes/defaults are code/message records, populated from the pinned status factories during catalog conversion. Class identity, __str__ logging and Pydantic construction are not exported; exact default code/message values are tested.")
    elif file.endswith("exceptions.py"):
        if symbol == "TracerInitializationError":
            exclude(row, "SDK tracer initialization is outside the authorized calculation/lookup port. The package has no tracer initialization entry point and makes no implementation claim for its exception class.")
        else:
            assign(row, "src/values.ts", "EcoLogitsError", ["EL21-mismatch-energy", "EL02-duplicate-model"], "adapted", "Python exception subclasses are represented by EcoLogitsError with a preserved pythonType/name. Cross-runtime tests compare exception classes; Python traceback and class object identity are not transported.")
    else:
        raise AssertionError((file, symbol))

# Resolve generated but executable range/impact IDs to real cases, not prose ranges.
import subprocess
program = "import {boundaryCases} from './test/fixtures.ts'; process.stdout.write(JSON.stringify(boundaryCases().filter(c=>c.op==='range'||c.op==='impact_compare')));"
cases = json.loads(subprocess.check_output(["node", "--import", "tsx", "--input-type=module", "-e", program], cwd=ROOT, encoding="utf8"))
for row in mapping["functions_and_types"]:
    for index, fixture in enumerate(row["fixtures"]):
        if fixture.startswith("@"):
            kind, action = fixture[1:].split(":")
            op = "range" if kind == "range" else "impact_compare"
            row["fixtures"][index] = next(case["id"] for case in cases if case["op"] == op and case["args"]["action"] == action and isinstance(case["args"]["a"], dict))
mapping["schema_version"] = 2
path.write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf8")
print("Wrote reviewed, resolvable dispositions for", len(mapping["functions_and_types"]), "source symbols.")
