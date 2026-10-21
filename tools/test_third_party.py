"""The committed SBOM and notices must be exactly what the committed inventory renders."""

import copy
import unittest

from third_party import (
    CURATION_PATH,
    ROOT,
    INVENTORY_PATH,
    NOTICES_PATH,
    SBOM_PATH,
    TEMPLATE_PATH,
    curate,
    inventory_document,
    load_json,
    render_notices,
    rendered_outputs,
)


def committed(path):
    # A Windows checkout may have CRLF endings; the generator always writes LF.
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


class ThirdPartyRecordTests(unittest.TestCase):
    def setUp(self):
        self.inventory = load_json(INVENTORY_PATH)
        self.curation = load_json(CURATION_PATH)

    def test_sbom_and_notices_are_rendered_from_the_inventory(self):
        for path, expected in rendered_outputs(self.inventory).items():
            self.assertEqual(
                committed(path),
                expected,
                f"{path.name} is stale; run pnpm generate:sbom",
            )

    def test_inventory_already_carries_every_reviewed_correction(self):
        regenerated = inventory_document(self.inventory["components"], self.curation)
        self.assertEqual(regenerated["components"], self.inventory["components"])
        self.assertEqual(regenerated["data"], self.inventory["data"])

    def test_every_shipped_browser_component_and_data_set_is_named_in_the_notices(self):
        notices = committed(NOTICES_PATH)
        for item in self.inventory["components"]:
            if item.get("browser_runtime"):
                self.assertIn(f"| {item['name']} | {item['version']} | {item['license']} |", notices)
        for item in self.inventory["data"]:
            self.assertIn(f"| {item['name']} | {item['version']} |", notices)

    def test_a_changed_inventory_changes_the_notices(self):
        changed = copy.deepcopy(self.inventory)
        changed["components"][0]["version"] = "0.0.0-changed"
        template = TEMPLATE_PATH.read_text(encoding="utf-8")
        self.assertNotEqual(render_notices(changed, template), committed(NOTICES_PATH))

    def test_unverified_data_never_states_a_licence_as_fact(self):
        for item in self.inventory["data"]:
            self.assertIn(item["license_status"], {"declared", "unverified"})
            if item["license_status"] == "unverified":
                self.assertEqual(item["license"], "NOASSERTION", item["name"])
                self.assertTrue(item.get("note"), item["name"])
        sbom = load_json(SBOM_PATH)
        unverified = {item["name"] for item in self.inventory["data"] if item["license_status"] == "unverified"}
        for component in sbom["components"]:
            if component["name"] in unverified:
                self.assertEqual(component["licenses"], [], component["name"])

    def test_ml_energy_figures_are_not_shipped(self):
        # The 208 ML.ENERGY image figures were removed on 20 October 2026 because their source
        # repository has no licence. Only the regressions EcoLogits fitted to the leaderboard remain.
        names = [item["name"] for item in self.inventory["data"] if "ML.ENERGY" in item["name"]]
        self.assertEqual(names, ["ML.ENERGY Leaderboard measurements behind the EcoLogits regressions"])
        for item in self.inventory["data"]:
            for path in item.get("files", []):
                self.assertTrue((ROOT / path).exists(), path)

    def test_curation_is_idempotent_and_removes_machine_specific_packages(self):
        components = self.inventory["components"] + [
            {
                "ecosystem": "npm",
                "name": "@napi-rs/canvas-linux-x64-gnu",
                "version": "1.0.8",
                "license": "MIT",
                "scope": "runtime",
            }
        ]
        once = curate(components, self.curation)
        self.assertEqual(curate(once, self.curation), once)
        self.assertFalse(any(item["name"].startswith("@napi-rs/canvas-") for item in once))
        names = {item["name"]: item for item in once}
        self.assertEqual(names["@napi-rs/canvas"]["scope"], "optional_not_shipped")
        self.assertEqual(names["python-dateutil"]["license"], "Apache-2.0 AND BSD-3-Clause")

    def test_spdx_identifiers_are_used_for_fonts(self):
        sbom = load_json(SBOM_PATH)
        fonts = [c for c in sbom["components"] if c["name"].startswith("@fontsource-variable/")]
        self.assertTrue(fonts)
        for component in fonts:
            self.assertEqual(component["licenses"], [{"license": {"id": "OFL-1.1"}}])
        self.assertEqual(sbom["specVersion"], "1.6")


if __name__ == "__main__":
    unittest.main()
