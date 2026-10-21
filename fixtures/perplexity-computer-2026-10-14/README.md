# Perplexity Computer task with files, 14 October 2026

`computer-task-thread.json` is a synthetic copy of the thread read (`GET /rest/thread/<task id>`)
of a Perplexity Computer task that created two files, captured live on 14 October 2026 on the
owner's test account.

Copied from the capture, structure and values:

- The `unified_assets` block: two preview assets (ids that are tool call ids, a media type, no
  size or link) and two final assets (`is_primary_asset`, `root_asset_id`, `code_file.file_size`
  410 and 308, `code_file.url`, the same link and size in `download_info`).
- `display_model` `pplx_asi_opus` and `active_computer_harness_mode`
  `{harness_mode: "standard", version: 1}`.
- The order of the entry's block usages: `plan`, `workflow_root`, `unified_assets`,
  `pending_followups`.

Synthetic or redacted:

- Ids of the entry and thread, the prompt, the answer text and the dates. The live task id was
  used as the thread id in the address (`/computer/tasks/<id>`) and in the thread read; that the
  entry's `thread_url_slug` and first `backend_uuid` equal it is assumed here, as on search
  threads, and needs a live check.
- Signed links point to `files.example.invalid` with a placeholder signature; the real host and
  signatures are never written to the repository. Slugs, share ids and preview text are redacted.
- The live workflow had five steps; steps 0 to 3 held items with `payload.sources_payload`
  (`asset_uuids`) whose item type was not recorded. Only the final answer item is kept.
- The `plan` and `pending_followups` block contents are reduced to empty values.

Downloading `code_file.url` from the page with `credentials: "omit"` returned 200,
`text/x-python` and `text/plain`, and exactly `file_size` bytes. The file text is not in the
thread JSON.
