<p align="center">
  <img src="assets/icon-256.png" width="96" alt="dsh-graphify icon">
</p>

# dsh-graphify

[中文](README.zh.md) | English

Codebase knowledge graphs for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): build a project's graph locally, query it from the Agent, or browse it in the Web UI. The graph is built by [graphify](https://github.com/Graphify-Labs/graphify) — this plugin is the dsh integration.

- **Seven Agent tools** — `graphify_status`, `graphify_build`, `graphify_query`, `graphify_path`, `graphify_explain`, `graphify_god_nodes`, `graphify_export`.
- **A `/graphify` command** — `status`, `build`, `query`, `path`, `explain`, `god`, `export`, run by the Host without sending the line to the model.
- **A Graphify page** — graph statistics, confidence breakdown, god nodes, communities, `GRAPH_REPORT.md` preview, the interactive `graph.html`, and build/update/export actions.

Code indexing (`code` and `update` modes) runs entirely on your machine with tree-sitter AST parsing: **no API key, no network, and your sources are never modified** — graphify only writes its own `graphify-out/` directory.

## Requirements

| Requirement | Notes |
| :--- | :--- |
| DeepSeek Harness `0.2.1-rc.2` or newer | Tested on `0.2.1-rc.2`. The page uses the `main` slot and the sidebar panel list. |
| Node.js 20+ | The Host requirement; the plugin has no other runtime dependency. |
| `graphify` CLI | `uv tool install graphifyy` (or `pipx install graphifyy`). The plugin probes `graphify` on `PATH`, then `~/.local/bin`, then the uv/pipx install roots. |
| An LLM API key | Only for `full` builds that extract docs, PDFs, and images. `code` and `update` never need one. |

## Install

From the plugin market: open **Plugins → Discover**, search for `dsh-graphify`, and install it. From a terminal:

```sh
dsh plugin --profile web add github:clrockrock/dsh-graphify
```

