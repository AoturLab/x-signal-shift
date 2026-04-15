export type RiskLevel = "conservative" | "standard" | "aggressive"
export type LanguagePreference = "zh" | "en" | "bilingual"
export type RuntimeStatus = "idle" | "running" | "paused" | "cooldown" | "error"
export type PageKind = "home" | "search" | "tweetDetail" | "profile" | "unknown"
export type ActionType =
  | "search"
  | "openDetail"
  | "dwell"
  | "expandReplies"
  | "openAuthor"
  | "scrollProfile"
  | "like"
  | "bookmark"
  | "follow"
  | "observeHome"

export interface ThemePlan {
  name: string
  weight: number
  languages: Array<"zh" | "en">
  keywords: string[]
  exclusions: string[]
}

export interface UserSettings {
  enabled: boolean
  themes: ThemePlan[]
  customKeywords: string[]
  riskLevel: RiskLevel
  languagePreference: LanguagePreference
  dailySessionCount: number
  sessionDurationMinSec: number
  sessionDurationMaxSec: number
}

export interface ActionPlan {
  type: ActionType
  theme: string
  query?: string
  queryLabel?: string
  dwellMs?: number
  maxItems?: number
  probability?: number
  retries?: number
}

export interface SessionPlan {
  id: string
  createdAt: number
  actions: ActionPlan[]
  targetThemes: string[]
}

export interface SessionState {
  status: RuntimeStatus
  currentPlan: SessionPlan | null
  currentActionIndex: number
  currentActionLabel: string | null
  activeTabId: number | null
  pendingNavigation: boolean
  lastKnownPageKind: PageKind
  startedAt: number | null
  lastError: string | null
  lastCompletedAt: number | null
}

export type LogLevel = "info" | "success" | "error"

export interface ExecutionLogEntry {
  id: string
  time: number
  level: LogLevel
  actionIndex: number
  actionType: ActionType | "system"
  message: string
  durationMs?: number
  pageBefore?: PageKind
  pageAfter?: PageKind
}

export interface DailyMetric {
  day: string
  sessionsStarted: number
  sessionsSucceeded: number
  sessionsFailed: number
  actionsCompleted: number
  targetThemeExposureRate: number
  authorDiversityScore: number
}

export interface StatsSnapshot {
  sessionsStarted: number
  sessionsSucceeded: number
  sessionsFailed: number
  actionsCompleted: number
  targetThemeExposureRate: number
  authorDiversityScore: number
  lastRunAt: number | null
  lastSuccessfulRunAt: number | null
  dailyMetrics: DailyMetric[]
  recentLogs: ExecutionLogEntry[]
}

export interface FeedSnapshot {
  totalTweets: number
  themeMatches: Record<string, number>
  authorHandles: string[]
  candidateQualityScore: number
}

export interface SessionExecutionSummary {
  summary: FeedSnapshot
  actionsAttempted: number
  actionsCompleted: number
  failures: string[]
}

export interface PageContext {
  pageKind: PageKind
  url: string
}

export interface ActionExecutionResult {
  status: "completed" | "navigating" | "skipped" | "failed"
  message: string
  durationMs: number
  pageBefore: PageKind
  pageAfter: PageKind
  targetUrl?: string
}

export interface StrategyProfile {
  dailySessionCount: number
  sessionDurationMinSec: number
  sessionDurationMaxSec: number
  actionMix: Record<Exclude<ActionType, "dwell" | "expandReplies" | "scrollProfile" | "observeHome">, number>
  limits: {
    maxLikesPerDay: number
    maxBookmarksPerDay: number
    maxFollowsPerDay: number
    maxSearchesPerSession: number
    maxDetailsPerSession: number
  }
}

export interface RuntimeMessageMap {
  GET_STATE: undefined
  SAVE_SETTINGS: UserSettings
  START_AUTOMATION: undefined
  STOP_AUTOMATION: undefined
  EXECUTE_ACTION: { action: ActionPlan; actionIndex: number; themes: ThemePlan[] }
  GET_PAGE_CONTEXT: undefined
  COLLECT_FEED_SNAPSHOT: { themes: ThemePlan[] }
  CONTENT_READY: PageContext
  PLAN_FINISHED: SessionExecutionSummary
  PLAN_FAILED: { error: string }
}
