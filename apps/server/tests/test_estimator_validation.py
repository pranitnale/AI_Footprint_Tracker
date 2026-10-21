import json
from copy import deepcopy
from pathlib import Path

import pytest
from footprint_estimator import environmental_allocation, register_method_bundle

BASELINE = json.loads(
    (Path(__file__).resolve().parents[3] / "packages/estimator/data/baseline.json").read_text()
)


@pytest.mark.parametrize("field", ["pue", "carbon", "direct_water", "upstream_water"])
@pytest.mark.parametrize("value", ["1000000000", "999999999999999999999", "-1", "NaN", "Infinity"])
def test_python_factor_refinements_match_typescript(field, value):
    bundle = deepcopy(BASELINE)
    bundle["method_id"] = "test-invalid-factor"
    bundle["scenario"][field] = value
    with pytest.raises(ValueError):
        register_method_bundle(bundle)
    with pytest.raises(ValueError):
        environmental_allocation("1", "it", bundle["scenario"])


@pytest.mark.parametrize("value", ["-1", "NaN", "Infinity", "-Infinity"])
def test_python_allocation_rejects_invalid_energy(value):
    with pytest.raises(ValueError):
        environmental_allocation(value, "it", BASELINE["scenario"])
