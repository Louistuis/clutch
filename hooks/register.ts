import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Route, RouterMode } from '../types'

// Clutch. /auto: Jev picks the model and effort for every prompt. /auto-effort: Jev picks only the effort.
// /auto off stops either. Jev 1.14 on OpenRouter: ~0.3 s, ~$0.00004 a prompt.
// After each main turn Haiku (medium effort) compresses the newest conversation into a short routing
// brief, so Jev judges a prompt knowing what the session is in the middle of.
const URL = 'https://openrouter.ai/api/alpha/decisions'
const JEV = 'typesafe/jev-1.14'
// The key: $OPENROUTER_API_KEY, else the first line of ~/.config/openrouter.key
const KEY_FILE = '.config/openrouter.key'
// Past this, or on any error, the turn keeps the session's own model and effort
const TIMEOUT_MS = 2500

const BRIEF_MODEL = 'haiku'
// The newest conversation that goes to Haiku, in characters (~15k tokens), newest kept first
const BRIEF_WINDOW = 60000
// A prompt sent while the brief is still being written waits this long for it, then uses the previous one
const BRIEF_WAIT_MS = 4000
const BRIEF_SYSTEM = `You write routing briefs for Clutch, a router that picks how much model power the NEXT user message in a coding session needs.
A small decision model reads your brief, then the assistant's last words and the user's next message, and rates the job from trivial to very hard.
It cannot see the conversation, so the brief is all it knows about the session.

Write at most 110 words, plain text, exactly these lines:
TASK: what the user is working on overall, concretely
STAGE: chatting, exploring, planning, building, debugging, reviewing, shipping or wrapping up; plus how far along
SCOPE: the repos, files, services or systems in play, and how many
STATE: what just happened: done, failing, waiting on the user, or an offer the assistant made and how big that offer is
OPEN: unresolved problems, errors or decisions, or "none"
WEIGHT: what makes the work in progress hard or easy (unknown cause, many systems, production, risk, a quick tweak, small talk)

Describe only what has happened. Never guess what the user will ask next: their next message may be a big request or just thanks.
Newer events outrank older ones. Name things exactly (file names, error names). Ignore slash commands and their output. No advice, no preamble.`

const STATUS_NAME = 'Clutch'
const LEVELS = [
  'trivial: chat or a quick fact',
  'simple: one small edit or command',
  'moderate: a few steps or files',
  'hard: debugging, design or several systems',
  'very hard: large, ambiguous, high-stakes work',
]
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5-5']
const EFFORTS = ['low', 'medium', 'high', 'high', 'max'] as const

const last = atom({ plugin: 'clutch', key: 'last' } as const, null)
const modeAtom = atom({ plugin: 'clutch', key: 'mode' } as const, 'off')
const briefAtom = atom({ plugin: 'clutch', key: 'brief' } as const, '')

const short = (model: string) => model.replace('claude-', '').replace(/-\d.*$/, '')

function describe(mode: RouterMode, r: Route | null): string | undefined {
  if (mode === 'off') return undefined
  const name = mode === 'auto' ? STATUS_NAME : `${STATUS_NAME} effort`
  if (!r) return `${name} engaged`
  if (r.score < 0) return `${name}: Jev unreachable, session settings`
  return `${name} → ${r.model ? short(r.model) + ' · ' : ''}${r.effort} · ${r.score.toFixed(1)}/4${brief ? ' · ctx' : ''}`
}

async function keyPath($: EngineInterface): Promise<string | null> {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return home ? `${home}/${KEY_FILE}` : null
}

async function findKey($: EngineInterface): Promise<{ key: string; from: string } | null> {
  const fromEnv = (await $.env.get('OPENROUTER_API_KEY'))?.trim()
  if (fromEnv) return { key: fromEnv, from: '$OPENROUTER_API_KEY' }
  const path = await keyPath($)
  if (!path) return null
  const key = (await $.fs.read(path).catch(() => '')).trim()
  return key ? { key, from: `~/${KEY_FILE}` } : null
}

async function readKey($: EngineInterface): Promise<string | null> {
  return (await findKey($))?.key ?? null
}

const SETUP = [
  'Clutch needs an OpenRouter key (it costs about $0.00004 a prompt, so $1 lasts a long time):',
  '  1. Go to https://openrouter.ai/keys, sign in, and click "Create key".',
  '  2. Add a little credit at https://openrouter.ai/settings/credits ($1 to $5 is plenty).',
  '  3. Copy the key, then type /auto key here. Clutch saves it from your clipboard; it never shows it in the chat.',
  '  4. Type /auto to start.',
].join('\n')

