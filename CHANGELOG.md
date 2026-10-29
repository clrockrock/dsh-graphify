# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-29

### Added

- Seven Agent tools: `graphify_status`, `graphify_build`, `graphify_query`,
  `graphify_path`, `graphify_explain`, `graphify_god_nodes`, `graphify_export`.
- `/graphify` command with `status`, `build [code|update|full]`, `query`,
  `path`, `explain`, `god`, and `export` subcommands.
- Graphify page in the Web UI: graph statistics, confidence breakdown, god
  nodes, communities, `GRAPH_REPORT.md` preview, interactive `graph.html`
  entry point, and build/update/export actions.
- Read-only HTTP API (`/graphify/api/status`, `/graphify/api/report`,
  `/graphify/api/build`, `/graphify/api/export`, `/graphify/graph.html`).
- Local AST builds (`code`, `update`) that need no LLM or API key, plus `full`
  extraction for docs/PDFs/images through an LLM backend.
- Unit tests for configuration, graph inspection, CLI classification, the
  operations layer, the plugin wiring, and the packaging contract.

[0.1.0]: https://github.com/clrockrock/dsh-graphify/releases/tag/v0.1.0
