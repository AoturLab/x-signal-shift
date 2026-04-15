import type { ActionPlan, ThemePlan } from "@shared/types"
import { SELECTORS } from "@shared/constants"
import { buildSearchUrl, getTweetArticles } from "./page-adapters"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function maybe(probability = 1): boolean {
  return Math.random() <= probability
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function scoreTextForTheme(text: string, theme?: ThemePlan): number {
  if (!theme) return 0
  const lower = text.toLowerCase()
  return theme.keywords.reduce((score, keyword) => score + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0)
}

function selectBestArticle(theme?: ThemePlan): HTMLElement | null {
  const articles = getTweetArticles()
  const ranked = articles
    .map((article) => ({
      article,
      score: scoreTextForTheme(article.innerText, theme)
    }))
    .filter((entry) => entry.article.querySelector('a[href*="/status/"]'))
    .sort((left, right) => right.score - left.score)

  return ranked[0]?.article ?? articles[0] ?? null
}

export async function executeAction(action: ActionPlan, themes: ThemePlan[]): Promise<void> {
  const theme = themes.find((item) => item.name === action.theme)

  switch (action.type) {
    case "search":
      if (!action.query) return
      window.location.href = buildSearchUrl(action.query)
      await sleep(2500)
      return
    case "openDetail": {
      const target = selectBestArticle(theme)
      const detailLink = target?.querySelector<HTMLAnchorElement>('a[href*="/status/"]')
      detailLink?.click()
      await sleep(2200)
      return
    }
    case "dwell":
      await sleep(action.dwellMs ?? randomBetween(9000, 16000))
      return
    case "expandReplies": {
      const buttons = Array.from(document.querySelectorAll<HTMLDivElement>('[role="button"]'))
      const candidate = buttons.find((button) => /reply|more replies|show/i.test(button.innerText))
      candidate?.click()
      await sleep(1500)
      return
    }
    case "openAuthor": {
      const target = selectBestArticle(theme)
      const profileLink = target?.querySelector<HTMLAnchorElement>('a[role="link"][href^="/"]:not([href*="/status/"])')
      profileLink?.click()
      await sleep(2000)
      return
    }
    case "scrollProfile":
      window.scrollBy({ top: randomBetween(600, 1400), behavior: "smooth" })
      await sleep(action.dwellMs ?? randomBetween(7000, 12000))
      return
    case "like": {
      if (!maybe(action.probability)) return
      const likeButton = document.querySelector<HTMLElement>('[data-testid="like"]')
      likeButton?.click()
      await sleep(1200)
      return
    }
    case "bookmark": {
      if (!maybe(action.probability)) return
      const bookmarkButton = document.querySelector<HTMLElement>('[data-testid="bookmark"]')
      bookmarkButton?.click()
      await sleep(1200)
      return
    }
    case "follow": {
      if (!maybe(action.probability)) return
      const button = Array.from(document.querySelectorAll<HTMLElement>('[role="button"]')).find((item) =>
        /follow/i.test(item.innerText)
      )
      button?.click()
      await sleep(1400)
      return
    }
    case "observeHome":
      if (!window.location.pathname.startsWith("/home")) {
        window.location.href = "https://x.com/home"
        await sleep(2500)
      }
      window.scrollBy({ top: 900, behavior: "smooth" })
      await sleep(action.dwellMs ?? 9000)
      return
    default:
      return
  }
}

export async function waitForPageReady(timeoutMs = 10000): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const ready =
      document.querySelector(SELECTORS.primaryColumn) ||
      document.querySelector(SELECTORS.searchTimeline) ||
      document.querySelector(SELECTORS.searchInput)

    if (ready) return
    await sleep(300)
  }
}
