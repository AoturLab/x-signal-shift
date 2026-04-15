import { buildSessionPlan } from "@strategy/engine"
import type { RuntimeEnvelope } from "@shared/messages"
import {
  defaultSessionState,
  defaultStats,
  getSessionState,
  getSettings,
  getStats,
  setSessionState,
  setSettings,
  setStats,
  todayKey,
  updateDailyMetrics
} from "@shared/storage"
import type {
  ActionExecutionResult,
  ActionPlan,
  ActionPreparationResult,
  ExecutionLogEntry,
  FeedSnapshot,
  PageContext,
  SessionExecutionSummary,
  SessionState,
  StatsSnapshot,
  UserSettings
} from "@shared/types"

const TRAINING_ALARM = "training-session"
const CONTENT_READY_TIMEOUT_MS = 18000
let dispatchInFlight = false

function isNavigationAction(action: ActionPlan): boolean {
  return action.type === "search" || action.type === "openDetail" || action.type === "openAuthor" || action.type === "observeHome"
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildActionLabel(action: ActionPlan | null | undefined): string | null {
  if (!action) return null
  return action.type === "search" ? `${action.type}:${action.queryLabel ?? action.query ?? action.theme}` : action.type
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

async function appendLog(entry: ExecutionLogEntry): Promise<void> {
  const stats = await getStats().catch(() => defaultStats)
  await setStats({
    ...stats,
    recentLogs: [...stats.recentLogs, entry].slice(-50)
  })
}

async function queryActiveXTab(): Promise<chrome.tabs.Tab | null> {
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const active = activeTabs.find((tab) => tab.id && tab.url && /https:\/\/(x|twitter)\.com\//.test(tab.url))
  if (active) return active

  const anyTabs = await chrome.tabs.query({})
  return anyTabs.find((tab) => tab.id && tab.url && /https:\/\/(x|twitter)\.com\//.test(tab.url)) ?? null
}

async function ensureXTab(): Promise<chrome.tabs.Tab> {
  const existing = await queryActiveXTab()
  if (existing?.id) return existing

  const created = await chrome.tabs.create({ url: "https://x.com/home", active: true })
  if (!created.id) {
    throw new Error("Unable to open an X tab.")
  }
  return created
}

async function openDrawerOnTab(tabId: number): Promise<void> {
  await probePageContext(tabId, 12000)
  await chrome.tabs.sendMessage(tabId, {
    type: "OPEN_DRAWER",
    payload: undefined
  } satisfies RuntimeEnvelope<"OPEN_DRAWER">)
}

async function updateSessionState(partial: Partial<SessionState>): Promise<SessionState> {
  const current = await getSessionState().catch(() => defaultSessionState)
  const next = { ...current, ...partial }
  await setSessionState(next)
  return next
}

function summarizeFeed(summary: FeedSnapshot): Pick<StatsSnapshot, "targetThemeExposureRate" | "authorDiversityScore"> {
  const totalMatches = Object.values(summary.themeMatches).reduce((sum, value) => sum + value, 0)

  return {
    targetThemeExposureRate: summary.totalTweets === 0 ? 0 : totalMatches / summary.totalTweets,
    authorDiversityScore: summary.totalTweets === 0 ? 0 : summary.authorHandles.length / summary.totalTweets
  }
}

async function syncAlarm(settings: UserSettings): Promise<void> {
  await chrome.alarms.clear(TRAINING_ALARM)
  if (!settings.enabled) return

  const periodInMinutes = Math.max(60, Math.floor(1440 / Math.max(1, settings.dailySessionCount)))
  await chrome.alarms.create(TRAINING_ALARM, {
    delayInMinutes: 1,
    periodInMinutes
  })
}

async function probePageContext(tabId: number, timeoutMs = CONTENT_READY_TIMEOUT_MS): Promise<PageContext> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: "GET_PAGE_CONTEXT",
        payload: undefined
      } satisfies RuntimeEnvelope<"GET_PAGE_CONTEXT">)) as PageContext

      if (response?.pageKind) return response
    } catch {
      // content script may still be attaching after navigation
    }

    await sleep(500)
  }

  throw new Error("Timed out waiting for the X page to become ready.")
}

