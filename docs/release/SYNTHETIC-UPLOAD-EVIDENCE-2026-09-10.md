# Synthetic provider upload evidence

The user approved the bounded synthetic tests on 10 September 2026. The conductor is limiting this continuation to six new generation prompts and the prepared text-file upload on each of the four supported provider sites. No purchase, subscription, security-setting change or unrelated file is authorized by this test record.

The prepared three-line file contains only a software-test description and `FERN-ATTACHMENT-042`. Its bytes and SHA-256 are recorded in the [minimized fixture](../../fixtures/provider-uploads-2026-09-10.json). Identifiers are synthetic replacements preserving equality. Signed URLs, authenticated headers, account metadata and raw response bodies are not retained.

The conductor independently counted the prepared bytes with official tiktoken 0.14.0, `o200k_base.encode_ordinary`: **33 tokens**. This manual oracle used the existing local reference package and a read-only loader that checked the cached encoding against the library's expected SHA-256 and prohibited downloads. No ad hoc dependency path was added to the production app or repository test runner. This checks a local reference count, not a provider's tokenizer mapping or execution usage.

## ChatGPT

One upload and one generation prompt completed in a fresh chat in the in-app browser. The visible reply exactly matched the file marker. This did not install or exercise the tracker extension.

The upload first reserved an identity through a Fetch POST to `/backend-api/files/upload_reservations`. The actual upload was an **XHR PUT** to exactly the returned signed URL. A Fetch POST to `claim_and_finish` then supplied the file metadata and returned four newline-delimited JSON progress events. The same file identity appeared in the reservation, claim response and sent generation request.

The generation request used `/backend-api/f/conversation`. Its message content contained only a string; the file reference was in `messages[0].metadata.attachments`. The attachment had the approved filename, 158-byte size, `text/plain` MIME type, `source: local` and a library identifier. This establishes a new-upload association for this observed flow. It also shows why counting only non-string content parts misses this document.

CDP returned no post data for the selected XHR upload. This limits evidence about the original JavaScript body representation and prevents a wire-byte hash claim. The selected generation response contained 26 decoded SSE data frames and a done marker. No numeric property whose key contained `token` or `usage` was found by the bounded structural inspection; this is not a claim that the provider never exposes usage elsewhere.

The file remains in the provider's normal uploaded-file storage. No provider data was deleted. Network observation was disabled and raw working captures were released after minimization.

## Perplexity

One upload and one generation prompt completed in a fresh session in the in-app browser. The visible reply exactly matched the file marker. The tracker extension was not installed or exercised.

A Fetch POST to `/rest/uploads/batch_create_upload_urls` supplied a `files` object keyed by a client UUID. Its result used the same object key and returned a different `file_uuid`, an object URL, a bucket URL and signed multipart fields. The subsequent Fetch POST went to exactly the returned bucket URL and completed with HTTP 204. CDP exposed the multipart field names and the approved filename, but did not include the file marker. This does not establish a hash of the transmitted bytes or the original JavaScript body representation.

The attachment-processing subscription sent the returned file UUID. The generation request to `/rest/sse/perplexity_ask` used a one-element string array at `params.attachments`; its entry exactly equaled the returned object URL. That URL contained the returned file UUID and did not contain the client UUID. Actual identifiers, object URLs and signed multipart values were not retained.

Selected request/response event reads were not truncated. CDP could not return the processing or generation response bodies, and no generation `loadingFinished` event appeared in the selected capture. The visible marker reply confirms the provider read this file, but does not establish complete stream capture or token-usage fields. Network observation was disabled and raw working captures were released after minimization.

## Claude

One upload and one generation prompt completed in a fresh chat in the in-app browser. The visible reply exactly matched the file marker. An unrelated payment-verification prompt was dismissed with "Not now"; no payment action or setting change was performed. The tracker extension was not installed or exercised.

The Fetch multipart upload used `/api/organizations/<organization_uuid>/conversations/<conversation_uuid>/wiggle/upload-file` with one `file` part. HTTP 200 returned a file UUID, path and metadata. The returned `file_kind: blob` is provider metadata, not evidence of the JavaScript body type. CDP included the approved filename but omitted the file marker from multipart post data.

The generation endpoint was `/api/organizations/<organization_uuid>/chat_conversations/<conversation_uuid>/completion`. The request was gzip-encoded JSON; CDP explicitly returned base64-encoded binary, which was decompressed locally in memory with a 1 MiB limit. Inspection was restricted to attachment fields. The single `attachments` entry contained `file_name`, `file_type`, `file_size`, `extracted_content`, `origin: user_upload` and `kind: file`. Its extracted content exactly equaled the prepared text file. The `files` array was empty, and the attachment carried no upload UUID. Matching by filename alone would therefore be invalid; the inline attachment text is itself directly observed dispatch data.

The selected completion response contained ten decoded SSE data frames ending in `message_stop`, and its `loadingFinished` event was observed. No numeric or null property whose key contained `token` or `usage` appeared in the bounded structural inspection. This does not prove that usage is absent elsewhere. Network observation was disabled and authenticated working captures were released after minimization.

## Gemini

The file-upload control opened a new "Creating content from images and files" agreement. User confirmation is pending. No file was uploaded and no generation prompt was sent for this provider in this continuation. Network observation was disabled while the agreement waits.

## Follow-up boundary

One additional prompt in the same ChatGPT chat and one in the same Perplexity session asked for the earlier file marker without another upload. Both visible replies returned it. ChatGPT sent one user message with string content and no `metadata.attachments` field. Perplexity sent `params.attachments: []` and a `last_backend_uuid`. Both selected event reads were nontruncated. Authenticated working captures were released and network observation was disabled afterward.

These replies cannot distinguish prior-answer context from retained-file retrieval or other internal provider processing. An empty current attachment list does not prove there was no retained file work. Do not reclassify an old upload as new, or recount retained file text without a separately observed association.

The continuation budget currently stands at five of six new generation prompts and three observed uploads. The remaining prompt is reserved for the Gemini test if its agreement is approved.
