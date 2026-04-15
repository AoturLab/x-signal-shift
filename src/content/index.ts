import { collectFeedSnapshot, detectPageKind } from "./page-adapters"
import { executeAction, waitForPageReady } from "./actions"
import type { RuntimeEnvelope } from "@shared/messages"
import { buildPanelMarkup, panelBaseStyles } from "@shared/panel-view"
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
    ${panelBaseStyles}
    .wrap {
      position: fixed;
      right: 18px;
      top: 52%;
      transform: translateY(-50%);
      z-index: 2147483646;
      font-family: "SF Pro Display", "Segoe UI", ui-sans-serif, sans-serif;
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
    .dock {
      position: absolute;
      right: 72px;
      top: 50%;
      transform: translateY(-50%);
      width: 332px;
      max-height: 72vh;
      overflow: auto;
      display: none;
      gap: 10px;
    }
    .dock.open { display: grid; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .btn {
      border-radius: 14px;
      border: 0;
      padding: 10px 12px;
      cursor: pointer;
      color: white;
      font-weight: 600;
    }
    .btn.start { background: linear-gradient(135deg, var(--accent-2), var(--accent)); }
    .btn.stop { background: linear-gradient(135deg, rgba(29,78,216,0.65), rgba(30,58,95,0.95)); }
  `

  const container = document.createElement("div")
  container.className = "wrap"
  container.innerHTML = `
    <button class="fab" id="fab" title="SignalShift">S</button>
    <section class="dock" id="panel">
      <div id="panel-content"></div>
      <section class="panel">
        <div class="section-head">
          <div>
            <div class="eyebrow">Control</div>
            <h2>快速操作</h2>
          </div>
          <p>直接在页面内控制运行</p>
        </div>
      <div class="actions">
        <button class="btn start" id="start">启动</button>
        <button class="btn stop" id="stop">停止</button>
      </div>
      </section>
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

  ;(shadow.getElementById("panel-content") as HTMLElement).innerHTML = buildPanelMarkup(state)
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
      const actionLabel = action.type === "search" ? `${action.type}:${action.queryLabel ?? action.query ?? action.theme}` : action.type
      const pageBefore = detectPageKind()
      const actionStartedAt = Date.now()
      try {
        await updateProgress(plan, index, { status: "running", currentActionLabel: actionLabel })
        await emitActionEvent(
          buildLogEntry(index, action.type, `Starting ${action.type} for ${action.queryLabel ?? action.theme}`, "info", {
            pageBefore,
            pageAfter: pageBefore
          }),
          index,
          actionLabel
        )
        await executeAction(action, settings.themes)
        actionsCompleted += 1
        const pageAfter = detectPageKind()
        const durationMs = Date.now() - actionStartedAt
        const nextActionLabel = plan.actions[index + 1]
          ? plan.actions[index + 1].type === "search"
            ? `${plan.actions[index + 1].type}:${plan.actions[index + 1].queryLabel ?? plan.actions[index + 1].query ?? plan.actions[index + 1].theme}`
            : plan.actions[index + 1].type
          : null
        await updateProgress(plan, index + 1, { lastError: null, currentActionLabel: nextActionLabel })
        await emitActionEvent(
          buildLogEntry(index, action.type, `Completed ${action.type} for ${action.queryLabel ?? action.theme}`, "success", {
            durationMs,
            pageBefore,
            pageAfter
          }),
          index + 1,
          nextActionLabel
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unknown failure in ${action.type}`
        failures.push(`${action.type}: ${message}`)
        const pageAfter = detectPageKind()
        const durationMs = Date.now() - actionStartedAt
        const nextActionLabel = plan.actions[index + 1]
          ? plan.actions[index + 1].type === "search"
            ? `${plan.actions[index + 1].type}:${plan.actions[index + 1].queryLabel ?? plan.actions[index + 1].query ?? plan.actions[index + 1].theme}`
            : plan.actions[index + 1].type
          : null
        await updateProgress(plan, index + 1, {
          lastError: message,
          currentActionLabel: nextActionLabel
        })
        await emitActionEvent(
          buildLogEntry(index, action.type, `Failed ${action.type} for ${action.queryLabel ?? action.theme}: ${message}`, "error", {
            durationMs,
            pageBefore,
            pageAfter
          }),
          index + 1,
          nextActionLabel
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
