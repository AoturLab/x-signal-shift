import { STORAGE_KEYS } from "./constants"
import type { DailyMetric, SessionState, StatsSnapshot, UserSettings } from "./types"

export const defaultSettings: UserSettings = {
  enabled: false,
  themes: [
    {
      name: "科技",
      weight: 1,
      languages: ["zh", "en"],
      keywords: ["tech", "technology", "科技", "engineering"],
      exclusions: []
    }
  ],
  customKeywords: [],
  riskLevel: "conservative",
  languagePreference: "bilingual",
  dailySessionCount: 3,
  sessionDurationMinSec: 180,
  sessionDurationMaxSec: 360
}

export const defaultSessionState: SessionState = {
  status: "idle",
  currentPlan: null,
  currentActionIndex: 0,
  currentActionLabel: null,
  startedAt: null,
  lastError: null,
  lastCompletedAt: null
}

export const defaultStats: StatsSnapshot = {
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

export function todayKey(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function updateDailyMetrics(
  metrics: DailyMetric[],
  day: string,
  updater: (current: DailyMetric) => DailyMetric
): DailyMetric[] {
  const existing =
    metrics.find((item) => item.day === day) ?? {
      day,
      sessionsStarted: 0,
      sessionsSucceeded: 0,
      sessionsFailed: 0,
      actionsCompleted: 0,
      targetThemeExposureRate: 0,
      authorDiversityScore: 0
    }

  const next = updater(existing)
  const filtered = metrics.filter((item) => item.day !== day)

  return [...filtered, next].sort((left, right) => left.day.localeCompare(right.day)).slice(-7)
}

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings)
  return (result[STORAGE_KEYS.settings] as UserSettings | undefined) ?? defaultSettings
}

export async function setSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings })
}

export async function getSessionState(): Promise<SessionState> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.session)
  return (result[STORAGE_KEYS.session] as SessionState | undefined) ?? defaultSessionState
}

export async function setSessionState(state: SessionState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: state })
}

export async function getStats(): Promise<StatsSnapshot> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.stats)
  return (result[STORAGE_KEYS.stats] as StatsSnapshot | undefined) ?? defaultStats
}

export async function setStats(stats: StatsSnapshot): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.stats]: stats })
}
