import type { LanguagePreference, ThemePlan } from "@shared/types"

function normalizeLanguages(preference: LanguagePreference): Array<"zh" | "en"> {
  if (preference === "bilingual") return ["zh", "en"]
  return [preference]
}

const themeDictionary: Record<string, string[]> = {
  AI: ["ai", "artificial intelligence", "llm", "machine learning", "人工智能", "openai", "anthropic", "deep learning"],
  科技: ["tech", "technology", "engineering", "科技", "软件", "product launch", "developer tools", "chip"],
  科学: ["science", "research", "biology", "physics", "科研", "科学", "peer review", "journal", "study"],
  政治: ["politics", "policy", "election", "外交", "政治", "public policy", "geopolitics", "government"],
  财经: ["finance", "economy", "markets", "投资", "宏观", "stocks", "macro", "interest rate"],
  艺术: ["art", "design", "museum", "艺术", "视觉", "creative direction", "illustration", "gallery"]
}

export function buildThemePlan(
  themeName: string,
  weight: number,
  languagePreference: LanguagePreference,
  customKeywords: string[] = []
): ThemePlan {
  const keywords = Array.from(
    new Set([...(themeDictionary[themeName] ?? [themeName]), ...customKeywords.map((item) => item.trim())].filter(Boolean))
  )

  return {
    name: themeName,
    weight,
    languages: normalizeLanguages(languagePreference),
    keywords,
    exclusions: []
  }
}

export function buildCustomThemePlan(
  customKeywords: string[],
  languagePreference: LanguagePreference
): ThemePlan | null {
  const keywords = Array.from(new Set(customKeywords.map((item) => item.trim()).filter(Boolean)))
  if (keywords.length === 0) return null

  return {
    name: "自定义",
    weight: 1,
    languages: normalizeLanguages(languagePreference),
    keywords,
    exclusions: []
  }
}
