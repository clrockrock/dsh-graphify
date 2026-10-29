/**
 * Graphify plugin for DeepSeek Harness — Client half.
 *
 * Renders the Graphify page that the sidebar icon opens. The page reads the
 * Host's `/graphify/api/*` routes (status, build, report) and renders plain
 * React controls styled with Harness theme tokens; it never imports Harness
 * Client packages, so it keeps working across Host upgrades.
 */
window.__ModuleLoader__.load({
  id: 'dsh-graphify',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'graphify';
    /** Id shared by the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'graphify';
    /** Where the Host mounts the plugin's HTTP surface. */
    const API_BASE = '/graphify';

    /** Simplified Chinese copy. */
    const zh = {
      panel: '知识图谱',
      title: 'Graphify',
      subtitle: '代码库知识图谱：节点、关系与社区，本地 AST 解析',
      refresh: '刷新',
      build: '构建索引',
      update: '增量更新',
      full: '全面抽取',
      buildHint: '构建索引：本地 AST 解析，无需 API Key；增量更新：只重抽变更文件；全面抽取：包含文档/图片，需要 LLM Key',
      pathLabel: '项目目录',
      pathPlaceholder: '留空则使用当前工作目录',
      apply: '应用',
      loading: '正在读取图谱…',
      emptyTitle: '这个项目还没有知识图谱',
      emptyBody: '索引只需本地 AST 解析，不消耗 API Key，也不会修改源码。',
      emptyAction: '开始构建',
      missingCliTitle: '未找到 graphify CLI',
      missingCliBody: '在终端安装后回到这里刷新即可：',
      installCommand: 'uv tool install graphifyy',
      errorTitle: '读取失败',
      retry: '重试',
      nodes: '节点',
      edges: '边',
      communities: '社区',
      graphSize: '图谱体积',
      confidence: '置信度',
      extracted: '已提取',
      inferred: '推断',
      ambiguous: '存疑',
      artifacts: '产物',
      report: '报告',
      html: '交互图',
      wiki: 'Wiki',
      openHtml: '打开交互图',
      showReport: '查看报告',
      hideReport: '收起报告',
      exportWiki: '生成 Wiki',
      godNodes: '上帝节点（连接最多）',
      godNodesEmpty: '暂无数据：重新运行“构建索引”可生成分析。',
      communityList: '社区 Top',
      communitySize: '{n} 个节点',
      reportTitle: 'GRAPH_REPORT.md',
      reportLoading: '正在读取报告…',
      reportMissing: '还没有生成报告。',
      logTitle: '构建日志',
      building: '正在执行…',
      buildDone: '完成',
      buildFailed: '失败',
      noCliHint: '安装：',
      graphFile: '图谱文件',
      version: '版本',
      noData: '—',
      languageNote: '图谱查询也可以直接让 Agent 使用 graphify_* 工具。',
    };

    /** English copy. */
    const en = {
      panel: 'Knowledge Graph',
      title: 'Graphify',
      subtitle: 'Codebase knowledge graph: nodes, relations, and communities from local AST parsing',
      refresh: 'Refresh',
      build: 'Build index',
      update: 'Update',
      full: 'Full extract',
      buildHint: 'Build index: local AST, no API key. Update: re-extract changed files only. Full: docs/images too, needs an LLM key.',
      pathLabel: 'Project directory',
      pathPlaceholder: 'Empty uses the current working directory',
      apply: 'Apply',
      loading: 'Reading the graph…',
      emptyTitle: 'No knowledge graph yet',
      emptyBody: 'Indexing runs locally on the AST: no API key, and your sources are never modified.',
      emptyAction: 'Build now',
      missingCliTitle: 'graphify CLI not found',
      missingCliBody: 'Install it in a terminal, then refresh this page:',
      installCommand: 'uv tool install graphifyy',
      errorTitle: 'Could not read the graph',
      retry: 'Retry',
      nodes: 'Nodes',
      edges: 'Edges',
      communities: 'Communities',
      graphSize: 'Graph size',
      confidence: 'Confidence',
      extracted: 'extracted',
      inferred: 'inferred',
      ambiguous: 'ambiguous',
      artifacts: 'Artifacts',
      report: 'Report',
      html: 'Interactive graph',
      wiki: 'Wiki',
      openHtml: 'Open interactive graph',
      showReport: 'Show report',
      hideReport: 'Hide report',
      exportWiki: 'Export wiki',
      godNodes: 'God nodes (most connected)',
      godNodesEmpty: 'No analysis yet — run "Build index" again to regenerate it.',
      communityList: 'Top communities',
      communitySize: '{n} nodes',
      reportTitle: 'GRAPH_REPORT.md',
      reportLoading: 'Reading the report…',
      reportMissing: 'No report generated yet.',
      logTitle: 'Build log',
      building: 'Running…',
      buildDone: 'Done',
      buildFailed: 'Failed',
      noCliHint: 'Install: ',
      graphFile: 'Graph file',
      version: 'Version',
      noData: '—',
      languageNote: 'Agents can also query the graph directly through the graphify_* tools.',
    };

    /** Page styles: theme tokens only, scoped under .gfy-. */
    const CSS = `
.gfy-page{height:100%;min-height:0;display:flex;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;overflow:hidden}
.gfy-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.gfy-content{max-width:1040px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.gfy-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px;padding-top:28px}
.gfy-heading h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
.gfy-subtitle{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.gfy-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gfy-btn{height:32px;padding:0 12px;border-radius:16px;border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .15s,border-color .15s;text-decoration:none}
.gfy-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.gfy-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.gfy-btn[disabled]{opacity:.5;cursor:default;pointer-events:none}
.gfy-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.gfy-btn-primary:hover{background:var(--dsw-alias-brand-primary);filter:brightness(1.08)}
.gfy-btn-ghost{border-color:transparent}
.gfy-btn-ghost:hover{border-color:transparent}
.gfy-path{display:flex;gap:8px;align-items:center;margin:0 0 18px}
.gfy-input{flex:1;min-width:0;height:36px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:0 12px;outline:none;transition:border-color .15s}
.gfy-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.gfy-input::placeholder{color:var(--dsw-alias-label-caption)}
.gfy-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}
.gfy-tile{border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.gfy-tile-label{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gfy-tile-value{font-size:22px;font-weight:500;line-height:30px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gfy-tile-foot{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gfy-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
@media (max-width:900px){.gfy-row{grid-template-columns:1fr}}
.gfy-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);min-width:0;margin-bottom:14px}
.gfy-card h2{margin:0 0 10px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.gfy-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.gfy-list-row{display:flex;align-items:baseline;gap:10px;padding:4px 6px;border-radius:8px;min-width:0}
.gfy-list-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gfy-rank{width:18px;flex:none;color:var(--dsw-alias-label-caption);font-size:12px;text-align:right;font-variant-numeric:tabular-nums}
.gfy-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.gfy-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
.gfy-notice{border-radius:10px;padding:11px 14px;font-size:12px;line-height:20px;margin-bottom:14px;display:flex;gap:10px;align-items:flex-start;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-secondary)}
.gfy-notice strong{font-weight:500;color:var(--dsw-alias-label-primary)}
.gfy-notice code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-2);padding:1px 6px;border-radius:5px;color:var(--dsw-alias-label-primary)}
.gfy-notice-error{background:transparent;border:.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-secondary)}
.gfy-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:56px 20px;color:var(--dsw-alias-label-tertiary)}
.gfy-empty h2{margin:0;font-size:15px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.gfy-empty p{margin:0;max-width:460px;font-size:13px;line-height:1.65}
.gfy-glyph{color:var(--dsw-alias-brand-primary);margin-bottom:4px}
.gfy-confidence{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:10px}
.gfy-chip{display:inline-flex;align-items:center;gap:5px}
.gfy-dot{width:7px;height:7px;border-radius:50%;display:inline-block}
.gfy-report{margin-top:2px}
.gfy-report pre{max-height:360px;overflow:auto;margin:0;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.gfy-log{margin-top:10px}
.gfy-log pre{max-height:220px;overflow:auto;margin:0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;color:var(--dsw-alias-label-secondary)}
.gfy-badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.gfy-badge{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 9px;font-size:11px;line-height:16px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary)}
.gfy-badge-on{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}
.gfy-ok{color:var(--dsw-alias-state-success-primary)}
.gfy-off{color:var(--dsw-alias-label-caption)}
.gfy-muted{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.gfy-inline-value{font-variant-numeric:tabular-nums}
`;

    /**
     * Sidebar glyph: a small node graph in the row's current color.
     * @param props - the sidebar's icon share (`size`, and whether selected).
     * @returns Decorative graph icon.
     */
    function GraphifyIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 18;
      const stroke = 'currentColor';
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke,
          strokeWidth: 1.4,
          'stroke-linecap': 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', { d: 'M4.5 6.2 9.9 4.1M4.5 6.2l4 5.7M9.9 4.1l4.2 3.2M8.5 11.9l5.6-4.6M8.5 11.9l3.9 4.1M14.1 7.3l2.3 8.7' }),
        h('circle', { cx: 4.5, cy: 6.2, r: 1.7, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 9.9, cy: 4.1, r: 1.5, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 8.5, cy: 11.9, r: 1.9, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 14.1, cy: 7.3, r: 1.5, fill: 'currentColor', stroke: 'none' }),
      );
    }

    /**
     * Fetch one plugin API route and unwrap its `{ ok, value }` envelope.
     * @param path - route path below the API base.
     * @param init - optional fetch init.
     * @returns The unwrapped value.
     */
    async function callApi(path, init) {
      const response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', ...init });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
      if (payload === null || typeof payload !== 'object') throw new Error(`HTTP ${response.status}`);
      if (payload.ok !== true) {
        const message = payload.error !== null && typeof payload.error === 'object' ? payload.error.message : undefined;
        throw new Error(typeof message === 'string' && message !== '' ? message : `HTTP ${response.status}`);
      }
      return payload.value;
    }

    /**
     * Fetch one text/markdown route.
     * @param path - route path below the API base.
     * @returns Response text.
     */
    async function callText(path) {
      const response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    }

    /**
     * Read the remembered project path.
     * @returns Stored path, or an empty string.
     */
    function storedPath() {
      try {
        const value = window.localStorage.getItem('dsh-graphify:project');
        return typeof value === 'string' ? value : '';
      } catch {
        return '';
      }
    }

    /**
     * Remember the project path across page reloads.
     * @param value - absolute project directory.
     */
    function rememberPath(value) {
      try {
        window.localStorage.setItem('dsh-graphify:project', value);
      } catch {
        // Storage may be unavailable in private windows; the page still works.
      }
    }

    /**
     * Human-readable byte count.
     * @param bytes - size in bytes.
     * @returns Display string.
     */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
      if (bytes < 1024) return `${bytes} B`;
      const units = ['KB', 'MB', 'GB'];
      let value = bytes / 1024;
      let index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
      }
      return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
    }

    /**
     * Percentage of a total, safe for a zero total.
     * @param value - part.
     * @param total - whole.
     * @returns Rounded percentage.
     */
    function percentOf(value, total) {
      if (typeof value !== 'number' || !Number.isFinite(value) || total <= 0) return 0;
      return Math.round((value / total) * 100);
    }

    /**
     * One metric tile.
     * @param props - label, value, and optional footnote.
     * @returns Tile element.
     */
    function StatTile({ label, value, foot }) {
      return h(
        'div',
        { className: 'gfy-tile' },
        h('div', { className: 'gfy-tile-label', title: label }, label),
        h('div', { className: 'gfy-tile-value', title: String(value) }, value),
        foot ? h('div', { className: 'gfy-tile-foot', title: foot }, foot) : null,
      );
    }

    /**
     * One artifact badge.
     * @param props - label and presence flag.
     * @returns Badge element.
     */
    function ArtifactBadge({ label, present }) {
      return h(
        'span',
        { className: present ? 'gfy-badge gfy-badge-on' : 'gfy-badge' },
        h('span', { className: present ? 'gfy-ok' : 'gfy-off', 'aria-hidden': true }, present ? '●' : '○'),
        label,
      );
    }

    /**
     * Render the Graphify page.
     * @param props - injected translator.
     * @returns Page element.
     */
    function GraphifyPage(props) {
      const t = typeof props?.t === 'function' ? props.t : (key) => key;
      const [inputPath, setInputPath] = React.useState(storedPath);
      const [projectPath, setProjectPath] = React.useState(storedPath);
      const [state, setState] = React.useState({ phase: 'loading', value: null, error: '' });
      const [busy, setBusy] = React.useState('');
      const [log, setLog] = React.useState('');
      const [logPhase, setLogPhase] = React.useState('');
      const [report, setReport] = React.useState({ open: false, phase: 'idle', text: '', error: '' });

      const query = projectPath !== '' ? `?path=${encodeURIComponent(projectPath)}` : '';

      const refresh = React.useCallback(async () => {
        setState((previous) => ({ phase: 'loading', value: previous.value, error: '' }));
        try {
          const value = await callApi(`/api/status${query}`);
          setState({ phase: 'ready', value, error: '' });
        } catch (error) {
          setState({ phase: 'error', value: null, error: error instanceof Error ? error.message : String(error) });
        }
      }, [query]);

      React.useEffect(() => {
        refresh();
      }, [refresh]);

      React.useEffect(() => {
        if (state.phase !== 'ready' || state.value === null) return;
        if (projectPath !== '') return;
        const detected = typeof state.value.project === 'string' ? state.value.project : '';
        if (detected === '') return;
        setProjectPath(detected);
        setInputPath(detected);
      }, [state, projectPath]);

      const value = state.value;
      const status = value !== null && typeof value === 'object' ? value : null;
      const graph = status?.graph ?? null;
      const graphReady = graph !== null && graph.exists === true && typeof graph.error !== 'string';
      const cliMissing = status !== null && status.cli !== null && typeof status.cli === 'object' && status.cli.found !== true;
      const totals = status?.totals ?? null;
      const artifacts = status?.artifacts ?? null;
      const analysis = status?.analysis ?? null;

      const applyPath = () => {
        const next = inputPath.trim();
        rememberPath(next);
        if (next === projectPath) {
          refresh();
          return;
        }
        setProjectPath(next);
        setReport({ open: false, phase: 'idle', text: '', error: '' });
      };

      const runBuild = async (mode) => {
        setBusy(mode);
        setLog('');
        setLogPhase('running');
        try {
          const result = await callApi('/api/build', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: projectPath, mode }),
          });
          setLog(typeof result?.log === 'string' ? result.log : '');
          setLogPhase('done');
          setReport({ open: false, phase: 'idle', text: '', error: '' });
          await refresh();
        } catch (error) {
          setLog(error instanceof Error ? error.message : String(error));
          setLogPhase('failed');
        } finally {
          setBusy('');
        }
      };

      const exportWiki = async () => {
        setBusy('wiki');
        setLog('');
        setLogPhase('running');
        try {
          const result = await callApi('/api/export', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: projectPath, format: 'wiki' }),
          });
          setLog(typeof result?.text === 'string' ? result.text : '');
          setLogPhase('done');
          await refresh();
        } catch (error) {
          setLog(error instanceof Error ? error.message : String(error));
          setLogPhase('failed');
        } finally {
          setBusy('');
        }
      };

      const toggleReport = async () => {
        if (report.open) {
          setReport((previous) => ({ ...previous, open: false }));
          return;
        }
        setReport((previous) => ({ ...previous, open: true, phase: 'loading', error: '' }));
        try {
          const text = await callText(`/api/report${query}`);
          setReport({ open: true, phase: 'ready', text, error: '' });
        } catch (error) {
          setReport({ open: true, phase: 'error', text: '', error: error instanceof Error ? error.message : String(error) });
        }
      };

      const htmlHref = `${API_BASE}/graph.html${query}`;
      const confidence = graph?.confidence ?? { extracted: 0, inferred: 0, ambiguous: 0 };
      const confidenceTotal = confidence.extracted + confidence.inferred + confidence.ambiguous;

      const header = h(
        'div',
        { className: 'gfy-heading' },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('h1', null, t('title')),
          h('p', { className: 'gfy-subtitle' }, t('subtitle')),
        ),
        h(
          'div',
          { className: 'gfy-actions' },
          h(
            'button',
            { type: 'button', className: 'gfy-btn gfy-btn-ghost', onClick: refresh, disabled: busy !== '', title: t('refresh') },
            t('refresh'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'gfy-btn',
              onClick: () => runBuild('update'),
              disabled: busy !== '' || cliMissing || !graphReady,
              title: t('buildHint'),
            },
            busy === 'update' ? t('building') : t('update'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'gfy-btn',
              onClick: () => runBuild('full'),
              disabled: busy !== '' || cliMissing,
              title: t('buildHint'),
            },
            busy === 'full' ? t('building') : t('full'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'gfy-btn gfy-btn-primary',
              onClick: () => runBuild('code'),
              disabled: busy !== '' || cliMissing,
              title: t('buildHint'),
            },
            busy === 'code' ? t('building') : graphReady ? t('build') : t('emptyAction'),
          ),
        ),
      );

      const pathRow = h(
        'div',
        { className: 'gfy-path' },
        h('input', {
          className: 'gfy-input',
          type: 'text',
          value: inputPath,
          placeholder: t('pathPlaceholder'),
          spellCheck: false,
          'aria-label': t('pathLabel'),
          onChange: (event) => setInputPath(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') applyPath();
          },
        }),
        h('button', { type: 'button', className: 'gfy-btn', onClick: applyPath, disabled: busy !== '' }, t('apply')),
      );

      const cliNotice = cliMissing
        ? h(
            'div',
            { className: 'gfy-notice' },
            h(
              'div',
              null,
              h('strong', null, t('missingCliTitle')),
              h('div', null, t('missingCliBody')),
              h('code', null, t('installCommand')),
            ),
          )
        : null;

      const errorNotice =
        state.phase === 'error'
          ? h(
              'div',
              { className: 'gfy-notice gfy-notice-error' },
              h(
                'div',
                null,
                h('strong', null, t('errorTitle')),
                h('div', null, state.error),
              ),
              h('button', { type: 'button', className: 'gfy-btn', onClick: refresh }, t('retry')),
            )
          : null;

      const loading = state.phase === 'loading' && status === null ? h('div', { className: 'gfy-muted' }, t('loading')) : null;

      const metrics = graphReady
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'gfy-grid' },
              h(StatTile, { label: t('nodes'), value: totals.nodes.toLocaleString(), foot: graph.version ? `${t('version')} ${graph.version}` : '' }),
              h(StatTile, { label: t('edges'), value: totals.edges.toLocaleString(), foot: '' }),
              h(StatTile, { label: t('communities'), value: totals.communities.toLocaleString(), foot: '' }),
              h(StatTile, { label: t('graphSize'), value: formatBytes(graph.bytes), foot: '' }),
            ),
            h(
              'div',
              { className: 'gfy-badges' },
              h(ArtifactBadge, { label: t('report'), present: artifacts?.report === true }),
              h(ArtifactBadge, { label: t('html'), present: artifacts?.html === true }),
              h(ArtifactBadge, { label: t('wiki'), present: artifacts?.wiki === true }),
              h(
                'span',
                { className: 'gfy-confidence' },
                h('span', { className: 'gfy-chip' }, h('span', { className: 'gfy-dot', style: { background: 'var(--dsw-alias-state-success-primary)' } }), `${t('extracted')} ${percentOf(confidence.extracted, confidenceTotal)}%`),
                h('span', { className: 'gfy-chip' }, h('span', { className: 'gfy-dot', style: { background: 'var(--dsw-alias-state-warn-primary)' } }), `${t('inferred')} ${percentOf(confidence.inferred, confidenceTotal)}%`),
                h('span', { className: 'gfy-chip' }, h('span', { className: 'gfy-dot', style: { background: 'var(--dsw-alias-state-idle-primary)' } }), `${t('ambiguous')} ${percentOf(confidence.ambiguous, confidenceTotal)}%`),
              ),
            ),
            h(
              'div',
              { className: 'gfy-actions', style: { marginBottom: '16px' } },
              h('a', { className: 'gfy-btn', href: htmlHref, target: '_blank', rel: 'noreferrer' }, t('openHtml')),
              h('button', { type: 'button', className: 'gfy-btn', onClick: toggleReport }, report.open ? t('hideReport') : t('showReport')),
              h(
                'button',
                { type: 'button', className: 'gfy-btn', onClick: exportWiki, disabled: busy !== '' },
                busy === 'wiki' ? t('building') : t('exportWiki'),
              ),
            ),
            h(
              'div',
              { className: 'gfy-row' },
              h(
                'div',
                { className: 'gfy-card' },
                h('h2', null, t('godNodes')),
                Array.isArray(analysis?.gods) && analysis.gods.length > 0
                  ? h(
                      'ol',
                      { className: 'gfy-list' },
                      analysis.gods.slice(0, 10).map((node, index) =>
                        h(
                          'li',
                          { className: 'gfy-list-row', key: `${node.id}:${index}`, title: node.id },
                          h('span', { className: 'gfy-rank' }, index + 1),
                          h('span', { className: 'gfy-name' }, node.label || node.id),
                          h('span', { className: 'gfy-meta' }, `${node.degree}`),
                        ),
                      ),
                    )
                  : h('div', { className: 'gfy-muted' }, t('godNodesEmpty')),
              ),
              h(
                'div',
                { className: 'gfy-card' },
                h('h2', null, t('communityList')),
                Array.isArray(graph.communities) && graph.communities.length > 0
                  ? h(
                      'ol',
                      { className: 'gfy-list' },
                      graph.communities.slice(0, 8).map((community, index) =>
                        h(
                          'li',
                          { className: 'gfy-list-row', key: `${community.id}:${index}`, title: community.labels.join(', ') },
                          h('span', { className: 'gfy-rank' }, index + 1),
                          h('span', { className: 'gfy-name' }, community.name || `#${community.id}`),
                          h('span', { className: 'gfy-meta' }, t('communitySize', { n: community.size })),
                        ),
                      ),
                    )
                  : h('div', { className: 'gfy-muted' }, t('godNodesEmpty')),
              ),
            ),
            report.open
              ? h(
                  'div',
                  { className: 'gfy-card gfy-report' },
                  h('h2', null, t('reportTitle')),
                  report.phase === 'loading'
                    ? h('div', { className: 'gfy-muted' }, t('reportLoading'))
                    : report.phase === 'error'
                      ? h('div', { className: 'gfy-notice gfy-notice-error' }, h('div', null, report.error))
                      : h('pre', null, report.text),
                )
              : null,
          )
        : null;

      const emptyState =
        state.phase === 'ready' && status !== null && !graphReady && !cliMissing
          ? h(
              'div',
              { className: 'gfy-empty' },
              h(
                'div',
                { className: 'gfy-glyph' },
                h(
                  'svg',
                  { width: 40, height: 40, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, 'aria-hidden': true },
                  h('path', { d: 'M4.5 6.2 9.9 4.1M4.5 6.2l4 5.7M9.9 4.1l4.2 3.2M8.5 11.9l5.6-4.6M8.5 11.9l3.9 4.1M14.1 7.3l2.3 8.7' }),
                  h('circle', { cx: 4.5, cy: 6.2, r: 1.3, fill: 'currentColor', stroke: 'none' }),
                  h('circle', { cx: 9.9, cy: 4.1, r: 1.2, fill: 'currentColor', stroke: 'none' }),
                  h('circle', { cx: 8.5, cy: 11.9, r: 1.5, fill: 'currentColor', stroke: 'none' }),
                  h('circle', { cx: 14.1, cy: 7.3, r: 1.2, fill: 'currentColor', stroke: 'none' }),
                ),
              ),
              h('h2', null, t('emptyTitle')),
              h('p', null, t('emptyBody')),
              h(
                'button',
                { type: 'button', className: 'gfy-btn gfy-btn-primary', onClick: () => runBuild('code'), disabled: busy !== '' },
                busy === 'code' ? t('building') : t('emptyAction'),
              ),
            )
          : null;

      const buildLog =
        log !== ''
          ? h(
              'div',
              { className: 'gfy-card gfy-log' },
              h(
                'h2',
                null,
                `${t('logTitle')} · ${logPhase === 'failed' ? t('buildFailed') : logPhase === 'done' ? t('buildDone') : t('building')}`,
              ),
              h('pre', null, log),
            )
          : null;

      const graphFileLine = graphReady
        ? h('div', { className: 'gfy-muted', style: { marginBottom: '10px', wordBreak: 'break-all' } }, `${t('graphFile')}: ${graph.path}`)
        : null;

      return h(
        'section',
        { className: 'gfy-page', 'aria-label': t('panel') },
        h('style', null, CSS),
        h(
          'div',
          { className: 'gfy-scroll' },
          h(
            'div',
            { className: 'gfy-content' },
            header,
            cliNotice,
            errorNotice,
            pathRow,
            loading,
            graphFileLine,
            metrics,
            emptyState,
            buildLog,
            h('div', { className: 'gfy-muted', style: { marginTop: '8px' } }, t('languageNote')),
          ),
        ),
      );
    }

    /**
     * Register dictionaries, the sidebar entry, and the page it opens.
     * @param ctx - browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-graphify: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            inject: () => ({ t }),
          },
          GraphifyPage,
        ),
      );
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 40,
            label: () => t('panel'),
          },
          GraphifyIcon,
        ),
      );
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
