export const STORAGE_KEYS = {
  settings: "settings",
  session: "session",
  stats: "stats"
} as const

export const DEFAULT_THEMES = ["AI", "科技", "科学", "政治", "财经", "艺术"]

export const SELECTORS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  tweet: 'article[data-testid="tweet"]',
  searchInput: 'input[data-testid="SearchBox_Search_Input"]',
  searchTimeline: '[aria-label="Search timeline"]',
  userCell: '[data-testid="UserCell"]'
} as const
