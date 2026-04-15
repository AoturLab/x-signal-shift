import { DEFAULT_THEMES } from "@shared/constants"
import { sendRuntimeMessage } from "@shared/messages"
import { buildPanelMarkup, panelBaseStyles } from "@shared/panel-view"
import { buildCustomThemePlan, buildThemePlan } from "@strategy/theme-expander"
import { defaultSettings } from "@shared/storage"
import type { LanguagePreference, RiskLevel, SessionState, StatsSnapshot, UserSettings } from "@shared/types"

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
  return `
    ${buildPanelMarkup(state)}

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
      <div class="row">
        <label for="sessionMin">单次最短时长（秒）</label>
        <input id="sessionMin" type="number" min="60" max="3600" value="${state.settings.sessionDurationMinSec}" />
      </div>
      <div class="row">
        <label for="sessionMax">单次最长时长（秒）</label>
        <input id="sessionMax" type="number" min="60" max="5400" value="${state.settings.sessionDurationMaxSec}" />
      </div>
      <button id="saveBtn">保存配置</button>
      <button id="startBtn">${state.settings.enabled ? "启动自动训练" : "启用并启动"}</button>
      <button id="stopBtn" class="secondary">停止</button>
    </section>
  `
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
  const sessionDurationMinSec = Number(
    document.querySelector<HTMLInputElement>("#sessionMin")?.value ?? current.sessionDurationMinSec
  )
  const sessionDurationMaxSec = Number(
    document.querySelector<HTMLInputElement>("#sessionMax")?.value ?? current.sessionDurationMaxSec
  )
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
    sessionDurationMinSec: Math.min(sessionDurationMinSec, sessionDurationMaxSec),
    sessionDurationMaxSec: Math.max(sessionDurationMinSec, sessionDurationMaxSec),
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
