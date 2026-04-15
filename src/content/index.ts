import { collectFeedSnapshot, detectPageKind } from "./page-adapters"
import { executeInPlaceAction, prepareAction, waitForPageReady } from "./actions"
import type { RuntimeEnvelope } from "@shared/messages"
import { DEFAULT_THEMES } from "@shared/constants"
import { buildCustomThemePlan, buildThemePlan } from "@strategy/theme-expander"
import { defaultSessionState, defaultSettings, defaultStats, getSessionState, getSettings, getStats } from "@shared/storage"
import type {
  ActionPlan,
  FeedSnapshot,
  LanguagePreference,
  PageContext,
  RiskLevel,
  SessionState,
  StatsSnapshot,
  ThemePlan,
  UserSettings
} from "@shared/types"

interface ControlPanelState {
  settings: UserSettings
  session: SessionState
  stats: StatsSnapshot
}

let panelInjected = false
let panelOpen = false
let lastKnownUrl = window.location.href
let notifyingReady = false

async function readPanelState(): Promise<ControlPanelState> {
  const [settings, session, stats] = await Promise.all([
    getSettings().catch(() => defaultSettings),
    getSessionState().catch(() => defaultSessionState),
    getStats().catch(() => defaultStats)
  ])

  return { settings, session, stats }
}

function formatStatus(status: SessionState["status"]): string {
  if (status === "running") return "Running"
  if (status === "error") return "Needs attention"
  if (status === "paused") return "Paused"
  return "Idle"
}

function renderLogRows(logs: StatsSnapshot["recentLogs"]): string {
  return logs
    .slice()
    .reverse()
    .slice(0, 5)
    .map((entry) => {
      const time = new Date(entry.time).toLocaleTimeString("zh-CN", { hour12: false })
      return `
        <div class="trace-row trace-${entry.level}">
          <div class="trace-meta">${time} · ${entry.actionType}</div>
          <div class="trace-message">${entry.message}</div>
          ${
            entry.pageBefore || entry.pageAfter
              ? `<div class="trace-path">${entry.pageBefore ?? "-"} -> ${entry.pageAfter ?? "-"}</div>`
              : ""
          }
        </div>
      `
    })
    .join("")
}

