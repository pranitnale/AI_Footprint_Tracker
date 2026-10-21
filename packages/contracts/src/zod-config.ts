import { config } from "zod";

// Zod compiles a fast parser for object schemas with the Function constructor, after
// probing for it with `new Function("")` when the first object schema is made. The capture
// script runs these schemas inside provider pages; Gemini and NotebookLM enforce Trusted
// Types, so the probe was blocked and reported as a console error on every page load
// (19 Oct 2026), and extension pages forbid it anyway. Without the compiled parser every
// schema parses the same, so generated code is never used. This module must be the first
// import of the package, before any schema is made.
config({ jitless: true });
