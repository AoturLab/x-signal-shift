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

  for (const tweet of tweets) {
    const text = tweet.innerText.toLowerCase()

    for (const theme of themes) {
      if (theme.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
        themeMatches[theme.name] += 1
      }
    }

    const handle = tweet.querySelector<HTMLAnchorElement>('a[href^="/"][role="link"]')?.getAttribute("href")
    if (handle) authors.add(handle)
  }

  return {
    totalTweets: tweets.length,
    themeMatches,
    authorHandles: [...authors]
  }
}

export function buildSearchUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`
}

export function getTweetArticles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.tweet))
}
