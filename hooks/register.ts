import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Route, RouterMode } from '../types'

// /auto: Jev picks the model and effort for every prompt. /auto-effort: Jev picks only the effort.
// /auto off stops either. Jev 1.14 on OpenRouter: ~0.3 s, ~$0.00004 a prompt.
const URL = 'https://openrouter.ai/api/alpha/decisions'
const JEV = 'typesafe/jev-1.14'
// The key: $OPENROUTER_API_KEY, else the first line of ~/.config/openrouter.key
const KEY_FILE = '.config/openrouter.key'
// Past this, or on any error, the turn keeps the session's own model and effort
const TIMEOUT_MS = 2500

const LEVELS = [
  'trivial: chat or a quick fact',
  'simple: one small edit or command',
  'moderate: a few steps or files',
  'hard: debugging, design or several systems',
  'very hard: large, ambiguous, high-stakes work',
]
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5-5']
const EFFORTS = ['low', 'medium', 'high', 'high', 'max'] as const

const last = atom({ plugin: 'auto-router', key: 'last' } as const, null)
const modeAtom = atom({ plugin: 'auto-router', key: 'mode' } as const, 'off')

const short = (model: string) => model.replace('claude-', '').replace(/-\d.*$/, '')

function describe(mode: RouterMode, r: Route | null): string | undefined {
  if (mode === 'off') return undefined
  const name = mode === 'auto' ? '/auto' : '/auto-effort'
  if (!r) return `${name} on`
  if (r.score < 0) return `${name}: Jev unreachable, session settings`
  return `${name} → ${r.model ? short(r.model) + ' · ' : ''}${r.effort} · ${r.score.toFixed(1)}/4`
}

async function readKey($: EngineInterface): Promise<string | null> {
  const fromEnv = (await $.env.get('OPENROUTER_API_KEY'))?.trim()
  if (fromEnv) return fromEnv
  const home = await $.env.get('HOME')
  if (!home) return null
  return (await $.fs.read(`${home}/${KEY_FILE}`).catch(() => '')).trim() || null
}

async function classify($: EngineInterface, text: string, mode: RouterMode): Promise<Route | null> {
  const key = await readKey($)
  if (!key) return null
  // One transcript, so "yes, do it" after a big plan reads as the plan's size (a separate field was ignored)
  const before = (await $.session.messages()).filter(m => m.role === 'assistant' && m.text).at(-1)?.text ?? ''
  const state = (before ? `Assistant: ${before.slice(-1500)}\n\n` : '') + `User: ${text.slice(0, 8000)}`
  const body = JSON.stringify({
    model: JEV,
    state,
    questions: {
      difficulty: {
        type: 'score',
        instructions: "How much work is the job the user's last message asks for (including anything it agrees to)?",
        criteria: LEVELS,
      },
    },
  })
  const answer = $.http.fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body })
  const res = await Promise.race([answer, $.clock.sleep(TIMEOUT_MS).then(() => null)])
  if (!res || !res.ok) return null

  const score: number = JSON.parse(res.text).answers.difficulty.score
  const level = Math.max(0, Math.min(4, Math.round(score)))
  return {
    score,
    level,
    effort: EFFORTS[level] ?? 'high',
    model: mode === 'auto' ? MODELS[level] : undefined,
  }
}

// The route a prompt was given, until its turn starts; then each main turn's route by turn id
let pending: Route | null = null
const routes = new Map<string, Route>()

async function setMode($: EngineInterface, mode: RouterMode) {
  await update($, modeAtom, () => mode)
  await $.store.set('mode', mode)
  pending = null
  routes.clear()
  $.ui.status(describe(mode, null))
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'auto', description: 'Auto-router on: Jev picks the model and effort for every prompt (/auto off to stop)' })
    await $.command.register({ name: 'auto-effort', description: 'Auto-router on: Jev picks only the effort, your model stays (/auto off to stop)' })
    const saved = (await $.store.get('mode')) as RouterMode | undefined
    if (saved) await update($, modeAtom, () => saved)
    $.ui.status(describe(saved ?? 'off', null))
    return next(e)
  })

  on('command.run', { command: 'auto' }, async ($, e) => {
    // Always on, never a toggle: the mode is shared by every session, so a toggle could switch it off unseen
    const mode: RouterMode = e.args.trim() === 'off' ? 'off' : 'auto'
    await setMode($, mode)
    return { text: mode === 'auto' ? 'Auto-router on: Jev picks the model and effort for every prompt. /auto off stops it.' : 'Auto-router off.' }
  })

  on('command.run', { command: 'auto-effort' }, async ($, e) => {
    const mode: RouterMode = e.args.trim() === 'off' ? 'off' : 'effort'
    await setMode($, mode)
    return { text: mode === 'effort' ? 'Auto-effort on: Jev picks the effort for every prompt, your model stays. /auto off stops it.' : 'Auto-router off.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const mode = (await $.state.get({ plugin: 'auto-router', key: 'mode' })).value ?? 'off'
    // sdk: the desktop app's Code tab sends typed prompts through the SDK
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk'
    if (mode === 'off' || e.command || e.isMeta || !isPerson || !e.text.trim()) return next(e)

    const route = await classify($, e.text, mode).catch(() => null)
    await update($, last, () => route)
    $.ui.status(describe(mode, route ?? { score: -1, level: -1, effort: 'high' }))
    if (route) {
      // Typed into a running turn: its next requests take the new route
      if (e.turnId) routes.set(e.turnId, route)
      else pending = route
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a router that breaks never holds a prompt back

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined && pending) {
      routes.set(e.turnId, pending)
      pending = null
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // Main-loop requests only: subagents keep the model and effort they were given
    const route = e.agentId === undefined ? routes.get(e.turnId) : undefined
    if (!route) return yield* next(e)
    return yield* next({ ...e, effort: route.effort, ...(route.model ? { model: route.model } : {}) })
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) routes.delete(e.turnId)
    return next(e)
  })
}
