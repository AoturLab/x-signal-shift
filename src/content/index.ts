import { collectFeedSnapshot } from "./page-adapters"
import { executeAction, waitForPageReady } from "./actions"
import type { RuntimeEnvelope } from "@shared/messages"
import type { SessionPlan, UserSettings } from "@shared/types"
import { defaultSettings, getSettings } from "@shared/storage"

let activePlanId: string | null = null
let aborted = false

function delayBetweenActions(): Promise<void> {
  const ms = Math.floor(Math.random() * 2200) + 900
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function runPlan(plan: SessionPlan, settings: UserSettings): Promise<void> {
  activePlanId = plan.id
  aborted = false

  try {
    await waitForPageReady()

    for (const action of plan.actions) {
      if (aborted || activePlanId !== plan.id) break
      await executeAction(action, settings.themes)
      await delayBetweenActions()
    }

    const summary = collectFeedSnapshot(settings.themes)
    await chrome.runtime.sendMessage({
      type: "PLAN_FINISHED",
      payload: { summary }
    } satisfies RuntimeEnvelope<"PLAN_FINISHED">)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown content execution failure"
    await chrome.runtime.sendMessage({
      type: "PLAN_FAILED",
      payload: { error: message }
    } satisfies RuntimeEnvelope<"PLAN_FAILED">)
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeEnvelope) => {
  void (async () => {
    const settings = (await getSettings().catch(() => defaultSettings)) ?? defaultSettings

    switch (message.type) {
      case "RUN_PLAN":
        await runPlan(message.payload as SessionPlan, settings)
        break
      case "STOP_AUTOMATION":
        aborted = true
        activePlanId = null
        break
      default:
        break
    }
  })()
})
