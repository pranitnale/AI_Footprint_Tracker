# Anthropic counting reference tool

This maintainer tool implements the development boundary in Contracts section 3.6 and T05/T06. It only calls `messages.count_tokens` through the pinned official Anthropic Python SDK. A transport allowlist rejects every other method, URL, query and host, including generation endpoints and redirects. Nothing imports this tool from the extension or company server.

No live Anthropic request has been executed as part of this implementation. Offline tests use the actual SDK with a mock HTTP transport. Live reference results, modern-versus-historical model comparisons and calibrated tokenizer profiles remain unverified.

## Inputs and credentials

The only accepted corpus is the existing reviewed `calibration/tokenizer-golden.json`, pinned by the SHA-256 of the committed file (a Windows checkout with CRLF line endings is read as LF, so the pin holds on every system). It contains 400 project-authored synthetic cases under the repository MIT license, including English, German, code, numeric, Unicode, long strings and edge cases. Its 300 training and 100 holdout assignments are frozen. Arbitrary files, employee exports and capture directories are rejected, even if renamed or labeled synthetic. A corpus update requires deliberate code/hash review. Candidate asset metadata is independently pinned too.

Supply the exact Claude model identifier deliberately. `latest` aliases and invalid identifiers are refused. The tool does not discover models, buy access or fall back to generation. Each run records its model and evaluation date and produces different profile hashes for different model generations or returned evidence. One model's result never certifies another.

Live execution accepts a key only from the local `AIFT_ANTHROPIC_COUNTING_KEY` environment variable. Do not put its value in command arguments, source, fixture data, reports, shell history or a chat. Use an approved local secret-injection method. The SDK receives that explicit key and a fixed API origin; environment proxy/base-URL overrides are not used. Debug logging must be disabled. Reports retain fixed failure codes, never SDK exception text, headers, credentials, fixture text or provider response bodies.

## Offline verification

From the repository root:

```sh
uv sync --project calibration/anthropic --frozen --group dev --link-mode copy
uv run --project calibration/anthropic --frozen --group dev ruff check calibration/anthropic
uv run --project calibration/anthropic --frozen --group dev python -m pytest -c calibration/anthropic/pyproject.toml calibration/anthropic/tests
```

`--link-mode copy` avoids OneDrive hardlink errors on the development host. It does not change the locked packages. Tests exercise the actual SDK, counting-only transport, null failures, retries, auth/model aborts, zero-reference arithmetic, deterministic hashes, separate model generations and training-only candidate selection. No test requires a key or provider traffic.

## Plan and explicit run

The default is a plan. This example uses a deliberately non-production model placeholder:

```sh
uv run --project calibration/anthropic --frozen python calibration/anthropic/calibrate.py --corpus calibration/tokenizer-golden.json --model claude-exact-model-id
```

Only after a real reference run is authorized, the exact model is selected and the environment key is supplied, add `--execute --output /protected/local/path/report.json`. The output path must be new. Existing reports are never overwritten. `--max-cases N` bounds a smoke run, whose report stays incomplete unless it covers the entire corpus successfully. Ordinary CI and employee operation never use `--execute`.

Calls are separated by at least one second, with at most three attempts per case and bounded exponential retry delays for rate/transient failures. Authentication or model/request rejection stops the run. Each failed reference remains null with a sanitized reason. An incomplete run returns exit code 2 and cannot approve a profile. Unexpected errors emit a fixed blocked result. No raw SDK traceback is printed by the CLI.

## What the report establishes

The two local candidates are the pinned `cl100k_base` and `o200k_base` supplied-text counts in the existing official-tiktoken golden corpus. The API request is one user message containing that same text. The reference is an estimated **structured input** count including its message envelope. Candidate counts cover the **user text only**. This discrepancy is explicit, and no fixed envelope subtraction is fitted. System, tool, multimodal and preserved-thinking request shapes are still missing from this evaluation domain.

Candidate selection uses training mean absolute error only, with a deterministic lexical tie-break. Holdout values never affect selection. Reports publish bias, median/P95 absolute error, mean absolute/relative error and sample counts by split and language/content group. Zero references are excluded from relative-error denominators; they remain legitimate known zero references. Failed references never become zero.

Canonical sorted JSON hashes cover the report and its profile descriptor, including model, SDK version, corpus/candidate hashes, evaluation date and returned numerical evidence. Reports expose no runtime installation/promotion command. Even a complete run is `reference_evaluation_complete_unvalidated`, with `approved: false` and `runtime_selection_allowed: false`. It does not establish consumer-site tokenizer mapping, historical Claude.ai usage, generated-output tokens, cache behavior, hidden reasoning or physical energy accuracy. Counting answer text as a new input does not validate that answer's original output usage. Wider shapes, real holdout evidence and independent methodology review are required before any future profile promotion.

The SDK is pinned to [anthropic 1.4.0 on PyPI](https://pypi.org/project/anthropic/1.4.0/), sourced from [Anthropic's official Python SDK](https://github.com/anthropics/anthropic-sdk-python). Its full MIT license is preserved in `LICENSES/anthropic-MIT.txt`; dependency archives and hashes are locked in `uv.lock`. This isolated development dependency is not added to employee or server distributions.

For a fresh dependency audit, export this exact frozen project to a temporary requirements file with `uv export --project calibration/anthropic --frozen --no-dev --no-emit-project --format requirements-txt --output-file TEMP_REQUIREMENTS`, then run `uvx --from pip-audit==2.10.1 pip-audit --requirement TEMP_REQUIREMENTS --require-hashes --disable-pip`. The 10 September 2026 check reported no known vulnerabilities. This checks advisories, not model validity. Recheck before a maintained reference run.

License review used installed distribution metadata against the frozen lock. The counting SDK and most dependencies declare MIT; HTTPX2, HTTPCore2 and IDNA declare BSD-3-Clause; typing-extensions declares PSF-2.0; sniffio offers MIT OR Apache-2.0. Development tools additionally include BSD-2-Clause, Apache-2.0 OR BSD-2-Clause and Colorama's BSD license. Retain upstream distribution license files when redistributing this maintainer environment; do not infer a runtime license from a package name or omit transitive notices.
