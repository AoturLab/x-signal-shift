import { SELECTORS } from "@shared/constants"
import type { FeedSnapshot, PageKind, ThemePlan } from "@shared/types"

export function detectPageKind(url = window.location.href): PageKind {
  const path = new URL(url).pathname
  if (path === "/home") return "home"
  if (path.startsWith("/search")) return "search"
  if (/\/status\/\d+/.test(path)) return "tweetDetail"
  if (path.split("/").filter(Boolean).length === 1) return "profile"
  return "unknown"
}

export function collectFeedSnapshot(themes: ThemePlan[]): FeedSnapshot {
  const tweets = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.tweet))
  const themeMatches = Object.fromEntries(themes.map((theme) => [theme.name, 0]))
  const authors = new Set<string>()
  let candidateQualityScore = 0

  for (const tweet of tweets) {
    const text = tweet.innerText.toLowerCase()
    const hasMedia = Boolean(tweet.querySelector('[data-testid="tweetPhoto"], video'))
    const lengthScore = Math.min(text.length / 180, 1)

    for (const theme of themes) {
      if (theme.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
        themeMatches[theme.name] += 1
        candidateQualityScore += 1 + lengthScore + (hasMedia ? 0.5 : 0)
      }
    }

    const handle = tweet.querySelector<HTMLAnchorElement>('a[href^="/"][role="link"]')?.getAttribute("href")
    if (handle) authors.add(handle)
  }

  return {
    totalTweets: tweets.length,
    themeMatches,
    authorHandles: [...authors],
    candidateQualityScore: tweets.length === 0 ? 0 : Number((candidateQualityScore / tweets.length).toFixed(2))
  }
}

export function buildSearchUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`
}

export function getTweetArticles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.tweet))
}
