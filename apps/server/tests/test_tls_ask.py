from dataclasses import replace

from fastapi.testclient import TestClient

from aift.main import create_app


def test_certificates_are_allowed_only_for_hosts_the_service_answers_for(setup):
    app, _client, company, *_ = setup
    # The front proxy asks over the internal hop, without the browser's Origin or cookies.
    proxy = TestClient(app, base_url="https://aifootprinttracker.com")

    def ask(domain):
        return proxy.get("/health/tls-ask", params={"domain": domain})

    assert ask("aifootprinttracker.com").status_code == 200
    assert ask("developer.aifootprinttracker.com").status_code == 200
    # Names arrive in any case and sometimes with the root dot.
    assert ask("AIFootprintTracker.com.").status_code == 200
    # Organizations share the one service address, so a company key is no longer a served host
    # and no organization list is consulted to answer.
    assert company.data["origin"] == "https://example.aifootprinttracker.com"

    for unknown in (
        "example.aifootprinttracker.com",
        "unknown.aifootprinttracker.com",
        "www.aifootprinttracker.com",
        "example.aifootprinttracker.com.evil.org",
        "aifootprinttracker.com/../x",
        "",
    ):
        response = ask(unknown)
        assert response.status_code == 404, unknown
        assert response.json()["error"]["code"] == "unknown_host"
    assert proxy.get("/health/tls-ask").status_code == 404


def test_a_self_hosted_server_answers_for_its_own_host(setup):
    settings = replace(
        setup[-1], mode="self_hosted", self_host_origin="https://footprint.example.org"
    )
    proxy = TestClient(create_app(settings), base_url="https://footprint.example.org")
    assert proxy.get("/health/tls-ask", params={"domain": "footprint.example.org"}).status_code == 200
    assert proxy.get("/health/tls-ask", params={"domain": "other.example.org"}).status_code == 404
