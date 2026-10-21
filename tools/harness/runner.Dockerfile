# Test runner for the verification harness. It runs the repository's Node, Python and browser suites on a
# Linux host so long checks do not load the owner's laptop. Test-only: nothing here ships in a package.
# The Playwright base pins the same Chromium revision (Chrome for Testing 151) the local harness uses.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /usr/local/bin/
ENV UV_LINK_MODE=copy \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN uv python install 3.13.12 \
 && corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends git xvfb \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