// The clipboard on macOS, Windows or Linux, whichever answers first
async function clipboard($: EngineInterface): Promise<string> {
  const tries = [['pbpaste'], ['powershell', '-NoProfile', '-Command', 'Get-Clipboard'], ['wl-paste', '-n'], ['xclip', '-o', '-selection', 'clipboard']]
  for (const argv of tries) {
    const r = await $.process.run(argv, { timeoutMs: 5000 }).catch(() => null)
    if (r && r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim()
  }
  return ''
}

// GET /api/v1/key answers 200 for a working key, with its spend and limit
async function checkKey($: EngineInterface, key: string): Promise<string> {
  const res = await $.http.fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } }).catch(() => null)
  if (!res) return 'could not reach OpenRouter to check it'
  if (res.status === 401) return 'OpenRouter does not accept it (401): copy the whole key again'
  if (!res.ok) return `OpenRouter answered ${res.status}`
  const d = JSON.parse(res.text).data ?? {}
  return d.limit_remaining != null ? `works, $${Number(d.limit_remaining).toFixed(2)} left on its limit` : 'works'
}

async function saveKey($: EngineInterface): Promise<string> {
  const key = await clipboard($)
  if (!/^sk-or-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return 'Your clipboard does not hold an OpenRouter key (they start with "sk-or-"). Copy the key from https://openrouter.ai/keys, then type /auto key again.'
  }
  const path = await keyPath($)
  if (!path) return 'Could not find your home folder to save the key in. Set OPENROUTER_API_KEY instead (see the README).'
  await $.fs.write(path, key + '\n')
  // Owner-only, where the system has chmod (Windows keeps the folder's own permissions)
  await $.process.run(['chmod', '600', path]).catch(() => null)
  return `Key saved to ~/${KEY_FILE} (${await checkKey($, key)}). Type /auto to start Clutch.`
}

async function status($: EngineInterface): Promise<string> {
  const mode = (await $.state.get({ plugin: 'clutch', key: 'mode' })).value ?? 'off'
  const found = await findKey($)
  const lines = [`Clutch is ${mode === 'auto' ? 'on (/auto: model and effort)' : mode === 'effort' ? 'on (/auto-effort: effort only)' : 'off'}.`]
  lines.push(found ? `Key: from ${found.from}, ${await checkKey($, found.key)}.` : 'Key: none yet.\n' + SETUP)
  lines.push(brief ? `Session brief: ready (${brief.split(/\s+/).length} words).` : 'Session brief: none yet (written after your first reply).')
  const r = (await $.state.get({ plugin: 'clutch', key: 'last' })).value as Route | null
  if (r && r.score >= 0) lines.push(`Last pick: ${r.model ? short(r.model) + ', ' : ''}${r.effort} effort (score ${r.score.toFixed(2)} of 4).`)
  return lines.join('\n')
}

const HELP = [
  'Clutch picks the model and effort for each prompt you send.',
  '  /auto          turn it on (picks model and effort)',
  '  /auto-effort   turn it on, but keep your model (picks effort only)',
  '  /auto off      turn it off',
  '  /auto key      save the OpenRouter key on your clipboard',
  '  /auto status   check the key, the mode and the last pick',
].join('\n')

// One handler for both commands: on/off, plus the setup words
async function runCommand($: EngineInterface, args: string, on: RouterMode): Promise<string> {
  const word = args.trim().toLowerCase()
  if (word === 'off') { await setMode($, 'off'); return 'Clutch off.' }
  if (word === 'key') return saveKey($)
  if (word === 'status') return status($)
  if (word === 'help' || word === '?') return HELP
  if (word) return `Unknown option "${word}".\n${HELP}`
  if (!(await readKey($))) return SETUP
  await setMode($, on)
  return on === 'auto'
    ? 'Clutch engaged: Jev picks the model and effort for every prompt, with a Haiku brief of the session. /auto off disengages.'
    : 'Clutch effort engaged: Jev picks the effort for every prompt, your model stays. /auto off disengages.'
}

async function classify($: EngineInterface, text: string, mode: RouterMode): Promise<Route | null> {
  const key = await readKey($)
  if (!key) return null
  // One transcript, so "yes, do it" after a big plan reads as the plan's size (a separate field was ignored)
  const before = (await $.session.messages()).filter(m => m.role === 'assistant' && m.text).at(-1)?.text ?? ''
  const debug = await $.env.get('CLUTCH_DEBUG')
  // The brief is background; the job is still whatever the last message asks for
  const state = (brief ? `Background on the session (it does not set the job size; the user's last message does):\n${brief}\n\n` : '')
    + (before ? `Assistant: ${before.slice(-1500)}\n\n` : '') + `User: ${text.slice(0, 8000)}`
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
  // CLUTCH_DEBUG=<file>: append what Jev saw and said, for testing the router
  if (debug) await $.fs.write(debug, ((await $.fs.read(debug).catch(() => '')) + `\n=== score ${score.toFixed(2)}\n${state}\n`))
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

// The latest routing brief and the call writing the next one
let brief = ''
let briefing: Promise<void> | null = null

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t)

