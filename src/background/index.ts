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
import type { FeedSnapshot, SessionExecutionSummary, SessionState, StatsSnapshot, UserSettings } from "@shared/types"

const TRAINING_ALARM = "training-session"

async function queryActiveXTab(): Promise<chrome.tabs.Tab | null> {
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const active = activeTabs.find((tab) => tab.id && tab.url && /https:\/\/(x|twitter)\.com\//.test(tab.url))
  if (active) return active

  const anyTabs = await chrome.tabs.query({})
  return anyTabs.find((tab) => tab.id && tab.url && /https:\/\/(x|twitter)\.com\//.test(tab.url)) ?? null
}

async function updateSessionState(partial: Partial<SessionState>): Promise<SessionState> {
  const current = await getSessionState().catch(() => defaultSessionState)
  const next = { ...current, ...partial }
  await setSessionState(next)
  return next
}

async function startAutomation(): Promise<{ ok: boolean; reason?: string }> {
  const currentSession = await getSessionState()
  if (currentSession.status === "running") {
    return { ok: false, reason: "A training session is already running." }
  }

  const settings = await getSettings()
  if (!settings.enabled) {
    return { ok: false, reason: "Automation is disabled in settings." }
  }

  const tab = await queryActiveXTab()
  if (!tab?.id) {
    return { ok: false, reason: "No active X tab found." }
  }

  const plan = buildSessionPlan(settings)
  await updateSessionState({
    status: "running",
    currentPlan: plan,
    currentActionIndex: 0,
    currentActionLabel: plan.actions[0]?.type ?? null,
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

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "RUN_PLAN",
      payload: plan
    } satisfies RuntimeEnvelope<"RUN_PLAN">)
  } catch (error) {
    await updateSessionState({
      status: "error",
      currentPlan: null,
      currentActionIndex: 0,
      currentActionLabel: null,
      startedAt: null,
      lastError: "Content script unavailable. Refresh the X tab and try again."
    })

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

    return {
      ok: false,
      reason:
        error instanceof Error
          ? `Content script unavailable. Refresh the X tab and try again. (${error.message})`
          : "Content script unavailable. Refresh the X tab and try again."
    }
  }

  return { ok: true }
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

function summarizeFeed(summary: FeedSnapshot): Pick<StatsSnapshot, "targetThemeExposureRate" | "authorDiversityScore"> {
  const totalMatches = Object.values(summary.themeMatches).reduce((sum, value) => sum + value, 0)

  return {
    targetThemeExposureRate: summary.totalTweets === 0 ? 0 : totalMatches / summary.totalTweets,
    authorDiversityScore: summary.totalTweets === 0 ? 0 : summary.authorHandles.length / summary.totalTweets
  }
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

chrome.runtime.onMessage.addListener((message: RuntimeEnvelope, _sender, sendResponse) => {
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
      case "STOP_AUTOMATION": {
        const tab = await queryActiveXTab()
        if (tab?.id) {
          try {
            await chrome.tabs.sendMessage(
              tab.id,
              { type: "STOP_AUTOMATION", payload: undefined } satisfies RuntimeEnvelope<"STOP_AUTOMATION">
            )
          } catch {
            // The tab likely has no injected content script yet; stopping local state is still safe.
          }
        }

        const settings = await getSettings()
        const nextSettings = { ...settings, enabled: false }
        await setSettings(nextSettings)
        await syncAlarm(nextSettings)

        await updateSessionState({
          status: "idle",
          currentPlan: null,
          currentActionIndex: 0,
          currentActionLabel: null,
          startedAt: null
        })
        sendResponse({ ok: true })
        return
      }
      case "ACTION_EVENT": {
        const { entry, currentActionIndex, currentActionLabel } = message.payload as {
          entry: import("@shared/types").ExecutionLogEntry
          currentActionIndex: number
          currentActionLabel: string | null
        }
        const stats = await getStats()
        await setStats({
          ...stats,
          recentLogs: [...stats.recentLogs, entry].slice(-50)
        })
        await updateSessionState({
          currentActionIndex,
          currentActionLabel,
          lastError: entry.level === "error" ? entry.message : null
        })
        sendResponse({ ok: true })
        return
      }
      case "PLAN_FINISHED": {
        const { summary, actionsCompleted, failures } = message.payload as SessionExecutionSummary
        const stats = await getStats()
        const metrics = summarizeFeed(summary)
        const session = await getSessionState()
        const day = todayKey()
        const succeeded = failures.length === 0

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
          startedAt: null,
          lastError: failures[0] ?? null,
          lastCompletedAt: Date.now()
        })

        sendResponse({ ok: true })
        return
      }
      case "PLAN_FAILED": {
        const stats = await getStats()
        const day = todayKey()
        await updateSessionState({
          status: "error",
          currentActionIndex: 0,
          currentActionLabel: null,
          lastError: (message.payload as { error: string }).error
        })
        await setStats({
          ...stats,
          sessionsFailed: stats.sessionsFailed + 1,
          dailyMetrics: updateDailyMetrics(stats.dailyMetrics, day, (metric) => ({
            ...metric,
            sessionsFailed: metric.sessionsFailed + 1
          }))
        })
        sendResponse({ ok: true })
        return
      }
      default:
        sendResponse({ ok: false, reason: "Unknown message" })
    }
  })()

  return true
})
