"""Production native data activation uses qualified bytes and immutable installed code."""

import hashlib
import importlib.metadata
import json
import shutil
from copy import deepcopy
from datetime import UTC, datetime

import pytest
from test_analytics import observations

from aift import engine_adapter
from aift.security import Problem

MODEL = "synthetic-qualified-native-model"


def read(path):
    return json.loads(path.read_bytes())


def write(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf8")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def product(tmp_path, monkeypatch):
    root = tmp_path / "product"
    core = root / "packages/ecologits-core"
    accepted = engine_adapter.ROOT / "packages/ecologits-core"
    shutil.copytree(accepted / "upstream", core / "upstream")
    (core / "data").mkdir()
    for name in ("catalog.json", "identity.json"):
        shutil.copyfile(accepted / "data" / name, core / "data" / name)
    shutil.copytree(engine_adapter.ROOT / "config", root / "config")
    monkeypatch.setattr(engine_adapter, "ROOT", root)
    engine_adapter.packaged_definition.cache_clear()
    engine_adapter.native_bundle.cache_clear()
    yield root, core
    engine_adapter.packaged_definition.cache_clear()
    engine_adapter.native_bundle.cache_clear()


def reseal(core, *changed_files):
    manifest_path = core / "upstream/retained-source.json"
    manifest = read(manifest_path)
    lock_path = core / "upstream/lock.json"
    lock = read(lock_path)
    for name in changed_files:
        path = core / "upstream" / manifest["snapshot_directory"] / name
        manifest["retained_files"][name].update(sha256=sha(path), size=path.stat().st_size)
        lock["files"][name] = sha(path)
    write(manifest_path, manifest)
    lock["retained_source_manifest_sha256"] = sha(manifest_path)
    lock["catalog_sha256"] = sha(core / "data/catalog.json")
    write(lock_path, lock)
    identity = read(core / "data/identity.json")
    identity["catalog_sha256"] = lock["catalog_sha256"]
    write(core / "data/identity.json", identity)
    engine_adapter.packaged_definition.cache_clear()
    engine_adapter.native_bundle.cache_clear()


def qualify(product):
    from ecologits.electricity_mix_repository import ElectricityMix
    from ecologits.model_repository import Alias, Model, ModelRepository

    root, core = product
    manifest = read(core / "upstream/retained-source.json")
    snapshot = core / "upstream" / manifest["snapshot_directory"]
    models_path = snapshot / "ecologits/data/models.json"
    models = read(models_path)
    added = deepcopy(next(row for row in models["models"] if row["name"] == "claude-opus-4-8"))
    added.update(name=MODEL, architecture={"type": "dense", "parameters": 8})
    models["models"].append(added)
    write(models_path, models)
    mixes_path = snapshot / "ecologits/data/electricity_mixes.json"
    mixes = read(mixes_path)
    usa = next(row for row in mixes["electricity_mixes"] if row["name"] == "USA")
    usa["gwp"] *= 2
    usa["wue"] *= 3
    write(mixes_path, mixes)
    lock_path = core / "upstream/lock.json"
    lock = read(lock_path)
    lock.update(
        release_kind="qualified_combination",
        qualified_label="native-test",
        core_commit=lock["requested_git_commit"],
        catalog_commit="b" * 40,
        catalog_overlay_files=sorted(engine_adapter.CATALOG_FILES),
    )
    write(lock_path, lock)
    generated_path = core / "data/catalog.json"
    generated = read(generated_path)
    native_models = ModelRepository(
        models=[Model.from_json(row) for row in models["models"]],
        aliases=[Alias.model_validate(row) for row in models["aliases"]],
    )
    generated["models"] = [row.model_dump(mode="json") for row in native_models.list_models()]
    generated["upstream_commit"] = lock["catalog_commit"]
    generated["model_provenance"][f"anthropic/{MODEL}"] = {
        "path": f"ecologits/data/models.json#/models/{len(models['models']) - 1}",
        "raw_sources": added.get("sources", []),
    }
    for entry in generated["model_provenance"].values():
        entry["source_sha256"] = sha(models_path)
    for entry in generated["electricity_provenance"].values():
        entry["source_sha256"] = sha(mixes_path)
    generated["electricity_mixes"] = [
        {
            **{field: getattr(mix, field) for field in ("zone", "adpe", "pe", "gwp", "wue")},
            "warnings": [warning.model_dump(mode="json") for warning in mix.warnings],
        }
        for mix in map(ElectricityMix.from_json, mixes["electricity_mixes"])
    ]
    write(generated_path, generated)
    reseal(core, "ecologits/data/models.json", "ecologits/data/electricity_mixes.json")
    build_path = root / "config/estimation.build.json"
    build = read(build_path)
    build["ecologits_fallback"]["provider_defaults"]["anthropic"]["profile"]["model_name"] = MODEL
    write(build_path, build)
    return snapshot


def unavailable():
    with pytest.raises(Problem) as caught:
        engine_adapter.native_runtime()
    assert caught.value.code == "engine_unavailable"
    assert caught.value.status == 409
    assert caught.value.retryable is True


def test_qualified_native_models_and_environment_bind_without_changing_installed_runtime(product):
    from ecologits import electricity_mix_repository, model_repository
    from ecologits.tracers import utils

    initial, initial_models = engine_adapter.native_runtime()
    old_definition = deepcopy(engine_adapter.packaged_definition())
    old_models, old_mixes = utils.models, utils.electricity_mixes
    old_usa = deepcopy(old_mixes.find_electricity_mix("USA"))
    qualify(product)
    native, models = engine_adapter.native_runtime()
    assert native.__code__ is utils.llm_impacts.__code__
    assert utils.models is old_models is model_repository.models
    assert utils.electricity_mixes is old_mixes is electricity_mix_repository.electricity_mixes
    assert initial.__globals__["models"] is initial_models
    assert old_models.find_model("anthropic", MODEL) is None
    assert models.find_model("anthropic", MODEL).architecture.parameters == 8
    selected_mix = native.__globals__["electricity_mixes"].find_electricity_mix("USA")
    assert selected_mix.gwp == old_usa.gwp * 2
    assert selected_mix.wue == old_usa.wue * 3
    assert old_mixes.find_electricity_mix("USA") == old_usa
    definition = engine_adapter.packaged_definition()
    assert definition["core"]["requested_git_commit"] == old_definition["core"]["requested_git_commit"]
    assert definition["core"]["catalog_sha256"] != old_definition["core"]["catalog_sha256"]
    assert (
        engine_adapter.identity(definition)["method_hash"]
        != engine_adapter.identity(old_definition)["method_hash"]
    )
    with pytest.raises(Problem) as caught:
        engine_adapter.require_native(old_definition)
    assert caught.value.code == "engine_unavailable"
    request, attempt = observations(datetime(2026, 9, 10, tzinfo=UTC), "500")
    request["site"] = "claude"
    result = engine_adapter.estimate(definition, attempt, request)
    assert result["selection"]["profile"]["model_name"] == MODEL
    # A claude.ai reply: its 500 counted tokens times the Claude token factor (15 Oct 2026).
    expected = engine_adapter.serialize(native("anthropic", MODEL, 780, None))
    assert result["raw"]["result"] == expected
    low, high = engine_adapter.endpoints(expected["usage"]["wcf"]["value"])
    for end, expected_value in (("scenario_low", low), ("scenario_high", high)):
        assert float(result["metrics"]["water_total"][end]) == pytest.approx(expected_value, rel=1e-12)


@pytest.mark.parametrize(
    "mutation",
    [
        "unqualified",
        "missing_label",
        "code_overlay",
        "unknown_overlay",
        "duplicate_overlay",
        "overlay_not_list",
        "undeclared_environment",
        "retained_code",
        "unsealed_data",
        "manifest_hash",
        "generated_hash",
        "stale_generated_models",
        "stale_generated_environment",
        "core_identity",
        "catalog_commit",
        "core_commit",
        "snapshot_escape",
    ],
)
def test_altered_or_unqualified_native_overlay_is_unavailable(product, mutation):
    _, core = product
    snapshot = qualify(product)
    lock_path = core / "upstream/lock.json"
    lock = read(lock_path)
    if mutation in (
        "unqualified",
        "missing_label",
        "code_overlay",
        "unknown_overlay",
        "duplicate_overlay",
        "overlay_not_list",
        "undeclared_environment",
        "manifest_hash",
        "catalog_commit",
        "core_commit",
    ):
        if mutation == "unqualified":
            lock["release_kind"] = "release_candidate"
        elif mutation == "missing_label":
            lock.pop("qualified_label")
        elif mutation == "code_overlay":
            lock["catalog_overlay_files"].append("ecologits/tracers/utils.py")
        elif mutation == "unknown_overlay":
            lock["catalog_overlay_files"].append("ecologits/data/unknown.json")
        elif mutation == "duplicate_overlay":
            lock["catalog_overlay_files"].append(lock["catalog_overlay_files"][0])
        elif mutation == "overlay_not_list":
            lock["catalog_overlay_files"] = "ecologits/data/models.json"
        elif mutation == "undeclared_environment":
            lock["catalog_overlay_files"] = ["ecologits/data/models.json"]
        elif mutation == "manifest_hash":
            lock["retained_source_manifest_sha256"] = "0" * 64
        elif mutation == "catalog_commit":
            lock["catalog_commit"] = "c" * 40
        elif mutation == "core_commit":
            lock["core_commit"] = "c" * 40
        write(lock_path, lock)
    elif mutation == "retained_code":
        name = "ecologits/tracers/utils.py"
        with (snapshot / name).open("ab") as changed:
            changed.write(b"\n# modified installed-code claim\n")
        reseal(core, name)
    elif mutation == "unsealed_data":
        with (snapshot / "ecologits/data/models.json").open("ab") as changed:
            changed.write(b" ")
    elif mutation == "generated_hash":
        with (core / "data/catalog.json").open("ab") as changed:
            changed.write(b" ")
    elif mutation.startswith("stale_generated_"):
        generated = read(core / "data/catalog.json")
        if mutation == "stale_generated_models":
            generated["models"] = [row for row in generated["models"] if row["name"] != MODEL]
        else:
            next(row for row in generated["electricity_mixes"] if row["zone"] == "USA")["wue"] /= 3
        write(core / "data/catalog.json", generated)
        reseal(core)
    elif mutation == "core_identity":
        core_identity = read(core / "data/identity.json")
        core_identity["catalog_sha256"] = "0" * 64
        write(core / "data/identity.json", core_identity)
    elif mutation == "snapshot_escape":
        manifest_path = core / "upstream/retained-source.json"
        manifest = read(manifest_path)
        manifest["snapshot_directory"] = ".."
        write(manifest_path, manifest)
        lock["retained_source_manifest_sha256"] = sha(manifest_path)
        write(lock_path, lock)
    unavailable()


def test_qualified_data_cannot_change_supported_installed_version(product, monkeypatch):
    qualify(product)
    monkeypatch.setattr(importlib.metadata, "version", lambda name: "0.11.1")
    unavailable()
