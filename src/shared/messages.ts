import type { RuntimeMessageMap } from "./types"

export type RuntimeMessageType = keyof RuntimeMessageMap

export interface RuntimeEnvelope<T extends RuntimeMessageType = RuntimeMessageType> {
  type: T
  payload: RuntimeMessageMap[T]
}

export function sendRuntimeMessage<T extends RuntimeMessageType>(
  type: T,
  payload: RuntimeMessageMap[T]
): Promise<unknown> {
  return chrome.runtime.sendMessage({ type, payload } satisfies RuntimeEnvelope<T>)
}