function renderDrawer(state: ControlPanelState): string {
  const totalSteps = state.session.currentPlan?.actions.length ?? 0
  const currentStep = totalSteps === 0 ? 0 : Math.min(state.session.currentActionIndex + 1, totalSteps)
  const themeNames = state.settings.themes.map((theme) => theme.name).join(", ")
  const todayMetric = state.stats.dailyMetrics[state.stats.dailyMetrics.length - 1]

  return `
    <section class="shell">
      <header class="topbar">
        <div>
          <div class="brand">SignalShift</div>
          <div class="subbrand">Feedback Rebalancer</div>
        </div>
        <button class="icon-btn" id="close-drawer" aria-label="Close panel">×</button>
      </header>

      <section class="section control">
        <div class="section-headline">
          <div>
            <div class="status-line">
              <span class="status-dot ${state.session.status}"></span>
              <strong>${formatStatus(state.session.status)}</strong>
            </div>
            <div class="support-line">Theme · ${themeNames || "Not configured"}</div>
          </div>
          <div class="step-pill">Step ${currentStep}/${totalSteps || 0}</div>
        </div>
        <div class="task-line">${state.session.currentActionLabel ? `Now running: ${state.session.currentActionLabel}` : "Ready to start a new session"}</div>
        <div class="button-row">
          <button class="primary-btn" id="drawer-start">${state.session.status === "running" ? "Resume" : "Start session"}</button>
          <button class="secondary-btn" id="drawer-stop">Stop</button>
        </div>
      </section>

      <section class="section runtime">
        <div class="metric-grid">
          <div class="metric-card">
            <span>Today</span>
            <strong>${todayMetric?.sessionsStarted ?? 0}</strong>
          </div>
          <div class="metric-card">
            <span>Success / Fail</span>
            <strong>${state.stats.sessionsSucceeded}/${state.stats.sessionsFailed}</strong>
          </div>
        </div>
        <div class="task-line subtle">Page · ${state.session.lastKnownPageKind}</div>
        ${
          state.session.lastError
            ? `<div class="error-banner"><span>Error</span><strong>${state.session.lastError}</strong></div>`
            : ""
        }
      </section>

      <details class="section settings-block">
        <summary>
          <div>
            <div class="section-title">Session Settings</div>
            <div class="support-line">Themes, language, intensity, duration</div>
          </div>
          <span class="summary-action">Edit</span>
        </summary>
        <div class="settings-form">
          <label class="field">
            <span>Theme Pack</span>
            <select id="drawer-themes" multiple>
              ${DEFAULT_THEMES.map(
                (theme) =>
                  `<option value="${theme}" ${state.settings.themes.some((item) => item.name === theme) ? "selected" : ""}>${theme}</option>`
              ).join("")}
            </select>
          </label>
          <label class="field">
            <span>Custom Keywords</span>
            <textarea id="drawer-customKeywords" placeholder="macro economy, climate science, energy policy">${state.settings.customKeywords.join(", ")}</textarea>
          </label>
          <div class="field-grid">
            <label class="field">
              <span>Language</span>
              <select id="drawer-languagePreference">
                ${(["zh", "en", "bilingual"] as LanguagePreference[])
                  .map(
                    (mode) =>
                      `<option value="${mode}" ${state.settings.languagePreference === mode ? "selected" : ""}>${mode}</option>`
                  )
                  .join("")}
              </select>
            </label>
            <label class="field">
              <span>Risk</span>
              <select id="drawer-riskLevel">
                ${(["conservative", "standard", "aggressive"] as RiskLevel[])
                  .map(
                    (mode) => `<option value="${mode}" ${state.settings.riskLevel === mode ? "selected" : ""}>${mode}</option>`
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>Sessions / day</span>
              <input id="drawer-sessionCount" type="number" min="1" max="12" value="${state.settings.dailySessionCount}" />
            </label>
            <label class="field">
              <span>Min sec</span>
              <input id="drawer-sessionMin" type="number" min="60" max="3600" value="${state.settings.sessionDurationMinSec}" />
            </label>
            <label class="field">
              <span>Max sec</span>
              <input id="drawer-sessionMax" type="number" min="60" max="5400" value="${state.settings.sessionDurationMaxSec}" />
            </label>
          </div>
          <button class="secondary-btn" id="drawer-save">Save settings</button>
        </div>
      </details>

      <section class="section trace">
        <div class="section-headline">
          <div>
            <div class="section-title">Trace</div>
            <div class="support-line">Latest 5 events</div>
          </div>
          <span class="summary-action">${state.stats.recentLogs.length} entries</span>
        </div>
        <div class="trace-list">
          ${renderLogRows(state.stats.recentLogs) || '<div class="empty-copy">No recent logs yet.</div>'}
        </div>
      </section>
    </section>
  `
}

