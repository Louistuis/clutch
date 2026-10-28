export type RouterMode = 'off' | 'auto' | 'effort'

export type Route = {
  /** expected difficulty, 0 (trivial) to 4 (very hard); -1 when Jev did not answer */
  score: number
  level: number
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** set only by /auto */
  model?: string
}

declare module 'claude-code' {
  interface PluginState {
    clutch: { last: Route | null; mode: RouterMode; brief: string }
  }
}
