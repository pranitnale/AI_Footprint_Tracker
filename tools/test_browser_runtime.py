"""Release fixtures: shipped dev-dependency code must remain in audits and SBOM."""

import unittest

from browser_runtime import audit, merge_components


class BrowserRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.browser = {
            "components": [
                {"name": "wxt", "version": "0.21.4", "license": "MIT"},
                {"name": "@wxt-dev/browser", "version": "0.1.43", "license": "MIT"},
            ]
        }

    def test_shipped_helpers_are_merged_without_build_only_dependencies(self):
        merged = merge_components([], self.browser)
        self.assertEqual({item["name"] for item in merged}, {"wxt", "@wxt-dev/browser"})
        self.assertTrue(all(item["scope"] == "runtime" and item["browser_runtime"] for item in merged))
        self.assertEqual(merge_components(merged, self.browser), merged)

    def test_exact_component_queries_report_findings_and_never_hide_them(self):
        observed = []

        def query(queries):
            observed.extend(queries)
            return {"results": [{}, {"vulns": [{"id": "SYNTHETIC-ADVISORY", "modified": "fixture"}]}]}

        result = audit(self.browser, query)
        self.assertEqual({q["package"]["name"] for q in observed}, {"wxt", "@wxt-dev/browser"})
        self.assertEqual(result["status"], "findings")
        self.assertEqual(
            result["findings"], [{"name": "wxt", "version": "0.21.4", "id": "SYNTHETIC-ADVISORY"}]
        )

    def test_missing_or_paginated_results_fail_closed(self):
        for response in ({"results": []}, {"results": [{}, {"next_page_token": "more"}]}):
            with self.assertRaises(RuntimeError):
                audit(self.browser, lambda _: response)


if __name__ == "__main__":
    unittest.main()