async function collectSummary(tabId: number | null, settings: UserSettings): Promise<FeedSnapshot> {
  if (!tabId) {
    return {
      totalTweets: 0,
      themeMatches: Object.fromEntries(settings.themes.map((theme) => [theme.name, 0])),
      authorHandles: [],
      candidateQualityScore: 0
    }
  }

  try {
    return (await chrome.tabs.sendMessage(tabId, {
      type: "COLLECT_FEED_SNAPSHOT",
      payload: { themes: settings.themes }
    } satisfies RuntimeEnvelope<"COLLECT_FEED_SNAPSHOT">)) as FeedSnapshot
  } catch {
    return {
      totalTweets: 0,
      themeMatches: Object.fromEntries(settings.themes.map((theme) => [theme.name, 0])),
      authorHandles: [],
      candidateQualityScore: 0
    }
  }
}

async function finalizeSession(summary: FeedSnapshot, failures: string[]): Promise<void> {
  const stats = await getStats().catch(() => defaultStats)
  const session = await getSessionState().catch(() => defaultSessionState)
  const metrics = summarizeFeed(summary)
  const day = todayKey()
  const succeeded = failures.length === 0
  const actionsCompleted = session.currentActionIndex

  await setStats({
    ...stats,
    sessionsSucceeded: stats.sessionsSucceeded + (succeeded ? 1 : 0),
    sessionsFailed: stats.sessionsFailed + (succeeded ? 0 : 1),
    actionsCompleted: stats.actionsCompleted + actionsCompleted,
    targetThemeExposureRate: metrics.targetThemeExposureRate,
    authorDiversityScore: metrics.authorDiversityScore,
    lastRunAt: Date.now(),
    lastSuccessfulRunAt: succeeded ? Date.now() : stats.lastSuccessfulRunAt,
    dailyMetrics: updateDailyMetrics(stats.dailyMetrics, day, (metric) => ({
      ...metric,
      sessionsSucceeded: metric.sessionsSucceeded + (succeeded ? 1 : 0),
      sessionsFailed: metric.sessionsFailed + (succeeded ? 0 : 1),
      actionsCompleted: metric.actionsCompleted + actionsCompleted,
      targetThemeExposureRate: metrics.targetThemeExposureRate,
      authorDiversityScore: metrics.authorDiversityScore
    }))
  })

  await updateSessionState({
    status: "idle",
    currentPlan: null,
    currentActionIndex: 0,
    currentActionLabel: null,
    activeTabId: null,
    pendingNavigation: false,
    startedAt: null,
    lastError: failures[0] ?? null,
    lastCompletedAt: Date.now()
  })
}

async function failSession(error: string, action?: ActionPlan, actionIndex = 0): Promise<void> {
  await appendLog(
    buildLogEntry(actionIndex, action?.type ?? "system", error, "error", {
      pageAfter: "unknown"
    })
  )

  const stats = await getStats().catch(() => defaultStats)
  const day = todayKey()
  await setStats({
    ...stats,
    sessionsFailed: stats.sessionsFailed + 1,
    dailyMetrics: updateDailyMetrics(stats.dailyMetrics, day, (metric) => ({
      ...metric,
      sessionsFailed: metric.sessionsFailed + 1
    }))
  })

  await updateSessionState({
    status: "error",
    currentPlan: null,
    currentActionIndex: 0,
    currentActionLabel: null,
    activeTabId: null,
    pendingNavigation: false,
    startedAt: null,
    lastError: error
  })
}