Then restart `dsh web`. A prebuilt tarball is attached to every [release](https://github.com/clrockrock/dsh-graphify/releases) for installs that should skip the source checkout.

Install the CLI the plugin drives:

```sh
uv tool install graphifyy
```

After the restart, ask the Agent `graphify_status`, or open the Graphify icon in the sidebar.

## Quick start

1. Build a graph for the current project — ask the Agent to "build the graph for this project", run `/graphify build code`, or click **Build index** on the Graphify page.
2. Query it — ask "how does module A reach module B?", run `/graphify query ...`, or read the report and interactive graph from the page.
3. Keep it current — `/graphify update` (or the page's **Update** button) re-extracts only changed code files.

## Agent tools

| Tool | What it does |
| :--- | :--- |
| `graphify_status` | CLI availability and version, graph path, node/edge/community counts, EXTRACTED/INFERRED/AMBIGUOUS breakdown, artifact presence, and suggested questions. |
| `graphify_build` | Builds or refreshes the graph: `code` (local AST, no key), `update` (incremental, no key), or `full` (adds docs/PDFs/images through an LLM). |
| `graphify_query` | Natural-language question over the graph; BFS for broad context or DFS to trace one chain. |
| `graphify_path` | Shortest path between two concepts, with every hop and relation. |
| `graphify_explain` | One node's file, location, community, degree, and neighbors. |
| `graphify_god_nodes` | The most connected nodes — the architectural hubs. |
| `graphify_export` | Exports `wiki`, `html`, `svg`, `graphml`, or `obsidian` artifacts into `graphify-out/`. |

Every tool takes an optional `path`; without it the project defaults to the Session working directory (or the plugin's configured `projectPath`).

## Command

```text
/graphify status
/graphify build [code|update|full]
/graphify query <question>
/graphify path <source> <target>
/graphify explain <node>
/graphify god
/graphify export <wiki|html|svg|graphml|obsidian>
```

## Graphify page

The sidebar entry opens a page that reads the plugin's own HTTP surface, styled with Harness theme tokens and following the Host's light/dark theme:

- graph statistics and the confidence breakdown;
- god nodes and the largest communities;
- **Show report** renders `GRAPH_REPORT.md` in place;
- **Open interactive graph** opens `graph.html` from the project;
- **Build index**, **Update**, **Full extract**, and **Export wiki** run the same operations as the tools.

The page has no data of its own: it asks `/graphify/api/status` for the project it should display. Type a different project directory to switch.

## Configuration

Every field has a default; an empty config is valid. Override the row in your profile patch (`~/.dsh/profiles/<profile>/cordis.patch.yml`) when needed:

```yaml
- id: dsh-graphify
  name: dsh-graphify
  config:
    command: graphify          # executable name or absolute path
    extraArgs: []              # e.g. [graphifyy] when command is uvx
    projectPath: ''            # default project; empty = Session working directory
    graphPath: ''              # explicit graph.json; empty = <project>/graphify-out/graph.json
    buildTimeoutMs: 1800000    # per build/update/export deadline
    queryTimeoutMs: 120000     # per query/path/explain deadline
```

## Build modes

| Mode | Upstream command | Needs an LLM key | Use it for |
| :--- | :--- | :--- | :--- |
| `code` | `graphify extract <dir> --code-only`, then `cluster-only --no-label` | No | First index; writes `graph.json`, `GRAPH_REPORT.md`, `graph.html`. |
| `update` | `graphify update <dir>` | No | After code changes; re-extracts changed files only. |
| `full` | `graphify extract <dir>` | Yes | Adds docs, PDFs, and images through the configured graphify LLM backend. |

## HTTP surface

The Client half is a plain-JS loader module and reads five same-origin routes mounted by the Host row:

| Route | Returns |
| :--- | :--- |
| `GET /graphify/api/status?path=` | CLI, project, graph, artifact, and analysis facts as JSON. |
| `POST /graphify/api/build` | `{ path, mode, force? }` → build result and log tail. |
| `POST /graphify/api/export` | `{ path, format }` → produced artifact path. |
| `GET /graphify/api/report?path=` | `GRAPH_REPORT.md` as text/markdown. |
| `GET /graphify/graph.html?path=` | The project's interactive graph page. |

## How it works

The plugin never reimplements graph building, query scoring, or report rendering. It resolves the project, assembles the upstream CLI arguments, bounds the run with a deadline, classifies the outcome (including graphify's `3 = ambiguous name` and `4 = no match` exit codes), and renders the result.

```
index.js              Host wiring: tools, command, HTTP routes, Config
lib/core.js           Graph facts and path handling (unit-tested)
lib/cli.js            The one subprocess seam over the graphify CLI
lib/operations.js     build / query / path / explain / god / export
lib/config.js         Optional schemastery Config schema
client.js             Browser half: sidebar icon + Graphify page
cordis.patch.yml      Bundle patch (one Host row)
```

The Host half imports only Node built-ins, so a workspace-linked bundle resolves the same way a published package does.

## Scope and safety

- No telemetry, no background network calls. `code` and `update` never contact the network; `full` delegates to graphify's LLM backend with the key you configured for graphify.
- The plugin writes only inside `<project>/graphify-out/` (through graphify) and never edits indexed sources.
- The HTTP routes serve status, report text, the project's own `graph.html`, and explicit build/export actions. They are same-origin only and run on the local Host; there is no authentication bypass.
- Graph inspection is capped (128 MiB graph file, 8 MiB CLI output, 512 KiB report served to the page); larger inputs degrade to a message instead of loading unbounded data.

## Verified

Tested against `graphify 0.9.97` and DeepSeek Harness `0.2.1-rc.2`: local builds on a 4-file corpus and on the plugin's own source, all seven tools through the real Agent tool registry, `/graphify` subcommands, and the HTTP surface end to end. `npm test` covers configuration, graph inspection, CLI classification, the operations layer, plugin wiring, and the packaging contract; integration tests that need the CLI skip automatically when it is absent.

## Limitations

- Graph quality and language coverage are graphify's; the plugin adds no extraction of its own.
- `full` builds depend on graphify's configured LLM backend and can take minutes on large corpora.
- The page renders the artifacts graphify generates; it does not embed a second graph viewer.

## Development

```sh
npm test          # node --test test/
npm run check     # syntax checks + tests
```

The test fixture under `test/fixtures/corpus` is a real graphify build of four small modules, committed so graph-inspection tests run without the CLI.

## License

MIT — see [LICENSE](LICENSE). [graphify](https://github.com/Graphify-Labs/graphify) is a separate project by Graphify Labs (Apache-2.0); this plugin is an integration and is not affiliated with it.