function toolLine(u: { tool: string; input: Record<string, unknown>; isError?: true }): string {
  const i = u.input
  const what = i.file_path ?? i.path ?? i.command ?? i.pattern ?? i.url ?? i.description ?? i.query ?? ''
  return `[${u.tool}${what ? ' ' + clip(String(what).replace(/\s+/g, ' '), 120) : ''}${u.isError ? ' FAILED' : ''}]`
}

// Newest messages first until the window is full, then back into reading order
function transcript(messages: { role: string; text: string; toolUses: { tool: string; input: Record<string, unknown>; isError?: true }[] }[]): string {
  const parts: string[] = []
  let size = 0
  for (const m of [...messages].reverse()) {
    if (/^\s*<(command-|local-command)/.test(m.text)) continue
    const tools = m.role === 'assistant' ? m.toolUses.map(toolLine).join(' ') : ''
    const body = [clip(m.text.trim(), 6000), tools].filter(Boolean).join('\n')
    if (!body) continue
    const line = `${m.role === 'user' ? 'User' : 'Assistant'}: ${body}`
    if (size + line.length > BRIEF_WINDOW) break
    parts.push(line)
    size += line.length
  }
  return parts.reverse().join('\n\n')
}

async function writeBrief($: EngineInterface) {
  const messages = await $.session.messages()
  if (!Array.isArray(messages) || !messages.length) return
  const recent = transcript(messages)
  if (!recent) return
  const r = await $.model.complete({
    model: BRIEF_MODEL,
    effort: 'medium',
    maxTokens: 400,
    timeoutMs: 30000,
    system: BRIEF_SYSTEM,
    prompt: (brief ? `Previous brief (older context, may be stale):\n${brief}\n\n` : '') + `Newest conversation:\n${recent}`,
  })
  if (r.isAnswered && r.text.trim()) {
    brief = r.text.trim().slice(0, 1200)
    await update($, briefAtom, () => brief)
  }
}

async function setMode($: EngineInterface, mode: RouterMode) {
  await update($, modeAtom, () => mode)
  await $.store.set('mode', mode)
  pending = null
  routes.clear()
  $.ui.status(describe(mode, null))
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'auto', description: 'Clutch: pick the model and effort for every prompt (/auto off, /auto key, /auto status, /auto help)' })
    await $.command.register({ name: 'auto-effort', description: 'Clutch: Jev picks only the effort, your model stays (/auto off to stop)' })
    const saved = (await $.store.get('mode')) as RouterMode | undefined
    if (saved) await update($, modeAtom, () => saved)
    $.ui.status(describe(saved ?? 'off', null))
    // First run: one line pointing at the setup, never again once a key exists
    if (!saved && !(await $.store.get('welcomed')) && !(await readKey($))) {
      $.ui.toast('Clutch is installed. Type /auto help to set it up.')
      await $.store.set('welcomed', true)
    }
    return next(e)
  })

  // Always on, never a toggle: the mode is shared by every session, so a toggle could switch it off unseen
  on('command.run', { command: 'auto' }, async ($, e) => ({ text: await runCommand($, e.args, 'auto') }))
  on('command.run', { command: 'auto-effort' }, async ($, e) => ({ text: await runCommand($, e.args, 'effort') }))

  on('prompt.submit', async ($, e, next) => {
    const mode = (await $.state.get({ plugin: 'clutch', key: 'mode' })).value ?? 'off'
    // sdk: the desktop app's Code tab sends typed prompts through the SDK
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk'
    if (mode === 'off' || e.command || e.isMeta || !isPerson || !e.text.trim()) return next(e)

    if (briefing) await Promise.race([briefing, $.clock.sleep(BRIEF_WAIT_MS)])
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

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    routes.delete(e.turnId)
    const mode = (await $.state.get({ plugin: 'clutch', key: 'mode' })).value ?? 'off'
    // Not awaited: the brief is written while the user reads the reply, ready for their next prompt
    if (mode !== 'off') {
      const run: Promise<void> = writeBrief($).catch(() => {}).finally(() => { if (briefing === run) briefing = null })
      briefing = run
    }
    return next(e)
  })
}
