import type { DailyMetric, ExecutionLogEntry, SessionState, StatsSnapshot, UserSettings } from "./types"

export interface PanelViewModel {
  settings: UserSettings
  session: SessionState
  stats: StatsSnapshot
}

export interface PanelViewOptions {
  variant?: "popup" | "drawer"
}

export function buildPanelMarkup(model: PanelViewModel, options: PanelViewOptions = {}): string {
  const variant = options.variant ?? "popup"
  const themeNames = model.settings.themes.map((theme) => theme.name).join(", ")
  const todayMetric = model.stats.dailyMetrics[model.stats.dailyMetrics.length - 1]
  const logRows = model.stats.recentLogs
    .slice()
    .reverse()
    .slice(0, variant === "drawer" ? 8 : 50)
    .map((entry) => renderLogRow(entry))
    .join("")
  const totalActions = model.session.currentPlan?.actions.length ?? 0
  const currentStep = totalActions === 0 ? 0 : Math.min(model.session.currentActionIndex + 1, totalActions)
  const heroCopy =
    variant === "drawer"
      ? "当前会话与失败定位都在这里，配置仍然放在扩展 popup。"
      : "自动搜索、浏览、停留和低频互动，逐步重塑 X 对账号的兴趣画像。"
  const trendMarkup =
    variant === "drawer"
      ? ""
      : `
    <section class="panel">
      <div class="section-head">
        <div>
          <div class="eyebrow">Trend</div>
          <h2>每日趋势</h2>
        </div>
        <p>最近 7 天训练结果</p>
      </div>
      <div class="trend-head">日期 | 会话 | 成功/失败 | 动作 | 曝光率 | 多样性</div>
      ${
        model.stats.dailyMetrics
          .slice()
          .reverse()
          .map((metric) => renderTrendRow(metric))
          .join("") || '<div class="hint">还没有趋势数据</div>'
      }
    </section>
  `

  return `
    <section class="panel hero ${variant === "drawer" ? "hero-compact" : ""}">
      <div class="hero-top">
        <div>
          <div class="eyebrow">SignalShift</div>
          <h1>反馈回路纠偏器</h1>
          <p>${heroCopy}</p>
        </div>
        <div class="orb"></div>
      </div>
      <div class="hint">主题：${themeNames || "未设置"}</div>
      <div class="hint">当前步骤：${currentStep}/${totalActions} ${model.session.currentActionLabel ?? ""}</div>
      ${model.session.lastError ? `<div class="hint error-text">失败定位：${model.session.lastError}</div>` : ""}
      <div class="stats">
        <div class="stat">
          <span>状态</span>
          <strong>${model.session.status}</strong>
        </div>
        <div class="stat">
          <span>今日会话</span>
          <strong>${todayMetric?.sessionsStarted ?? 0}</strong>
        </div>
        <div class="stat">
          <span>成功/失败</span>
          <strong>${model.stats.sessionsSucceeded}/${model.stats.sessionsFailed}</strong>
        </div>
        <div class="stat">
          <span>曝光率</span>
          <strong>${(model.stats.targetThemeExposureRate * 100).toFixed(0)}%</strong>
        </div>
        <div class="stat">
          <span>多样性</span>
          <strong>${model.stats.authorDiversityScore.toFixed(2)}</strong>
        </div>
      </div>
      <div class="step-chip">当前动作：${model.session.currentActionLabel ?? "-"}</div>
    </section>

    ${trendMarkup}

    <section class="panel">
      <div class="section-head">
        <div>
          <div class="eyebrow">Trace</div>
          <h2>执行日志</h2>
        </div>
        <p>${variant === "drawer" ? "最近 8 条动作事件" : "最近 50 条动作事件"}</p>
      </div>
      <div class="log-list">
        ${logRows || '<div class="hint">还没有日志</div>'}
      </div>
    </section>
  `
}

export function renderTrendRow(metric: DailyMetric): string {
  return `<div class="hint">${metric.day} | ${metric.sessionsStarted} | ${metric.sessionsSucceeded}/${metric.sessionsFailed} | ${metric.actionsCompleted} | ${(metric.targetThemeExposureRate * 100).toFixed(0)}% | ${metric.authorDiversityScore.toFixed(2)}</div>`
}

export function renderLogRow(entry: ExecutionLogEntry): string {
  const time = new Date(entry.time).toLocaleTimeString("zh-CN", { hour12: false })
  const tone = entry.level === "error" ? "#fda4af" : entry.level === "success" ? "#86efac" : "#93c5fd"

  return `<div class="hint log-row" style="color:${tone}">${time} | #${entry.actionIndex + 1} | ${entry.actionType} | ${entry.message}${
    entry.durationMs ? ` | ${entry.durationMs}ms` : ""
  }${entry.pageBefore || entry.pageAfter ? ` | ${entry.pageBefore ?? "-"} -> ${entry.pageAfter ?? "-"}` : ""}</div>`
}

export const panelBaseStyles = `
  :root {
    color-scheme: dark;
    --bg: #07111b;
    --panel: rgba(14, 23, 36, 0.92);
    --panel-2: rgba(9, 16, 28, 0.82);
    --line: rgba(96, 165, 250, 0.22);
    --text: #f8fafc;
    --muted: #94a3b8;
    --accent: #22d3ee;
    --accent-2: #0ea5e9;
    --accent-3: #1d4ed8;
  }
  * { box-sizing: border-box; }
  h1, h2, p { margin: 0; }
  h1 { font-size: 20px; line-height: 1.1; }
  h2 { font-size: 16px; line-height: 1.15; }
  p { color: var(--muted); font-size: 12px; }
  .eyebrow {
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #67e8f9;
    margin-bottom: 6px;
  }
  .panel {
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 14px;
    background:
      radial-gradient(circle at top right, rgba(34, 211, 238, 0.12), transparent 34%),
      linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)),
      var(--panel);
    box-shadow: 0 20px 40px rgba(2, 8, 23, 0.35);
    display: grid;
    gap: 12px;
    backdrop-filter: blur(16px);
  }
  .hero-compact {
    gap: 10px;
  }
  .hero-top {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }
  .orb {
    width: 42px;
    height: 42px;
    border-radius: 999px;
    background: radial-gradient(circle at 35% 35%, #67e8f9, #0284c7 62%, #082f49);
    box-shadow: 0 0 0 8px rgba(34, 211, 238, 0.08);
    flex: 0 0 auto;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .stat {
    border-radius: 16px;
    border: 1px solid rgba(96, 165, 250, 0.18);
    background: var(--panel-2);
    padding: 12px;
  }
  .stat span {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .stat strong {
    display: block;
    font-size: 15px;
    color: var(--text);
  }
  .step-chip {
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(8, 145, 178, 0.26), rgba(29, 78, 216, 0.16));
    border: 1px solid rgba(34, 211, 238, 0.18);
    color: #dbeafe;
    padding: 10px 12px;
    font-size: 12px;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: end;
  }
  .hint, .trend-head, .log-row {
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }
  .trend-head { color: #cbd5e1; }
  .error-text { color: #fda4af; }
  .log-list {
    display: grid;
    gap: 7px;
    max-height: 280px;
    overflow: auto;
    padding-right: 2px;
  }
`
