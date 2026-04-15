import { DEFAULT_THEMES } from "@shared/constants"
import { sendRuntimeMessage } from "@shared/messages"
import { buildCustomThemePlan, buildThemePlan } from "@strategy/theme-expander"
import { defaultSettings } from "@shared/storage"
import type {
  DailyMetric,
  ExecutionLogEntry,
  LanguagePreference,
  RiskLevel,
  SessionState,
  StatsSnapshot,
  UserSettings
} from "@shared/types"

interface PopupState {
  settings: UserSettings
  session: SessionState
  stats: StatsSnapshot
}

interface StartResponse {
  ok?: boolean
  reason?: string
}

function render(state: PopupState): string {
  const themeNames = state.settings.themes.map((theme) => theme.name).join(", ")
  const statusClass = state.session.status === "running" ? "status-live" : "status-idle"
  const todayMetric = state.stats.dailyMetrics[state.stats.dailyMetrics.length - 1]
  const trendRows = state.stats.dailyMetrics
    .slice()
    .reverse()
    .map((metric) => renderTrendRow(metric))
    .join("")
  const logRows = state.stats.recentLogs
    .slice()
    .reverse()
    .map((entry) => renderLogRow(entry))
    .join("")
  const totalActions = state.session.currentPlan?.actions.length ?? 0
  const currentStep = totalActions === 0 ? 0 : Math.min(state.session.currentActionIndex + 1, totalActions)

  return `
    <section class="panel">
      <div>
        <h1>反馈回路纠偏器</h1>
        <p>自动搜索、浏览、停留和低频互动，逐步重塑 X 对账号的兴趣画像。</p>
      </div>
      <div class="stats">
        <div class="stat">
          <span>状态</span>
          <strong class="${statusClass}">${state.session.status}</strong>
        </div>
        <div class="stat">
          <span>今日会话</span>
          <strong>${todayMetric?.sessionsStarted ?? 0}</strong>
        </div>
        <div class="stat">
          <span>成功/失败</span>
          <strong>${state.stats.sessionsSucceeded}/${state.stats.sessionsFailed}</strong>
        </div>
        <div class="stat">
          <span>目标曝光率</span>
          <strong>${(state.stats.targetThemeExposureRate * 100).toFixed(0)}%</strong>
        </div>
        <div class="stat">
          <span>作者多样性</span>
          <strong>${state.stats.authorDiversityScore.toFixed(2)}</strong>
        </div>
      </div>
      <div class="hint">当前主题：${themeNames || "未设置"}</div>
      <div class="hint">当前步骤：${currentStep}/${totalActions} ${state.session.currentActionLabel ?? ""}</div>
      ${state.session.lastError ? `<div class="hint">最近错误：${state.session.lastError}</div>` : ""}
    </section>

    <section class="panel">
      <div class="row">
        <label for="themes">主题</label>
        <select id="themes" multiple>
          ${DEFAULT_THEMES.map(
            (theme) =>
              `<option value="${theme}" ${state.settings.themes.some((item) => item.name === theme) ? "selected" : ""}>${theme}</option>`
          ).join("")}
        </select>
      </div>
      <div class="row">
        <label for="customKeywords">自定义关键词（逗号分隔）</label>
        <textarea id="customKeywords" placeholder="biology, physics, 宏观经济">${state.settings.customKeywords.join(", ")}</textarea>
      </div>
      <div class="row">
        <label for="languagePreference">语言偏好</label>
        <select id="languagePreference">
          ${(["zh", "en", "bilingual"] as LanguagePreference[])
            .map(
              (mode) =>
                `<option value="${mode}" ${state.settings.languagePreference === mode ? "selected" : ""}>${mode}</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="row">
        <label for="riskLevel">风险级别</label>
        <select id="riskLevel">
          ${(["conservative", "standard", "aggressive"] as RiskLevel[])
            .map(
              (mode) =>
                `<option value="${mode}" ${state.settings.riskLevel === mode ? "selected" : ""}>${mode}</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="row">
        <label for="sessionCount">每日会话数</label>
        <input id="sessionCount" type="number" min="1" max="12" value="${state.settings.dailySessionCount}" />
      </div>
      <button id="saveBtn">保存配置</button>
      <button id="startBtn">${state.settings.enabled ? "启动自动训练" : "启用并启动"}</button>
      <button id="stopBtn" class="secondary">停止</button>
    </section>

    <section class="panel">
      <div>
        <h1>每日趋势</h1>
        <p>最近 7 天的训练结果。</p>
      </div>
      <div class="hint">日期 | 会话 | 成功/失败 | 动作 | 曝光率 | 多样性</div>
      ${trendRows || '<div class="hint">还没有趋势数据</div>'}
    </section>

    <section class="panel">
      <div>
        <h1>执行日志</h1>
        <p>最近 50 条动作事件。</p>
      </div>
      ${logRows || '<div class="hint">还没有日志</div>'}
    </section>
  `
}

function renderTrendRow(metric: DailyMetric): string {
  return `<div class="hint">${metric.day} | ${metric.sessionsStarted} | ${metric.sessionsSucceeded}/${metric.sessionsFailed} | ${metric.actionsCompleted} | ${(metric.targetThemeExposureRate * 100).toFixed(0)}% | ${metric.authorDiversityScore.toFixed(2)}</div>`
}

function renderLogRow(entry: ExecutionLogEntry): string {
  const time = new Date(entry.time).toLocaleTimeString("zh-CN", { hour12: false })
  const tone = entry.level === "error" ? "#fda4af" : entry.level === "success" ? "#86efac" : "#93c5fd"
  return `<div class="hint" style="color:${tone}">${time} | #${entry.actionIndex + 1} | ${entry.actionType} | ${entry.message}${
    entry.durationMs ? ` | ${entry.durationMs}ms` : ""
  }${entry.pageBefore || entry.pageAfter ? ` | ${entry.pageBefore ?? "-"} -> ${entry.pageAfter ?? "-"}` : ""}</div>`
}

async function loadState(): Promise<PopupState> {
  const response = (await sendRuntimeMessage("GET_STATE", undefined)) as PopupState
  return response
}

function collectSettings(current: UserSettings): UserSettings {
  const selectedThemes = Array.from(document.querySelectorAll<HTMLOptionElement>("#themes option:checked")).map(
    (option) => option.value
  )
  const customKeywords = (document.querySelector<HTMLTextAreaElement>("#customKeywords")?.value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  const languagePreference =
    (document.querySelector<HTMLSelectElement>("#languagePreference")?.value as LanguagePreference) ?? "bilingual"
  const riskLevel = (document.querySelector<HTMLSelectElement>("#riskLevel")?.value as RiskLevel) ?? "conservative"
  const dailySessionCount = Number(document.querySelector<HTMLInputElement>("#sessionCount")?.value ?? current.dailySessionCount)
  const selectedThemePlans = (selectedThemes.length ? selectedThemes : DEFAULT_THEMES.slice(0, 1)).map((theme) =>
    buildThemePlan(theme, 1, languagePreference)
  )
  const customTheme = buildCustomThemePlan(customKeywords, languagePreference)
  const themes = customTheme ? [...selectedThemePlans, customTheme] : selectedThemePlans

  return {
    ...current,
    enabled: true,
    customKeywords,
    riskLevel,
    languagePreference,
    dailySessionCount,
    themes
  }
}

async function mount(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")
  if (!app) return

  const fallbackState: PopupState = {
    settings: defaultSettings,
    session: {
      status: "idle",
      currentPlan: null,
      currentActionIndex: 0,
      currentActionLabel: null,
      startedAt: null,
      lastError: null,
      lastCompletedAt: null
    },
    stats: {
      sessionsStarted: 0,
      sessionsSucceeded: 0,
      sessionsFailed: 0,
      actionsCompleted: 0,
      targetThemeExposureRate: 0,
      authorDiversityScore: 0,
      lastRunAt: null,
      lastSuccessfulRunAt: null,
      dailyMetrics: [],
      recentLogs: []
    }
  }

  let state = await loadState().catch(() => ({
    ...fallbackState
  }))

  const rerender = () => {
    app.innerHTML = render(state)

    document.querySelector<HTMLButtonElement>("#saveBtn")?.addEventListener("click", async () => {
      const nextSettings = collectSettings(state.settings)
      await sendRuntimeMessage("SAVE_SETTINGS", nextSettings)
      state = { ...state, settings: nextSettings }
      rerender()
    })

    document.querySelector<HTMLButtonElement>("#startBtn")?.addEventListener("click", async () => {
      const nextSettings = collectSettings(state.settings)
      await sendRuntimeMessage("SAVE_SETTINGS", nextSettings)
      const response = (await sendRuntimeMessage("START_AUTOMATION", undefined)) as StartResponse
      state = await loadState()
      if (response?.ok === false && response.reason) {
        state = {
          ...state,
          session: {
            ...state.session,
            status: "error",
            lastError: response.reason
          }
        }
      }
      rerender()
    })

    document.querySelector<HTMLButtonElement>("#stopBtn")?.addEventListener("click", async () => {
      await sendRuntimeMessage("STOP_AUTOMATION", undefined)
      state = await loadState()
      rerender()
    })
  }

  rerender()
}

void mount()
