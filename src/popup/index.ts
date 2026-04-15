import { sendRuntimeMessage } from "@shared/messages"
import { defaultSettings } from "@shared/storage"
import type { SessionState, StatsSnapshot, UserSettings } from "@shared/types"

interface PopupState {
  settings: UserSettings
  session: SessionState
  stats: StatsSnapshot
}

function render(state: PopupState): string {
  return `
    <section class="launcher">
      <div class="eyebrow">SignalShift</div>
      <h1>Open the control center inside X.</h1>
      <p class="lead">Popup is now just a launcher. Configuration, status, and logs all live in the page drawer.</p>

      <div class="status-row">
        <span class="status-dot ${state.session.status}"></span>
        <strong>${state.session.status}</strong>
        <span class="muted">Current action: ${state.session.currentActionLabel ?? "none"}</span>
      </div>

      <div class="button-stack">
        <button id="openControl">Open Control Center</button>
        <button id="toggleRun" class="secondary">${state.session.status === "running" ? "Stop Session" : "Start Session"}</button>
      </div>

      ${
        state.session.lastError
          ? `<div class="error-box"><span>Last error</span><strong>${state.session.lastError}</strong></div>`
          : `<div class="hint-box">Open X, then launch the page drawer to adjust themes, duration, and session behavior.</div>`
      }
    </section>
  `
}

async function loadState(): Promise<PopupState> {
  return (await sendRuntimeMessage("GET_STATE", undefined)) as PopupState
}

async function mount(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")
  if (!app) return

  const fallback: PopupState = {
    settings: defaultSettings,
    session: {
      status: "idle",
      currentPlan: null,
      currentActionIndex: 0,
      currentActionLabel: null,
      activeTabId: null,
      pendingNavigation: false,
      lastKnownPageKind: "unknown",
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

  let state = await loadState().catch(() => fallback)

  const rerender = () => {
    app.innerHTML = render(state)

    document.querySelector<HTMLButtonElement>("#openControl")?.addEventListener("click", async () => {
      await sendRuntimeMessage("OPEN_CONTROL_CENTER", undefined)
      window.close()
    })

    document.querySelector<HTMLButtonElement>("#toggleRun")?.addEventListener("click", async () => {
      if (state.session.status === "running") {
        await sendRuntimeMessage("STOP_AUTOMATION", undefined)
      } else {
        await sendRuntimeMessage("OPEN_CONTROL_CENTER", undefined)
        await sendRuntimeMessage("START_AUTOMATION", undefined)
      }
      state = await loadState().catch(() => state)
      rerender()
    })
  }

  rerender()

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return
    if (!("session" in changes || "stats" in changes || "settings" in changes)) return
    void (async () => {
      state = await loadState().catch(() => state)
      rerender()
    })()
  })
}

void mount()
