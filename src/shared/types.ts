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
  dwellMs?: number
  maxItems?: number
  probability?: number
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
  startedAt: number | null
  lastError: string | null
}

export interface StatsSnapshot {
  sessionsStarted: number
  actionsCompleted: number
  targetThemeExposureRate: number
  authorDiversityScore: number
  lastRunAt: number | null
}

export interface FeedSnapshot {
  totalTweets: number
  themeMatches: Record<string, number>
  authorHandles: string[]
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
  RUN_PLAN: SessionPlan
  PLAN_FINISHED: { summary: FeedSnapshot }
  PLAN_FAILED: { error: string }
}
