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
  setStats
} from "@shared/storage"
import type { FeedSnapshot, SessionState, StatsSnapshot, UserSettings } from "@shared/types"

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
    startedAt: Date.now(),
    lastError: null
  })

  const stats = await getStats().catch(() => defaultStats)
  await setStats({
    ...stats,
    sessionsStarted: stats.sessionsStarted + 1,
    lastRunAt: Date.now()
  })

  await chrome.tabs.sendMessage(tab.id, {
    type: "RUN_PLAN",
    payload: plan
  } satisfies RuntimeEnvelope<"RUN_PLAN">)

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
          await chrome.tabs.sendMessage(
            tab.id,
            { type: "STOP_AUTOMATION", payload: undefined } satisfies RuntimeEnvelope<"STOP_AUTOMATION">
          )
        }

        const settings = await getSettings()
        const nextSettings = { ...settings, enabled: false }
        await setSettings(nextSettings)
        await syncAlarm(nextSettings)

        await updateSessionState({
          status: "idle",
          currentPlan: null,
          startedAt: null
        })
        sendResponse({ ok: true })
        return
      }
      case "PLAN_FINISHED": {
        const { summary } = message.payload as { summary: FeedSnapshot }
        const stats = await getStats()
        const metrics = summarizeFeed(summary)
        const session = await getSessionState()

        await setStats({
          ...stats,
          actionsCompleted: stats.actionsCompleted + (session.currentPlan?.actions.length ?? 0),
          targetThemeExposureRate: metrics.targetThemeExposureRate,
          authorDiversityScore: metrics.authorDiversityScore,
          lastRunAt: Date.now()
        })

        await updateSessionState({
          status: "idle",
          currentPlan: null,
          startedAt: null,
          lastError: null
        })

        sendResponse({ ok: true })
        return
      }
      case "PLAN_FAILED": {
        await updateSessionState({
          status: "error",
          lastError: (message.payload as { error: string }).error
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
