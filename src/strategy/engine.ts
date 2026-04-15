import type { ActionPlan, SessionPlan, StrategyProfile, ThemePlan, UserSettings } from "@shared/types"

function toStrategyProfile(settings: UserSettings): StrategyProfile {
  const likes = settings.riskLevel === "aggressive" ? 6 : settings.riskLevel === "standard" ? 3 : 1
  const follows = settings.riskLevel === "aggressive" ? 2 : settings.riskLevel === "standard" ? 1 : 0
  const searches = settings.riskLevel === "aggressive" ? 4 : settings.riskLevel === "standard" ? 3 : 2
  const details = settings.riskLevel === "aggressive" ? 6 : settings.riskLevel === "standard" ? 4 : 3

  return {
    dailySessionCount: settings.dailySessionCount,
    sessionDurationMinSec: settings.sessionDurationMinSec,
    sessionDurationMaxSec: settings.sessionDurationMaxSec,
    actionMix: {
      search: 3,
      openDetail: 4,
      openAuthor: 2,
      like: likes,
      bookmark: 1,
      follow: follows
    },
    limits: {
      maxLikesPerDay: likes,
      maxBookmarksPerDay: 2,
      maxFollowsPerDay: follows,
      maxSearchesPerSession: searches,
      maxDetailsPerSession: details
    }
  }
}

function pickQueries(theme: ThemePlan, count: number): string[] {
  const keywords = [...theme.keywords].sort((left, right) => right.length - left.length)
  const queryPool = new Set<string>()

  for (const keyword of keywords) {
    queryPool.add(keyword)
    queryPool.add(`${keyword} latest`)
    queryPool.add(`${keyword} news`)
    queryPool.add(`${keyword} analysis`)
  }

  return [...queryPool].slice(0, Math.max(1, count))
}

function jitter(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
}

function estimateActionDurationMs(action: ActionPlan): number {
  switch (action.type) {
    case "search":
      return 8000
    case "openDetail":
      return 5000
    case "openAuthor":
      return 4500
    case "scrollProfile":
      return action.dwellMs ?? 18000
    case "expandReplies":
      return 3500
    case "like":
    case "bookmark":
    case "follow":
      return 1800
    case "observeHome":
      return action.dwellMs ?? 14000
    case "dwell":
      return action.dwellMs ?? 24000
    default:
      return 4000
  }
}

export function buildSessionPlan(settings: UserSettings): SessionPlan {
  const profile = toStrategyProfile(settings)
  const draftActions: ActionPlan[] = []
  const orderedThemes = [...settings.themes].sort((left, right) => right.weight - left.weight)
  const targetDurationMs = jitter(settings.sessionDurationMinSec * 1000, settings.sessionDurationMaxSec * 1000)

  for (const theme of orderedThemes) {
    for (const query of pickQueries(theme, profile.limits.maxSearchesPerSession)) {
      draftActions.push({ type: "search", theme: theme.name, query, queryLabel: query, retries: 1 })
      draftActions.push({ type: "openDetail", theme: theme.name, maxItems: profile.limits.maxDetailsPerSession, retries: 2 })
      draftActions.push({ type: "dwell", theme: theme.name, dwellMs: jitter(18000, 42000) })
      draftActions.push({ type: "openAuthor", theme: theme.name, maxItems: 2, retries: 2 })
      draftActions.push({ type: "scrollProfile", theme: theme.name, dwellMs: jitter(12000, 26000) })

      if (Math.random() > 0.25) {
        draftActions.push({ type: "expandReplies", theme: theme.name, probability: 0.55 })
        draftActions.push({ type: "dwell", theme: theme.name, dwellMs: jitter(8000, 18000) })
      }

      if (profile.actionMix.like > 0) {
        draftActions.push({ type: "like", theme: theme.name, probability: settings.riskLevel === "conservative" ? 0.18 : 0.38 })
      }

      if (profile.actionMix.bookmark > 0) {
        draftActions.push({ type: "bookmark", theme: theme.name, probability: 0.24 })
      }

      if (profile.actionMix.follow > 0) {
        draftActions.push({ type: "follow", theme: theme.name, probability: settings.riskLevel === "aggressive" ? 0.2 : 0.08 })
      }

      draftActions.push({ type: "observeHome", theme: theme.name, dwellMs: jitter(10000, 22000) })
    }
  }

  const actions: ActionPlan[] = []
  let totalEstimatedMs = 0

  for (const action of draftActions) {
    if (totalEstimatedMs >= targetDurationMs && actions.length > 0) break
    actions.push(action)
    totalEstimatedMs += estimateActionDurationMs(action)
  }

  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    targetThemes: settings.themes.map((theme) => theme.name),
    actions
  }
}
