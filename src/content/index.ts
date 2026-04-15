import { collectFeedSnapshot, detectPageKind } from "./page-adapters"
import { executeAction, waitForPageReady } from "./actions"
import type { RuntimeEnvelope } from "@shared/messages"
import type { ActionPlan, ExecutionLogEntry, SessionPlan, SessionState, UserSettings } from "@shared/types"
import { defaultSessionState, defaultSettings, getSessionState, getSettings, setSessionState } from "@shared/storage"

let activePlanId: string | null = null
let aborted = false
let resuming = false
let panelInjected = false
let panelOpen = false
let statusPollTimer: number | null = null

function delayBetweenActions(): Promise<void> {
  const ms = Math.floor(Math.random() * 2200) + 900
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildLogEntry(
  actionIndex: number,
  actionType: ActionPlan["type"] | "system",
  message: string,
  level: ExecutionLogEntry["level"],
  details?: Partial<ExecutionLogEntry>
): ExecutionLogEntry {
  return {
    id: crypto.randomUUID(),
    time: Date.now(),
    level,
    actionIndex,
    actionType,
    message,
    ...details
  }
}

interface ControlPanelState {
  settings: UserSettings
  session: SessionState
  stats: import("@shared/types").StatsSnapshot
}

async function fetchControlPanelState(): Promise<ControlPanelState> {
  return (await chrome.runtime.sendMessage({
    type: "GET_STATE",
    payload: undefined
  } satisfies RuntimeEnvelope<"GET_STATE">)) as ControlPanelState
}

function ensureControlPanel(): void {
  if (panelInjected) return

  const host = document.createElement("div")
  host.id = "x-signal-shift-root"
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: 18px;
      top: 52%;
      transform: translateY(-50%);
      z-index: 2147483646;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #f8fafc;
    }
    .fab {
      width: 56px;
      height: 56px;
      border-radius: 999px;
      border: 1px solid rgba(186, 230, 253, 0.28);
      background: linear-gradient(145deg, #0ea5e9, #155e75);
      box-shadow: 0 16px 36px rgba(2, 8, 23, 0.35);
      cursor: pointer;
      display: grid;
      place-items: center;
      font-size: 22px;
      font-weight: 700;
      color: white;
    }
    .panel {
      position: absolute;
      right: 72px;
      top: 50%;
      transform: translateY(-50%);
      width: 320px;
      max-height: 72vh;
      overflow: auto;
      border-radius: 18px;
      border: 1px solid rgba(51, 65, 85, 0.9);
      background: rgba(15, 23, 32, 0.96);
      box-shadow: 0 18px 46px rgba(2, 8, 23, 0.4);
      padding: 14px;
      display: none;
      gap: 10px;
      backdrop-filter: blur(10px);
    }
    .panel.open { display: grid; }
    .title { font-size: 16px; font-weight: 700; }
    .muted, .log { font-size: 12px; color: #94a3b8; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .card {
      border: 1px solid rgba(51, 65, 85, 0.9);
      border-radius: 12px;
      padding: 10px;
      background: rgba(255,255,255,0.03);
    }
    .card strong { display: block; font-size: 15px; color: #f8fafc; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .btn {
      border-radius: 12px;
      border: 0;
      padding: 10px 12px;
      cursor: pointer;
      color: white;
      font-weight: 600;
    }
    .btn.start { background: linear-gradient(135deg, #0284c7, #22d3ee); }
    .btn.stop { background: #1e3a5f; }
    .logbox {
      display: grid;
      gap: 6px;
      border: 1px solid rgba(51, 65, 85, 0.9);
      border-radius: 12px;
      padding: 10px;
      max-height: 220px;
      overflow: auto;
      background: rgba(255,255,255,0.02);
    }
    .step {
      font-size: 12px;
      color: #cbd5e1;
      padding: 8px 10px;
      border-radius: 10px;
      background: rgba(2,132,199,0.12);
    }
  `

  const container = document.createElement("div")
  container.className = "wrap"
  container.innerHTML = `
    <button class="fab" id="fab" title="SignalShift">S</button>
    <section class="panel" id="panel">
      <div class="title">SignalShift</div>
      <div class="muted" id="themes">Loading…</div>
      <div class="grid">
        <div class="card"><span class="muted">状态</span><strong id="status">idle</strong></div>
        <div class="card"><span class="muted">当前步骤</span><strong id="step">0/0</strong></div>
        <div class="card"><span class="muted">今日会话</span><strong id="sessions">0</strong></div>
        <div class="card"><span class="muted">曝光率</span><strong id="exposure">0%</strong></div>
      </div>
      <div class="step" id="actionLabel">当前动作：-</div>
      <div class="actions">
        <button class="btn start" id="start">启动</button>
        <button class="btn stop" id="stop">停止</button>
      </div>
      <div class="muted" id="error"></div>
      <div class="logbox" id="logs"></div>
    </section>
  `

  shadow.append(style, container)

  const fab = shadow.getElementById("fab") as HTMLButtonElement
  const panel = shadow.getElementById("panel") as HTMLElement

  fab.addEventListener("click", () => {
    panelOpen = !panelOpen
    panel.classList.toggle("open", panelOpen)
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

  panelInjected = true
  void renderControlPanel(shadow)

  if (statusPollTimer === null) {
    statusPollTimer = window.setInterval(() => {
      if (panelOpen) {
        void renderControlPanel(shadow)
      }
    }, 1500)
  }
}

async function renderControlPanel(shadow: ShadowRoot): Promise<void> {
  const state = await fetchControlPanelState().catch(() => null)
  if (!state) return

  const todayMetric = state.stats.dailyMetrics[state.stats.dailyMetrics.length - 1]
  const totalActions = state.session.currentPlan?.actions.length ?? 0
  const currentStep = totalActions === 0 ? 0 : Math.min(state.session.currentActionIndex + 1, totalActions)
  const logs = state.stats.recentLogs.slice().reverse().slice(0, 12)

  ;(shadow.getElementById("themes") as HTMLElement).textContent = `主题：${state.settings.themes.map((theme) => theme.name).join(", ")}`
  ;(shadow.getElementById("status") as HTMLElement).textContent = state.session.status
  ;(shadow.getElementById("step") as HTMLElement).textContent = `${currentStep}/${totalActions}`
  ;(shadow.getElementById("sessions") as HTMLElement).textContent = String(todayMetric?.sessionsStarted ?? 0)
  ;(shadow.getElementById("exposure") as HTMLElement).textContent = `${Math.round(state.stats.targetThemeExposureRate * 100)}%`
  ;(shadow.getElementById("actionLabel") as HTMLElement).textContent = `当前动作：${state.session.currentActionLabel ?? "-"}`
  ;(shadow.getElementById("error") as HTMLElement).textContent = state.session.lastError ? `失败定位：${state.session.lastError}` : ""
  ;(shadow.getElementById("logs") as HTMLElement).innerHTML =
    logs.length > 0
      ? logs
          .map(
            (entry) =>
              `<div class="log" style="color:${
                entry.level === "error" ? "#fda4af" : entry.level === "success" ? "#86efac" : "#93c5fd"
              }">${new Date(entry.time).toLocaleTimeString("zh-CN", { hour12: false })} | #${entry.actionIndex + 1} | ${
                entry.actionType
              } | ${entry.message}${entry.durationMs ? ` | ${entry.durationMs}ms` : ""}${
                entry.pageBefore || entry.pageAfter ? ` | ${entry.pageBefore ?? "-"} -> ${entry.pageAfter ?? "-"}` : ""
              }</div>`
          )
          .join("")
      : '<div class="log">还没有日志</div>'
}

async function emitActionEvent(
  entry: ExecutionLogEntry,
  currentActionIndex: number,
  currentActionLabel: string | null
): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "ACTION_EVENT",
    payload: {
      entry,
      currentActionIndex,
      currentActionLabel
    }
  } satisfies RuntimeEnvelope<"ACTION_EVENT">)
}

async function updateProgress(plan: SessionPlan | null, currentActionIndex: number, patch?: Partial<SessionState>): Promise<void> {
  await setSessionState({
    ...(await getSessionState().catch(() => defaultSessionState)),
    currentPlan: plan,
    currentActionIndex,
    ...patch
  })
}

async function runPlan(plan: SessionPlan, settings: UserSettings, startIndex = 0): Promise<void> {
  activePlanId = plan.id
  aborted = false
  const failures: string[] = []
  let actionsCompleted = startIndex

  try {
    await waitForPageReady()

    for (let index = startIndex; index < plan.actions.length; index += 1) {
      const action = plan.actions[index]
      if (aborted || activePlanId !== plan.id) break
      const pageBefore = detectPageKind()
      const actionStartedAt = Date.now()
      try {
        await updateProgress(plan, index, { status: "running", currentActionLabel: action.type })
        await emitActionEvent(
          buildLogEntry(index, action.type, `Starting ${action.type} for ${action.theme}`, "info", {
            pageBefore,
            pageAfter: pageBefore
          }),
          index,
          action.type
        )
        await executeAction(action, settings.themes)
        actionsCompleted += 1
        const pageAfter = detectPageKind()
        const durationMs = Date.now() - actionStartedAt
        await updateProgress(plan, index + 1, { lastError: null, currentActionLabel: plan.actions[index + 1]?.type ?? null })
        await emitActionEvent(
          buildLogEntry(index, action.type, `Completed ${action.type} for ${action.theme}`, "success", {
            durationMs,
            pageBefore,
            pageAfter
          }),
          index + 1,
          plan.actions[index + 1]?.type ?? null
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unknown failure in ${action.type}`
        failures.push(`${action.type}: ${message}`)
        const pageAfter = detectPageKind()
        const durationMs = Date.now() - actionStartedAt
        await updateProgress(plan, index + 1, {
          lastError: message,
          currentActionLabel: plan.actions[index + 1]?.type ?? null
        })
        await emitActionEvent(
          buildLogEntry(index, action.type, `Failed ${action.type}: ${message}`, "error", {
            durationMs,
            pageBefore,
            pageAfter
          }),
          index + 1,
          plan.actions[index + 1]?.type ?? null
        )

        if (window.history.length > 1 && action.type !== "search" && action.type !== "observeHome") {
          window.history.back()
          await delayBetweenActions()
          await waitForPageReady().catch(() => undefined)
        }
      }

      if (action.type === "search") {
        return
      }

      await delayBetweenActions()
    }

    const summary = collectFeedSnapshot(settings.themes)
    await chrome.runtime.sendMessage({
      type: "PLAN_FINISHED",
      payload: {
        summary,
        actionsAttempted: plan.actions.length,
        actionsCompleted,
        failures
      }
    } satisfies RuntimeEnvelope<"PLAN_FINISHED">)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown content execution failure"
    await emitActionEvent(buildLogEntry(startIndex, "system", message, "error"), startIndex, null)
    await chrome.runtime.sendMessage({
      type: "PLAN_FAILED",
      payload: { error: message }
    } satisfies RuntimeEnvelope<"PLAN_FAILED">)
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeEnvelope) => {
  void (async () => {
    const settings = (await getSettings().catch(() => defaultSettings)) ?? defaultSettings

    switch (message.type) {
      case "RUN_PLAN":
        await runPlan(message.payload as SessionPlan, settings, 0)
        break
      case "STOP_AUTOMATION":
        aborted = true
        activePlanId = null
        await updateProgress(null, 0, { status: "idle" })
        break
      default:
        break
    }
  })()
})

void (async () => {
  ensureControlPanel()

  if (resuming) return
  resuming = true

  const [settings, session] = await Promise.all([
    getSettings().catch(() => defaultSettings),
    getSessionState().catch(() => defaultSessionState)
  ])

  if (session.status === "running" && session.currentPlan && session.currentActionIndex < session.currentPlan.actions.length) {
    await runPlan(session.currentPlan, settings, session.currentActionIndex)
  }

  resuming = false
})()
