<p align="center">
  <img src="assets/icon-256.png" width="96" alt="dsh-graphify 图标">
</p>

# dsh-graphify

中文 | [English](README.md)

把代码库变成可查询的知识图谱，接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）：本地建图、让 Agent 查询、或在 Web 页面里浏览。图谱由 [graphify](https://github.com/Graphify-Labs/graphify) 构建，本插件是它在 dsh 上的集成。

- **7 个 Agent 工具** —— `graphify_status`、`graphify_build`、`graphify_query`、`graphify_path`、`graphify_explain`、`graphify_god_nodes`、`graphify_export`。
- **`/graphify` 命令** —— `status`、`build`、`query`、`path`、`explain`、`god`、`export`，由 Host 直接执行，不把这一行发给模型。
- **Graphify 页面** —— 图谱统计、置信度分布、上帝节点、社区、`GRAPH_REPORT.md` 预览、交互式 `graph.html`，以及构建/更新/导出按钮。

代码索引（`code` 与 `update` 模式）完全在本机用 tree-sitter AST 完成：**不需要 API Key、不联网、不改动被索引的源码**——graphify 只写自己的 `graphify-out/` 目录。

## 前置条件

| 条件 | 说明 |
| :--- | :--- |
| DeepSeek Harness `0.2.1-rc.2` 及以上 | 在 `0.2.1-rc.2` 上验证。页面使用 `main` 插槽与侧栏面板列表。 |
| Node.js 20+ | Host 本身的要求；插件没有其他运行时依赖。 |
| `graphify` CLI | `uv tool install graphifyy`（或 `pipx install graphifyy`）。插件依次探测 `PATH` 上的 `graphify`、`~/.local/bin`、uv / pipx 安装位置。 |
| LLM API Key | 仅 `full` 模式抽取文档/PDF/图片时需要；`code` 与 `update` 永远不需要。 |

## 安装

在终端：

```sh
dsh plugin --profile web add github:clrockrock/dsh-graphify
```

收录进插件市场后，也可以在 **Plugins → Discover** 搜索 `graphify` 安装。

然后重启 `dsh web`。每个 [Release](https://github.com/clrockrock/dsh-graphify/releases) 都附带预构建 tarball，可跳过源码拉取直接安装。

安装插件所驱动的 CLI：

```sh
uv tool install graphifyy
```

重启后让 Agent 调用 `graphify_status`，或点侧栏的 Graphify 图标。

## 快速开始

1. 建图 —— 让 Agent「给这个项目建图」、执行 `/graphify build code`，或在页面上点 **构建索引**。
2. 查询 —— 问「A 模块怎么到达 B 模块」、执行 `/graphify query ...`，或在页面上看报告与交互图。
3. 保持最新 —— `/graphify update`（或页面上的 **增量更新**）只重抽变更的代码文件。

## Agent 工具

| 工具 | 作用 |
| :--- | :--- |
| `graphify_status` | CLI 是否可用及版本、图谱路径、节点/边/社区数、EXTRACTED/INFERRED/AMBIGUOUS 分布、产物是否存在、建议问题。 |
| `graphify_build` | 建图或刷新：`code`（本地 AST，无需 Key）、`update`（增量，无需 Key）、`full`（经 LLM 加入文档/PDF/图片）。 |
| `graphify_query` | 对图谱提自然语言问题；BFS 取广度上下文，DFS 追一条依赖链。 |
| `graphify_path` | 两个概念之间的最短路径，每一跳与关系都列出来。 |
| `graphify_explain` | 单个节点的文件、位置、社区、度数与邻居。 |
| `graphify_god_nodes` | 连接最多的节点——架构枢纽。 |
| `graphify_export` | 导出 `wiki`、`html`、`svg`、`graphml` 或 `obsidian` 产物到 `graphify-out/`。 |

所有工具都可传可选 `path`；不传时默认使用当前 Session 工作目录（或插件配置的 `projectPath`）。

## 命令

```text
/graphify status
/graphify build [code|update|full]
/graphify query <问题>
/graphify path <起点> <终点>
/graphify explain <节点>
/graphify god
/graphify export <wiki|html|svg|graphml|obsidian>
```

## Graphify 页面

侧栏图标打开的页面读取插件自己的 HTTP 接口，样式只使用 Harness 主题 token，跟随 Host 的明暗主题：

- 图谱统计与置信度分布；
- 上帝节点与最大的社区；
- **查看报告** 原地渲染 `GRAPH_REPORT.md`；
- **打开交互图** 打开项目里的 `graph.html`；
- **构建索引**、**增量更新**、**全面抽取**、**生成 Wiki** 与工具走同一套操作。

页面自身不持有数据：它向 `/graphify/api/status` 询问要展示哪个项目。改项目目录即可切换。

## 配置

所有字段都有默认值，空配置即可工作。需要覆盖时，在 profile patch（`~/.dsh/profiles/<profile>/cordis.patch.yml`）里改这一行：

```yaml
- id: dsh-graphify
  name: dsh-graphify
  config:
    command: graphify          # 可执行文件名或绝对路径
    extraArgs: []              # command 为 uvx 时写 [graphifyy]
    projectPath: ''            # 默认项目；留空 = Session 工作目录
    graphPath: ''              # 显式 graph.json；留空 = <project>/graphify-out/graph.json
    buildTimeoutMs: 1800000    # 每次构建/更新/导出的截止时间
    queryTimeoutMs: 120000     # 每次查询/路径/解释的截止时间
```

## 构建模式

| 模式 | 上游命令 | 需要 LLM Key | 用途 |
| :--- | :--- | :--- | :--- |
| `code` | `graphify extract <dir> --code-only`，再 `cluster-only --no-label` | 否 | 首次索引；产出 `graph.json`、`GRAPH_REPORT.md`、`graph.html`。 |
| `update` | `graphify update <dir>` | 否 | 改完代码后增量重抽并合并。 |
| `full` | `graphify extract <dir>` | 是 | 经 graphify 配置的 LLM 后端加入文档、PDF、图片。 |

## HTTP 接口

Client 半是一个纯 JS 加载模块，读取 Host 行挂载的 5 条同源路由：

| 路由 | 返回 |
| :--- | :--- |
| `GET /graphify/api/status?path=` | CLI、项目、图谱、产物与分析事实的 JSON。 |
| `POST /graphify/api/build` | `{ path, mode, force? }` → 构建结果与日志尾部。 |
| `POST /graphify/api/export` | `{ path, format }` → 产物路径。 |
| `GET /graphify/api/report?path=` | `GRAPH_REPORT.md`（text/markdown）。 |
| `GET /graphify/graph.html?path=` | 项目的交互式图谱页面。 |

## 实现方式

插件不重写建图、查询排序与报告渲染。它解析项目、拼装上游 CLI 参数、用超时约束运行、对结果分类（包括 graphify 的 `3 = 名称歧义`、`4 = 无匹配` 退出码），再渲染结果。

```
index.js              Host 接线：工具、命令、HTTP 路由、Config
lib/core.js           图谱事实与路径处理（有单测）
lib/cli.js            唯一的 graphify CLI 子进程边界
lib/operations.js     build / query / path / explain / god / export
lib/config.js         可选的 schemastery Config 声明
client.js             浏览器半：侧栏图标 + Graphify 页面
cordis.patch.yml      bundle patch（一行 Host 插件）
```

Host 半只导入 Node 内建模块，因此工作区 link 安装与发布包解析方式一致。

## 范围与安全

- 无遥测、无后台网络请求。`code` 与 `update` 不联网；`full` 通过你为 graphify 配置的 Key 调用它自己的 LLM 后端。
- 插件只（经 graphify）写入 `<project>/graphify-out/`，不修改被索引源码。
- HTTP 路由只提供状态、报告文本、项目自己的 `graph.html` 与显式构建/导出动作；仅同源、运行在本机 Host 上，不存在绕过鉴权的入口。
- 图谱读取有上限（graph 文件 128 MiB、CLI 输出 8 MiB、页面报告 512 KiB），超限时降级为提示而不是无界加载。

## 验证

已在 `graphify 0.9.97` + DeepSeek Harness `0.2.1-rc.2` 上验证：4 文件小语料与插件自身源码的本地建图、7 个工具经真实 Agent 工具注册表调用、`/graphify` 各子命令、HTTP 接口端到端。`npm test` 覆盖配置、图谱读取、CLI 分类、操作层、插件接线与打包契约；需要 CLI 的集成测试在未安装时自动跳过。

## 限制

- 图谱质量与语言覆盖取决于 graphify；插件不增加自己的抽取能力。
- `full` 模式依赖 graphify 配置的 LLM 后端，大语料可能耗时数分钟。
- 页面展示 graphify 生成的产物，不内嵌第二个图谱查看器。

## 开发

```sh
npm test          # node --test test/
npm run check     # 语法检查 + 测试
```

`test/fixtures/corpus` 是对 4 个小模块的真实 graphify 构建结果，提交进仓库以便无 CLI 时也能跑图谱读取测试。

## 许可证

MIT，见 [LICENSE](LICENSE)。[graphify](https://github.com/Graphify-Labs/graphify) 是 Graphify Labs 的独立项目（Apache-2.0）；本插件是集成层，与其无隶属关系。