function collectDrawerSettings(current: UserSettings, root: ParentNode): UserSettings {
  const selectedThemes = Array.from(root.querySelectorAll<HTMLOptionElement>("#drawer-themes option:checked")).map(
    (option) => option.value
  )
  const customKeywords = (root.querySelector<HTMLTextAreaElement>("#drawer-customKeywords")?.value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  const languagePreference =
    (root.querySelector<HTMLSelectElement>("#drawer-languagePreference")?.value as LanguagePreference) ?? "bilingual"
  const riskLevel = (root.querySelector<HTMLSelectElement>("#drawer-riskLevel")?.value as RiskLevel) ?? "conservative"
  const dailySessionCount = Number(root.querySelector<HTMLInputElement>("#drawer-sessionCount")?.value ?? current.dailySessionCount)
  const sessionDurationMinSec = Number(root.querySelector<HTMLInputElement>("#drawer-sessionMin")?.value ?? current.sessionDurationMinSec)
  const sessionDurationMaxSec = Number(root.querySelector<HTMLInputElement>("#drawer-sessionMax")?.value ?? current.sessionDurationMaxSec)
  const selectedThemePlans = (selectedThemes.length ? selectedThemes : DEFAULT_THEMES.slice(0, 1)).map((theme) =>
    buildThemePlan(theme, 1, languagePreference)
  )
  const customTheme = buildCustomThemePlan(customKeywords, languagePreference)
  const themes = customTheme ? [...selectedThemePlans, customTheme] : selectedThemePlans

  return {
    ...current,
    customKeywords,
    riskLevel,
    languagePreference,
    dailySessionCount,
    sessionDurationMinSec: Math.min(sessionDurationMinSec, sessionDurationMaxSec),
    sessionDurationMaxSec: Math.max(sessionDurationMinSec, sessionDurationMaxSec),
    themes
  }
}

async function persistDrawerSettings(root: ParentNode, current: UserSettings): Promise<void> {
  const next = collectDrawerSettings(current, root)
  await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    payload: next
  } satisfies RuntimeEnvelope<"SAVE_SETTINGS">)
}

function bindDrawerEvents(shadow: ShadowRoot, state: ControlPanelState): void {
  shadow.getElementById("close-drawer")?.addEventListener("click", () => {
    panelOpen = false
    shadow.getElementById("drawer")?.classList.remove("open")
  })

  shadow.getElementById("drawer-start")?.addEventListener("click", async () => {
    await persistDrawerSettings(shadow, state.settings)
    await chrome.runtime.sendMessage({ type: "START_AUTOMATION", payload: undefined } satisfies RuntimeEnvelope<"START_AUTOMATION">)
  })

  shadow.getElementById("drawer-stop")?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "STOP_AUTOMATION", payload: undefined } satisfies RuntimeEnvelope<"STOP_AUTOMATION">)
  })

  shadow.getElementById("drawer-save")?.addEventListener("click", async () => {
    await persistDrawerSettings(shadow, state.settings)
  })
}