async function dispatchNextAction(): Promise<void> {
  if (dispatchInFlight) return
  dispatchInFlight = true

  try {
    const [settings, session] = await Promise.all([getSettings(), getSessionState()])
    if (session.status !== "running" || !session.currentPlan || session.pendingNavigation) return

    const action = session.currentPlan.actions[session.currentActionIndex]
    if (!action) {
      const summary = await collectSummary(session.activeTabId, settings)
      await finalizeSession(summary, session.lastError ? [session.lastError] : [])
      return
    }

    const tabId = session.activeTabId ?? (await queryActiveXTab())?.id ?? null
    if (!tabId) {
      await failSession("No active X tab found.", action, session.currentActionIndex)
      return
    }

    const currentLabel = buildActionLabel(action)
    await updateSessionState({
      activeTabId: tabId,
      currentActionLabel: currentLabel,
      lastError: null
    })
    await appendLog(
      buildLogEntry(session.currentActionIndex, action.type, `Starting ${action.type} for ${action.queryLabel ?? action.theme}`, "info")
    )

    if (isNavigationAction(action)) {
      let prepared: ActionPreparationResult

      try {
        prepared = (await chrome.tabs.sendMessage(tabId, {
          type: "PREPARE_ACTION",
          payload: {
            action,
            actionIndex: session.currentActionIndex,
            themes: settings.themes
          }
        } satisfies RuntimeEnvelope<"PREPARE_ACTION">)) as ActionPreparationResult
      } catch (error) {
        await failSession(
          error instanceof Error
            ? `Failed to prepare ${action.type}. (${error.message})`
            : `Failed to prepare ${action.type}.`,
          action,
          session.currentActionIndex
        )
        return
      }

      const nextActionIndex = session.currentActionIndex + 1
      const nextActionLabel = buildActionLabel(session.currentPlan.actions[nextActionIndex])

      if (prepared.status === "failed") {
        await appendLog(
          buildLogEntry(session.currentActionIndex, action.type, prepared.message, "error", {
            durationMs: prepared.durationMs,
            pageBefore: prepared.pageBefore,
            pageAfter: prepared.pageAfter
          })
        )
        await updateSessionState({
          currentActionIndex: nextActionIndex,
          currentActionLabel: nextActionLabel,
          lastKnownPageKind: prepared.pageAfter,
          lastError: prepared.message
        })
        void dispatchNextAction()
        return
      }

      if (prepared.status === "skipped") {
        await appendLog(
          buildLogEntry(session.currentActionIndex, action.type, prepared.message, "info", {
            durationMs: prepared.durationMs,
            pageBefore: prepared.pageBefore,
            pageAfter: prepared.pageAfter
          })
        )
        await updateSessionState({
          currentActionIndex: nextActionIndex,
          currentActionLabel: nextActionLabel,
          lastKnownPageKind: prepared.pageAfter,
          lastError: null
        })
        void dispatchNextAction()
        return
      }

      if (prepared.status === "navigate") {
        if (!prepared.targetUrl) {
          await failSession(`Missing navigation target for ${action.type}.`, action, session.currentActionIndex)
          return
        }

        try {
          await chrome.tabs.update(tabId, { url: prepared.targetUrl })
        } catch (error) {
          await failSession(
            error instanceof Error ? `Failed to navigate to target page. (${error.message})` : "Failed to navigate to target page.",
            action,
            session.currentActionIndex
          )
          return
        }

        await appendLog(
          buildLogEntry(session.currentActionIndex, action.type, prepared.message, "success", {
            durationMs: prepared.durationMs,
            pageBefore: prepared.pageBefore,
            pageAfter: prepared.pageAfter
          })
        )
        await updateSessionState({
          currentActionIndex: nextActionIndex,
          currentActionLabel: nextActionLabel,
          pendingNavigation: true,
          lastKnownPageKind: prepared.pageAfter,
          lastError: null
        })
        return
      }
    }

    let result: ActionExecutionResult

    try {
      result = (await chrome.tabs.sendMessage(tabId, {
        type: "EXECUTE_IN_PLACE",
        payload: {
          action,
          actionIndex: session.currentActionIndex,
          themes: settings.themes
        }
      } satisfies RuntimeEnvelope<"EXECUTE_IN_PLACE">)) as ActionExecutionResult
    } catch (error) {
      await failSession(
        error instanceof Error
          ? `Content script unavailable. Refresh the X tab and try again. (${error.message})`
          : "Content script unavailable. Refresh the X tab and try again.",
        action,
        session.currentActionIndex
      )
      return
    }

    const nextActionIndex = session.currentActionIndex + 1
    const nextActionLabel = buildActionLabel(session.currentPlan.actions[nextActionIndex])

    if (result.status === "failed") {
      await appendLog(
        buildLogEntry(session.currentActionIndex, action.type, result.message, "error", {
          durationMs: result.durationMs,
          pageBefore: result.pageBefore,
          pageAfter: result.pageAfter
        })
      )
      await updateSessionState({
        currentActionIndex: nextActionIndex,
        currentActionLabel: nextActionLabel,
        lastKnownPageKind: result.pageAfter,
        lastError: result.message
      })

      if (nextActionIndex >= session.currentPlan.actions.length) {
        const summary = await collectSummary(tabId, settings)
        await finalizeSession(summary, [result.message])
        return
      }

      void dispatchNextAction()
      return
    }

    await appendLog(
      buildLogEntry(
        session.currentActionIndex,
        action.type,
        result.message,
        result.status === "completed" ? "success" : "info",
        {
          durationMs: result.durationMs,
          pageBefore: result.pageBefore,
          pageAfter: result.pageAfter
        }
      )
    )

    await updateSessionState({
      currentActionIndex: nextActionIndex,
      currentActionLabel: nextActionLabel,
      lastKnownPageKind: result.pageAfter,
      lastError: null
    })

    if (nextActionIndex >= session.currentPlan.actions.length) {
      const summary = await collectSummary(tabId, settings)
      await finalizeSession(summary, [])
      return
    }

    void dispatchNextAction()
  } finally {
    dispatchInFlight = false
  }
}

