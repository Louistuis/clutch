export type RouterMode = 'off' | 'auto' | 'effort'

export type RouterMode = 'off' | 'auto' | 'effort'

/** The model that rates each prompt: Jev on OpenRouter, a llama.cpp /v1/systemone endpoint, or a chat model */
export type Judge =
  | { kind: 'jev' }
  | { kind: 'local'; url: string }
  | { kind: 'chat'; url: string; model: string }

export type Route = {
  /** expected difficulty, 0 (trivial) to 4 (very hard); -1 when the judge did not answer */
  score: number
  level: number
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** set only by /clutch */
  model?: string
}

declare module 'claude-code' {
  interface PluginState {
    clutch: { last: Route | null; mode: RouterMode; brief: string }
  }
}