function ensureControlPanel(): ShadowRoot | null {
  if (panelInjected) {
    return document.querySelector("#x-signal-shift-root")?.shadowRoot ?? null
  }

  const host = document.createElement("div")
  host.id = "x-signal-shift-root"
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .wrap {
      position: fixed;
      right: 20px;
      bottom: 96px;
      z-index: 2147483646;
      font-family: "SF Pro Display", "Segoe UI", ui-sans-serif, sans-serif;
      color: #f8fafc;
    }
    .trigger {
      width: 52px;
      height: 52px;
      border-radius: 999px;
      border: 1px solid rgba(71, 85, 105, 0.55);
      background: radial-gradient(circle at 30% 30%, #0f172a, #020617);
      box-shadow: 0 18px 30px rgba(2, 8, 23, 0.34);
      color: #e2e8f0;
      display: grid;
      place-items: center;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }
    .trigger::after {
      content: "";
      position: absolute;
      inset: 4px;
      border-radius: inherit;
      border: 1px solid rgba(148, 163, 184, 0.12);
    }
    .trigger-mark {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: linear-gradient(135deg, #f8fafc, #94a3b8);
      mask: radial-gradient(circle at center, black 60%, transparent 62%);
      -webkit-mask: radial-gradient(circle at center, black 60%, transparent 62%);
    }
    .trigger-state {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #64748b;
    }
    .trigger-state.running { background: #22d3ee; box-shadow: 0 0 0 6px rgba(34, 211, 238, 0.12); }
    .trigger-state.error { background: #fb7185; }
    .trigger-state.paused { background: #fbbf24; }
    .drawer {
      position: absolute;
      right: 0;
      bottom: 68px;
      width: 368px;
      max-height: calc(100vh - 32px);
      opacity: 0;
      pointer-events: none;
      transform: translateX(12px);
      transition: opacity 160ms ease, transform 180ms ease;
    }
    .drawer.open {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }
    .shell {
      border-radius: 24px;
      border: 1px solid rgba(71, 85, 105, 0.4);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.985), rgba(2, 6, 23, 0.985));
      box-shadow: 0 26px 56px rgba(2, 8, 23, 0.42);
      display: grid;
      gap: 12px;
      padding: 14px;
      max-height: calc(100vh - 40px);
      overflow: auto;
    }
    .topbar, .section-headline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .subbrand, .support-line, .trace-meta, .trace-path, .summary-action {
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.4;
    }
    .icon-btn {
      width: 34px;
      height: 34px;
      border-radius: 999px;
      border: 1px solid rgba(71, 85, 105, 0.46);
      background: rgba(15, 23, 42, 0.92);
      color: #e2e8f0;
      cursor: pointer;
    }
    .section {
      border-radius: 18px;
      border: 1px solid rgba(71, 85, 105, 0.28);
      background: rgba(15, 23, 42, 0.88);
      padding: 14px;
      display: grid;
      gap: 12px;
    }
    .status-line {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #64748b;
    }
    .status-dot.running { background: #22d3ee; }
    .status-dot.error { background: #fb7185; }
    .status-dot.paused { background: #fbbf24; }
    .step-pill {
      border-radius: 999px;
      padding: 6px 10px;
      background: rgba(30, 41, 59, 0.96);
      color: #cbd5e1;
      font-size: 12px;
      border: 1px solid rgba(71, 85, 105, 0.32);
    }
    .task-line {
      font-size: 14px;
      line-height: 1.45;
      color: #f8fafc;
    }
    .task-line.subtle { color: #cbd5e1; font-size: 13px; }
    .button-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .primary-btn, .secondary-btn, .field input, .field select, .field textarea {
      width: 100%;
      border-radius: 14px;
      padding: 10px 12px;
      font: inherit;
    }
    .primary-btn, .secondary-btn {
      border: 0;
      cursor: pointer;
      font-weight: 700;
    }
    .primary-btn {
      background: linear-gradient(135deg, #0891b2, #22d3ee);
      color: white;
    }
    .secondary-btn {
      background: rgba(30, 41, 59, 0.96);
      color: #e2e8f0;
      border: 1px solid rgba(71, 85, 105, 0.36);
    }
    .metric-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .metric-card {
      border-radius: 16px;
      border: 1px solid rgba(71, 85, 105, 0.24);
      background: rgba(2, 6, 23, 0.56);
      padding: 12px;
      display: grid;
      gap: 4px;
    }
    .metric-card span {
      color: #94a3b8;
      font-size: 12px;
    }
    .metric-card strong {
      font-size: 16px;
      color: #f8fafc;
    }
    .error-banner {
      border-radius: 14px;
      padding: 12px;
      border: 1px solid rgba(251, 113, 133, 0.24);
      background: rgba(76, 5, 25, 0.28);
      display: grid;
      gap: 4px;
    }
    .error-banner span {
      color: #fda4af;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .error-banner strong {
      color: #ffe4e6;
      font-size: 13px;
      line-height: 1.45;
    }
    details summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    details summary::-webkit-details-marker { display: none; }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #f8fafc;
    }
    .settings-form {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .field, .field-grid {
      display: grid;
      gap: 8px;
    }
    .field span {
      color: #94a3b8;
      font-size: 12px;
    }
    .field-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .field select, .field input, .field textarea {
      border: 1px solid rgba(71, 85, 105, 0.38);
      background: rgba(2, 6, 23, 0.62);
      color: #f8fafc;
    }
    .field textarea {
      min-height: 70px;
      resize: vertical;
    }
    .trace-list {
      display: grid;
      gap: 8px;
    }
    .trace-row {
      border-radius: 14px;
      border: 1px solid rgba(71, 85, 105, 0.18);
      background: rgba(2, 6, 23, 0.48);
      padding: 10px 12px;
      display: grid;
      gap: 4px;
    }
    .trace-message {
      font-size: 13px;
      line-height: 1.45;
      color: #e2e8f0;
    }
    .trace-error .trace-message { color: #fecdd3; }
    .trace-success .trace-message { color: #dcfce7; }
    .empty-copy {
      color: #94a3b8;
      font-size: 12px;
      line-height: 1.5;
    }
  `

  const container = document.createElement("div")
  container.className = "wrap"
  container.innerHTML = `
    <button class="trigger" id="trigger" title="SignalShift control center">
      <span class="trigger-mark"></span>
      <span class="trigger-state" id="trigger-state"></span>
    </button>
    <section class="drawer" id="drawer"></section>
  `

  shadow.append(style, container)
  shadow.getElementById("trigger")?.addEventListener("click", () => {
    panelOpen = !panelOpen
    shadow.getElementById("drawer")?.classList.toggle("open", panelOpen)
    void renderControlPanel(shadow)
  })

  panelInjected = true
  return shadow
}

async function renderControlPanel(shadowRoot = document.querySelector("#x-signal-shift-root")?.shadowRoot ?? null): Promise<void> {
  if (!shadowRoot) return

  const state = await readPanelState().catch(() => null)
  if (!state) return

  const drawer = shadowRoot.getElementById("drawer")
  const triggerState = shadowRoot.getElementById("trigger-state")
  if (drawer) {
    drawer.innerHTML = renderDrawer(state)
  }
  if (triggerState) {
    triggerState.className = `trigger-state ${state.session.status}`
  }

  bindDrawerEvents(shadowRoot, state)
  shadowRoot.getElementById("drawer")?.classList.toggle("open", panelOpen)
}

async function notifyContentReady(force = false): Promise<void> {
  if (notifyingReady) return
  if (!force && window.location.href === lastKnownUrl) return

  notifyingReady = true
  try {
    await waitForPageReady().catch(() => undefined)
    const payload: PageContext = {
      pageKind: detectPageKind(),
      url: window.location.href
    }
    lastKnownUrl = payload.url
    await chrome.runtime.sendMessage({
      type: "CONTENT_READY",
      payload
    } satisfies RuntimeEnvelope<"CONTENT_READY">)
  } catch {
    // Ignore transient ready errors during route churn.
  } finally {
    notifyingReady = false
  }
}

function startRouteMonitor(): void {
  window.setInterval(() => {
    if (window.location.href !== lastKnownUrl) {
      void notifyContentReady(true)
    }
  }, 700)
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return
  if (!("session" in changes || "stats" in changes || "settings" in changes)) return
  void renderControlPanel()
})

chrome.runtime.onMessage.addListener((message: RuntimeEnvelope, _sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case "OPEN_DRAWER":
        panelOpen = true
        await renderControlPanel()
        sendResponse({ ok: true })
        return
      case "PREPARE_ACTION": {
        const { action, themes } = message.payload as { action: ActionPlan; actionIndex: number; themes: ThemePlan[] }
        const result = await prepareAction(action, themes)
        sendResponse(result)
        return
      }
      case "EXECUTE_IN_PLACE": {
        const { action, themes } = message.payload as { action: ActionPlan; actionIndex: number; themes: ThemePlan[] }
        let result
        try {
          result = await executeInPlaceAction(action, themes)
        } catch (error) {
          result = {
            status: "failed" as const,
            message: error instanceof Error ? error.message : `Unknown failure in ${action.type}`,
            durationMs: 0,
            pageBefore: detectPageKind(),
            pageAfter: detectPageKind()
          }
        }
        sendResponse(result)
        return
      }
      case "GET_PAGE_CONTEXT":
        await waitForPageReady().catch(() => undefined)
        sendResponse({
          pageKind: detectPageKind(),
          url: window.location.href
        } satisfies PageContext)
        return
      case "COLLECT_FEED_SNAPSHOT": {
        const { themes } = message.payload as { themes: ThemePlan[] }
        sendResponse(collectFeedSnapshot(themes) satisfies FeedSnapshot)
        return
      }
      default:
        break
    }
  })()

  return true
})

void (async () => {
  const shadow = ensureControlPanel()
  if (shadow) await renderControlPanel(shadow)
  await notifyContentReady(true)
  startRouteMonitor()
})()
