import { collectFeedSnapshot, detectPageKind } from "./page-adapters"
import { executeAction, waitForPageReady } from "./actions"
import type { RuntimeEnvelope } from "@shared/messages"
import { buildPanelMarkup, panelBaseStyles } from "@shared/panel-view"
import { defaultSessionState, defaultSettings, defaultStats, getSessionState, getSettings, getStats } from "@shared/storage"
import type { ActionPlan, FeedSnapshot, PageContext, SessionState, StatsSnapshot, ThemePlan, UserSettings } from "@shared/types"

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
    ${panelBaseStyles}
    .wrap {
      position: fixed;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 2147483646;
      font-family: "SF Pro Display", "Segoe UI", ui-sans-serif, sans-serif;
      color: #f8fafc;
    }
    .fab {
      width: 48px;
      height: 48px;
      border-radius: 999px;
      border: 1px solid rgba(186, 230, 253, 0.24);
      background:
        radial-gradient(circle at 30% 30%, rgba(103, 232, 249, 0.95), rgba(14, 165, 233, 0.92) 42%, rgba(8, 47, 73, 0.98));
      box-shadow: 0 14px 30px rgba(2, 8, 23, 0.34);
      cursor: pointer;
      display: grid;
      place-items: center;
      font-size: 14px;
      font-weight: 800;
      color: white;
      letter-spacing: 0.06em;
    }
    .fab[data-state="running"] { box-shadow: 0 0 0 8px rgba(34, 211, 238, 0.14), 0 14px 30px rgba(2, 8, 23, 0.34); }
    .fab[data-state="error"] { background: radial-gradient(circle at 30% 30%, rgba(253, 164, 175, 0.95), rgba(225, 29, 72, 0.9) 42%, rgba(76, 5, 25, 0.98)); }
    .drawer {
      position: absolute;
      right: 64px;
      top: 50%;
      transform: translateY(-50%) translateX(12px);
      width: 372px;
      max-height: 76vh;
      overflow: auto;
      opacity: 0;
      pointer-events: none;
      transition: opacity 160ms ease, transform 180ms ease;
      display: grid;
      gap: 10px;
    }
    .drawer .panel,
    .drawer .panel-content > .panel {
      background:
        radial-gradient(circle at top right, rgba(34, 211, 238, 0.09), transparent 30%),
        linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(7, 13, 24, 0.98));
      border-color: rgba(71, 85, 105, 0.38);
      box-shadow: 0 20px 48px rgba(2, 8, 23, 0.42);
      backdrop-filter: none;
    }
    .drawer .hint,
    .drawer .trend-head,
    .drawer .log-row,
    .drawer p {
      color: #cbd5e1;
    }
    .drawer .stat {
      background: rgba(15, 23, 42, 0.94);
      border-color: rgba(71, 85, 105, 0.34);
    }
    .drawer .stat span {
      color: #94a3b8;
    }
    .drawer .step-chip {
      background: linear-gradient(135deg, rgba(8, 145, 178, 0.34), rgba(29, 78, 216, 0.26));
      color: #eff6ff;
    }
    .drawer.open {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(-50%) translateX(0);
    }
    .panel-content {
      display: grid;
      gap: 10px;
    }
    .controls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .btn {
      border-radius: 14px;
      border: 0;
      padding: 10px 12px;
      cursor: pointer;
      color: white;
      font-weight: 700;
    }
    .btn.start { background: linear-gradient(135deg, var(--accent-2), var(--accent)); }
    .btn.stop { background: linear-gradient(135deg, rgba(29,78,216,0.65), rgba(30,58,95,0.95)); }
    .btn.hollow {
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.18);
    }
  `

  const container = document.createElement("div")
  container.className = "wrap"
  container.innerHTML = `
    <button class="fab" id="fab" title="SignalShift">SS</button>
    <section class="drawer" id="drawer">
      <div class="panel-content" id="panel-content"></div>
      <section class="panel">
        <div class="section-head">
          <div>
            <div class="eyebrow">Control</div>
            <h2>运行控制台</h2>
          </div>
          <p>配置仍然放在扩展 popup</p>
        </div>
        <div class="controls">
          <button class="btn start" id="start">启动</button>
          <button class="btn stop" id="stop">停止</button>
        </div>
        <button class="btn hollow" id="refresh">刷新状态</button>
      </section>
    </section>
  `

  shadow.append(style, container)

  shadow.getElementById("fab")?.addEventListener("click", () => {
    panelOpen = !panelOpen
    shadow.getElementById("drawer")?.classList.toggle("open", panelOpen)
    if (panelOpen) {
      void renderControlPanel(shadow)
    }
  })

  shadow.getElementById("start")?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "START_AUTOMATION", payload: undefined } satisfies RuntimeEnvelope<"START_AUTOMATION">)
    await renderControlPanel(shadow)
  })

  shadow.getElementById("stop")?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "STOP_AUTOMATION", payload: undefined } satisfies RuntimeEnvelope<"STOP_AUTOMATION">)
    await renderControlPanel(shadow)
  })

  shadow.getElementById("refresh")?.addEventListener("click", async () => {
    await renderControlPanel(shadow)
  })

  panelInjected = true
  return shadow
}

async function renderControlPanel(shadowRoot = document.querySelector("#x-signal-shift-root")?.shadowRoot ?? null): Promise<void> {
  if (!shadowRoot) return

  const state = await readPanelState().catch(() => null)
  if (!state) return

  const content = shadowRoot.getElementById("panel-content")
  const fab = shadowRoot.getElementById("fab")
  if (content) {
    content.innerHTML = buildPanelMarkup(state, { variant: "drawer" })
  }
  if (fab instanceof HTMLButtonElement) {
    fab.dataset.state = state.session.status
  }
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
      case "EXECUTE_ACTION": {
        const { action, themes } = message.payload as { action: ActionPlan; actionIndex: number; themes: ThemePlan[] }
        let result
        try {
          result = await executeAction(action, themes)
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
      case "GET_PAGE_CONTEXT": {
        await waitForPageReady().catch(() => undefined)
        sendResponse({
          pageKind: detectPageKind(),
          url: window.location.href
        } satisfies PageContext)
        return
      }
      case "COLLECT_FEED_SNAPSHOT": {
        const { themes } = message.payload as { themes: ThemePlan[] }
        const summary = collectFeedSnapshot(themes)
        sendResponse(summary satisfies FeedSnapshot)
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
  if (shadow) {
    await renderControlPanel(shadow)
  }
  await notifyContentReady(true)
  startRouteMonitor()
})()