async function startAutomation(): Promise<{ ok: boolean; reason?: string }> {
  const currentSession = await getSessionState()
  if (currentSession.status === "running") {
    return { ok: false, reason: "A training session is already running." }
  }

  const settings = await getSettings()
  const effectiveSettings = settings.enabled ? settings : { ...settings, enabled: true }
  if (!settings.enabled) {
    await setSettings(effectiveSettings)
    await syncAlarm(effectiveSettings)
  }

  const tab = await queryActiveXTab()
  if (!tab?.id) {
    return { ok: false, reason: "No active X tab found." }
  }

  const plan = buildSessionPlan(effectiveSettings)
  await updateSessionState({
    status: "running",
    currentPlan: plan,
    currentActionIndex: 0,
    currentActionLabel: buildActionLabel(plan.actions[0]),
    activeTabId: tab.id,
    pendingNavigation: false,
    startedAt: Date.now(),
    lastError: null
  })

  const stats = await getStats().catch(() => defaultStats)
  const day = todayKey()
  await setStats({
    ...stats,
    sessionsStarted: stats.sessionsStarted + 1,
    lastRunAt: Date.now(),
    dailyMetrics: updateDailyMetrics(stats.dailyMetrics, day, (metric) => ({
      ...metric,
      sessionsStarted: metric.sessionsStarted + 1
    }))
  })

  void dispatchNextAction()
  return { ok: true }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings()
  await setSettings(settings)
  await syncAlarm(settings)
})

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings()
  await syncAlarm(settings)
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TRAINING_ALARM) return
  void startAutomation()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return

  void (async () => {
    const session = await getSessionState().catch(() => defaultSessionState)
    if (session.status !== "running" || !session.pendingNavigation || session.activeTabId !== tabId) return

    try {
      const context = await probePageContext(tabId, 6000)
      await updateSessionState({
        pendingNavigation: false,
        lastKnownPageKind: context.pageKind,
        lastError: null
      })
      void dispatchNextAction()
    } catch {
      // Fall back to CONTENT_READY notifications if the page shell lags.
    }
  })()
})

chrome.runtime.onMessage.addListener((message: RuntimeEnvelope, sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case "GET_STATE": {
        const [settings, session, stats] = await Promise.all([getSettings(), getSessionState(), getStats()])
        sendResponse({ settings, session, stats })
        return
      }
      case "SAVE_SETTINGS": {
        const settings = message.payload as UserSettings
        await setSettings(settings)
        await syncAlarm(settings)
        sendResponse({ ok: true })
        return
      }
      case "START_AUTOMATION": {
        sendResponse(await startAutomation())
        return
      }
      case "OPEN_CONTROL_CENTER": {
        try {
          const tab = await ensureXTab()
          if (!tab.id) {
            sendResponse({ ok: false, reason: "Unable to open an X tab." })
            return
          }
          await openDrawerOnTab(tab.id)
          sendResponse({ ok: true })
        } catch (error) {
          sendResponse({
            ok: false,
            reason: error instanceof Error ? error.message : "Unable to open the control center."
          })
        }
        return
      }
      case "STOP_AUTOMATION": {
        const settings = await getSettings()
        const nextSettings = { ...settings, enabled: false }
        await setSettings(nextSettings)
        await syncAlarm(nextSettings)
        await updateSessionState({
          status: "idle",
          currentPlan: null,
          currentActionIndex: 0,
          currentActionLabel: null,
          activeTabId: null,
          pendingNavigation: false,
          startedAt: null
        })
        sendResponse({ ok: true })
        return
      }
      case "CONTENT_READY": {
        const payload = message.payload as PageContext
        if (!sender.tab?.id) {
          sendResponse({ ok: false })
          return
        }

        const session = await getSessionState().catch(() => defaultSessionState)
        await updateSessionState({ lastKnownPageKind: payload.pageKind })

        if (session.status === "running" && session.pendingNavigation && session.activeTabId === sender.tab.id) {
          await updateSessionState({
            pendingNavigation: false,
            lastError: null,
            lastKnownPageKind: payload.pageKind
          })
          void dispatchNextAction()
        }

        sendResponse({ ok: true })
        return
      }
      case "PLAN_FINISHED": {
        const { summary, failures } = message.payload as SessionExecutionSummary
        await finalizeSession(summary, failures)
        sendResponse({ ok: true })
        return
      }
      case "PLAN_FAILED": {
        await failSession((message.payload as { error: string }).error)
        sendResponse({ ok: true })
        return
      }
      default:
        sendResponse({ ok: false, reason: "Unknown message" })
    }
  })()

  return true
})
