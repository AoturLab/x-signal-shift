import type { ActionPlan, SessionPlan, StrategyProfile, ThemePlan, UserSettings } from "@shared/types"

function toStrategyProfile(settings: UserSettings): StrategyProfile {
  const likes = settings.riskLevel === "aggressive" ? 5 : settings.riskLevel === "standard" ? 3 : 1
  const follows = settings.riskLevel === "aggressive" ? 2 : settings.riskLevel === "standard" ? 1 : 0

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
      maxSearchesPerSession: 2,
      maxDetailsPerSession: 4
    }
  }
}

function pickQueries(theme: ThemePlan, count: number): string[] {
  return [...theme.keywords]
    .sort((left, right) => right.length - left.length)
    .slice(0, Math.max(1, count))
}

function jitter(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
}

export function buildSessionPlan(settings: UserSettings): SessionPlan {
  const profile = toStrategyProfile(settings)
  const actions: ActionPlan[] = []
  const orderedThemes = [...settings.themes].sort((left, right) => right.weight - left.weight)

  for (const theme of orderedThemes) {
    for (const query of pickQueries(theme, profile.limits.maxSearchesPerSession)) {
      actions.push({ type: "search", theme: theme.name, query, retries: 1 })
      actions.push({ type: "openDetail", theme: theme.name, maxItems: 3, retries: 1 })
      actions.push({ type: "dwell", theme: theme.name, dwellMs: jitter(12000, 24000) })
      actions.push({ type: "openAuthor", theme: theme.name, maxItems: 1, retries: 1 })
      actions.push({ type: "scrollProfile", theme: theme.name, dwellMs: jitter(8000, 14000) })

      if (Math.random() > 0.4) {
        actions.push({ type: "expandReplies", theme: theme.name, probability: 0.45 })
      }

      if (profile.actionMix.like > 0) {
        actions.push({ type: "like", theme: theme.name, probability: settings.riskLevel === "conservative" ? 0.15 : 0.35 })
      }

      if (profile.actionMix.bookmark > 0) {
        actions.push({ type: "bookmark", theme: theme.name, probability: 0.2 })
      }

      if (profile.actionMix.follow > 0) {
        actions.push({ type: "follow", theme: theme.name, probability: settings.riskLevel === "aggressive" ? 0.2 : 0.08 })
      }
    }
  }

  actions.push({ type: "observeHome", theme: orderedThemes[0]?.name ?? "general", dwellMs: jitter(7000, 14000) })

  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    targetThemes: settings.themes.map((theme) => theme.name),
    actions
  }
}
