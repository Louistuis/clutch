import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Judge, Route, RouterMode } from '../types'

// Clutch. /auto: a judge model picks the model and effort for every prompt. /auto-effort: only the effort.
// /auto off stops either. The judge is Jev 1.14 on OpenRouter (~0.3 s, ~$0.00004 a prompt) unless
// /auto judge points it at a local model: a llama.cpp decision endpoint, or any chat model (Ollama, LM Studio).
// Every few turns Haiku (medium effort) compresses the newest conversation into a short routing brief
// in the background, so the judge rates a prompt knowing what the session is in the middle of.
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
const JEV = 'typesafe/jev-1.14'
// The OpenRouter key: $OPENROUTER_API_KEY, else the first line of ~/.config/openrouter.key
const KEY_FILE = '.config/openrouter.key'
// A local judge's key, if its server wants one: $CLUTCH_JUDGE_KEY, else ~/.config/clutch-judge.key
const JUDGE_KEY_FILE = '.config/clutch-judge.key'
// How long a judge may take before the turn keeps the session's own model and effort. The hook that
// waits has a 10 s budget, shared with BRIEF_WAIT_MS, so a slow local model gets 6 s at most.
const TIMEOUT_MS: Record<Judge['kind'], number> = { jev: 2500, local: 6000, chat: 6000 }
const DEFAULT_URL = {
  local: 'http://127.0.0.1:8080/v1/systemone',
  // Ollama's own chat API: the only one of its APIs that reliably takes think: false
  ollama: 'http://127.0.0.1:11434/api/chat',
  lmstudio: 'http://127.0.0.1:1234/v1/chat/completions',
}

const BRIEF_MODEL = 'haiku'
// The newest conversation that goes to Haiku, in characters (~15k tokens), newest kept first
const BRIEF_WINDOW = 60000
// A new brief once this much conversation is new since the last one, or every BRIEF_EVERY_TURNS turns
const BRIEF_EVERY_CHARS = 2500
const BRIEF_EVERY_TURNS = 4
// A prompt sent while a brief is still being written waits this long for it, then uses the previous one
const BRIEF_WAIT_MS = 2500
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
const QUESTION = "How much work is the job the user's last message asks for (including anything it agrees to)?"
const LEVELS = [
  'trivial: chat or a quick fact',
  'simple: one small edit or command',
  'moderate: a few steps or files',
  'hard: debugging, design or several systems',
  'very hard: large, ambiguous, high-stakes work',
]
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5-5']
const EFFORTS = ['low', 'medium', 'high', 'high', 'max'] as const
// A chat model has no score head, so it answers in words: one number, the same five levels
const CHAT_SYSTEM = `You rate how much work a coding assistant's next job is. Reply with one number from 0 to 4 and nothing else (one decimal allowed).
${LEVELS.map((l, i) => `${i} = ${l}`).join('\n')}`

const last = atom({ plugin: 'clutch', key: 'last' } as const, null)
const modeAtom = atom({ plugin: 'clutch', key: 'mode' } as const, 'off')
const briefAtom = atom({ plugin: 'clutch', key: 'brief' } as const, '')

const short = (model: string) => model.replace('claude-', '').replace(/-\d.*$/, '')
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t)

// Module state: the judge in use, the latest brief and the call writing the next, what the status shows
let judge: Judge = { kind: 'jev' }
let brief = ''
let briefing: Promise<void> | null = null
let briefedChars = 0
let turnsSinceBrief = 0
let shown: { mode: RouterMode; route: Route | null } = { mode: 'off', route: null }

function judgeName(j: Judge): string {
  if (j.kind === 'jev') return 'Jev 1.14 on OpenRouter'
  if (j.kind === 'local') return `local decision model at ${j.url}`
  return `${j.model} at ${j.url}`
}

// The status line: the pick, the judge when it is not Jev, and the brief (✎ while Haiku writes it)
function paint($: EngineInterface) {
  const { mode, route: r } = shown
  if (mode === 'off') return $.ui.status(undefined)
  const name = mode === 'auto' ? STATUS_NAME : `${STATUS_NAME} effort`
  const tail = (judge.kind === 'jev' ? '' : judge.kind === 'local' ? ' · local' : ` · ${judge.model}`)
    + (briefing ? ' · ✎ brief' : brief ? ' · ctx' : '')
  if (!r) return $.ui.status(`${name} engaged${tail}`)
  if (r.score < 0) return $.ui.status(`${name}: judge unreachable, session settings${tail}`)
  $.ui.status(`${name} → ${r.model ? short(r.model) + ' · ' : ''}${r.effort} · ${r.score.toFixed(1)}/4${tail}`)
}

async function home($: EngineInterface): Promise<string | null> {
  return (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || null
}

async function findKey($: EngineInterface): Promise<{ key: string; from: string } | null> {
  const fromEnv = (await $.env.get('OPENROUTER_API_KEY'))?.trim()
  if (fromEnv) return { key: fromEnv, from: '$OPENROUTER_API_KEY' }
  const h = await home($)
  if (!h) return null
  const key = (await $.fs.read(`${h}/${KEY_FILE}`).catch(() => '')).trim()
  return key ? { key, from: `~/${KEY_FILE}` } : null
}

async function judgeKey($: EngineInterface): Promise<string | null> {
  const fromEnv = (await $.env.get('CLUTCH_JUDGE_KEY'))?.trim()
  if (fromEnv) return fromEnv
  const h = await home($)
  return h ? (await $.fs.read(`${h}/${JUDGE_KEY_FILE}`).catch(() => '')).trim() || null : null
}

// Jev needs the OpenRouter key; a local judge needs nothing but its server
async function ready($: EngineInterface): Promise<boolean> {
  return judge.kind !== 'jev' || !!(await findKey($))
}

const SETUP = [
  'Clutch needs an OpenRouter key (it costs about $0.00004 a prompt, so $1 lasts a long time):',
  '  1. Go to https://openrouter.ai/keys, sign in, and click "Create key".',
  '  2. Add a little credit at https://openrouter.ai/settings/credits ($1 to $5 is plenty).',
  '  3. Copy the key, then type /auto key here. Clutch saves it from your clipboard; it never shows it in the chat.',
  '  4. Type /auto to start.',
  'Or skip OpenRouter and use a model on your own computer: /auto judge help.',
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
  if (res.status === 401) return 'OpenRouter does not accept it (401)'
  if (!res.ok) return `OpenRouter answered ${res.status}`
  const d = JSON.parse(res.text).data ?? {}
  return d.limit_remaining != null ? `works, $${Number(d.limit_remaining).toFixed(2)} left on its limit` : 'works'
}

async function writePrivate($: EngineInterface, path: string, text: string) {
  await $.fs.write(path, text)
  // Owner-only, where the system has chmod (Windows keeps the folder's own permissions)
  await $.process.run(['chmod', '600', path]).catch(() => null)
}

async function saveKey($: EngineInterface, forJudge: boolean): Promise<string> {
  const key = await clipboard($)
  const h = await home($)
  if (!h) return 'Could not find your home folder to save the key in. Set the key as an environment variable instead (see the README).'
  if (forJudge) {
    if (!key || /\s/.test(key)) return 'Copy your local server\'s key (one line, no spaces), then type /auto key judge again.'
    await writePrivate($, `${h}/${JUDGE_KEY_FILE}`, key + '\n')
    return `Judge key saved to ~/${JUDGE_KEY_FILE}. /auto judge test checks it.`
  }
  if (!/^sk-or-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return 'Your clipboard does not hold an OpenRouter key (they start with "sk-or-"). Copy the key from https://openrouter.ai/keys, then type /auto key again.'
  }
  // A key OpenRouter refuses is not saved; one it could not check (offline) is
  const check = await checkKey($, key)
  if (check.includes('401')) return `Not saved: ${check}. Make sure you copied the whole key from https://openrouter.ai/keys, then type /auto key again.`
  await writePrivate($, `${h}/${KEY_FILE}`, key + '\n')
  return `Key saved to ~/${KEY_FILE} (${check}). Type /auto to start Clutch.`
}

// --- Judges: each turns the same state into a score from 0 to 4, or null ---

async function post($: EngineInterface, url: string, key: string | null, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  const answer = $.http.fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => null)
  const res = await Promise.race([answer, $.clock.sleep(TIMEOUT_MS[judge.kind]).then(() => null)])
  return res && res.ok ? JSON.parse(res.text) : null
}

// Jev and llama.cpp's /v1/systemone take the same request; only Jev names a model
async function scoreDecision($: EngineInterface, state: string): Promise<number | null> {
  const isJev = judge.kind === 'jev'
  const key = isJev ? (await findKey($))?.key ?? null : await judgeKey($)
  if (isJev && !key) return null
  const url = judge.kind === 'local' ? judge.url : JEV_URL
  const d = await post($, url, key, {
    ...(isJev ? { model: JEV } : {}),
    state,
    questions: { difficulty: { type: 'score', instructions: QUESTION, criteria: LEVELS } },
  })
  const score = d?.answers?.difficulty?.score
  return typeof score === 'number' ? score : null
}

// Any OpenAI-compatible chat endpoint (LM Studio, llama.cpp, vLLM) or Ollama's /api/chat: one number back
async function scoreChat($: EngineInterface, state: string): Promise<number | null> {
  if (judge.kind !== 'chat') return null
  const messages = [{ role: 'system', content: CHAT_SYSTEM }, { role: 'user', content: `${state}\n\n${QUESTION} /no_think` }]
  const ollama = /\/api\/chat$/.test(judge.url)
  // Thinking models would spend the whole budget reasoning: each server's own way to switch it off
  const d = await post($, judge.url, await judgeKey($), ollama
    ? { model: judge.model, messages, stream: false, think: false, options: { temperature: 0, num_predict: 16 } }
    : { model: judge.model, messages, stream: false, temperature: 0, max_tokens: 16, chat_template_kwargs: { enable_thinking: false } })
  const m = (ollama ? d?.message : d?.choices?.[0]?.message) ?? {}
  const text = String(m.content || m.reasoning_content || m.reasoning || m.thinking || '').replace(/<think>[\s\S]*?<\/think>/g, '')
  const n = text.match(/(?:^|[^\d.])([0-4](?:\.\d+)?)(?![\d.])/)
  return n ? Math.max(0, Math.min(4, Number(n[1]))) : null
}

async function score($: EngineInterface, state: string): Promise<number | null> {
  return judge.kind === 'chat' ? scoreChat($, state) : scoreDecision($, state)
}

async function classify($: EngineInterface, text: string, mode: RouterMode): Promise<Route | null> {
  // One transcript, so "yes, do it" after a big plan reads as the plan's size (a separate field was ignored)
  const before = (await $.session.messages()).filter(m => m.role === 'assistant' && m.text).at(-1)?.text ?? ''
  // The brief is background; the job is still whatever the last message asks for
  const state = (brief ? `Background on the session (it does not set the job size; the user's last message does):\n${brief}\n\n` : '')
    + (before ? `Assistant: ${before.slice(-1500)}\n\n` : '') + `User: ${text.slice(0, 8000)}`
  const s = await score($, state)
  // CLUTCH_DEBUG=<file>: append what the judge saw and said, for testing the router
  const debug = await $.env.get('CLUTCH_DEBUG')
  if (debug) await $.fs.write(debug, ((await $.fs.read(debug).catch(() => '')) + `\n=== ${judgeName(judge)}: ${s?.toFixed(2) ?? 'no answer'}\n${state}\n`))
  if (s === null) return null
  const level = Math.max(0, Math.min(4, Math.round(s)))
  return { score: s, level, effort: EFFORTS[level] ?? 'high', model: mode === 'auto' ? MODELS[level] : undefined }
}

// --- /auto judge ---

const JUDGE_HELP = [
  'The judge is the small model that rates each prompt. Pick one:',
  '  /auto judge jev                     Jev 1.14 on OpenRouter (default; fast, needs /auto key)',
  '  /auto judge ollama <model> [url]    a chat model in Ollama, e.g. /auto judge ollama qwen3:4b',
  '  /auto judge lmstudio <model> [url]  a chat model loaded in LM Studio',
  '  /auto judge chat <url> <model>      any OpenAI-compatible /v1/chat/completions server',
  '  /auto judge local [url]             a llama.cpp decision endpoint (/v1/systemone), e.g. H2O-Lightning-4B',
  '  /auto judge test                    rate two sample prompts with the current judge',
  '  /auto judge                         show the current judge',
  'A local server that wants a key: copy it, then /auto key judge (or set CLUTCH_JUDGE_KEY).',
].join('\n')

function chatUrl(u: string): string {
  const base = u.replace(/\/+$/, '')
  if (/\/api\/chat$/.test(base)) return base
  return /\/chat\/completions$/.test(base) ? base : /\/v1$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

function decisionUrl(u: string): string {
  const base = u.replace(/\/+$/, '')
  return /\/v1\/systemone$/.test(base) ? base : `${base}/v1/systemone`
}

async function testJudge($: EngineInterface): Promise<string> {
  const samples: [string, string][] = [['thanks!', 'trivial'], ['our tests pass locally but time out in CI, find out why and fix it', 'hard']]
  const lines: string[] = []
  for (const [text, expect] of samples) {
    const started = await $.clock.now()
    const s = await score($, `User: ${text}`)
    const ms = (await $.clock.now()) - started
    lines.push(s === null
      ? `  "${text}": no answer after ${ms} ms`
      : `  "${text}": ${s.toFixed(2)} of 4 (expected ${expect}), ${ms} ms`)
  }
  const ok = !lines.some(l => l.includes('no answer'))
  return `${judgeName(judge)}:\n${lines.join('\n')}\n${ok ? 'It answers. /auto starts Clutch with it.' : 'It did not answer. Check that the server is running and the model name is right (/auto judge help).'}`
}

async function setJudge($: EngineInterface, j: Judge): Promise<string> {
  judge = j
  await $.store.set('judge', j)
  paint($)
  return `Judge set: ${judgeName(j)}.\n${await testJudge($)}`
}

async function judgeCommand($: EngineInterface, parts: string[]): Promise<string> {
  const [kind = '', a, b] = parts
  const k = kind.toLowerCase()
  switch (k) {
    case '': return `Judge: ${judgeName(judge)}.\n${JUDGE_HELP}`
    case 'help': case '?': return JUDGE_HELP
    case 'test': return testJudge($)
    case 'jev': case 'openrouter': return setJudge($, { kind: 'jev' })
    case 'local': return setJudge($, { kind: 'local', url: decisionUrl(a ?? DEFAULT_URL.local) })
    case 'ollama': case 'lmstudio':
      if (!a) return `Name the model, e.g. /auto judge ${k} qwen3:4b`
      // Ollama on another address keeps its own API
      return setJudge($, { kind: 'chat', model: a, url: k === 'ollama' ? (b ? `${b.replace(/\/+$/, '').replace(/\/api\/chat$/, '')}/api/chat` : DEFAULT_URL.ollama) : chatUrl(b ?? DEFAULT_URL.lmstudio) })
    case 'chat':
      if (!a || !b) return 'Give the server and the model, e.g. /auto judge chat http://127.0.0.1:8000 my-model'
      return setJudge($, { kind: 'chat', url: chatUrl(a), model: b })
    default: return `Unknown judge "${kind}".\n${JUDGE_HELP}`
  }
}

// --- Commands ---

async function status($: EngineInterface): Promise<string> {
  const mode = (await $.state.get({ plugin: 'clutch', key: 'mode' })).value ?? 'off'
  const lines = [`Clutch is ${mode === 'auto' ? 'on (/auto: model and effort)' : mode === 'effort' ? 'on (/auto-effort: effort only)' : 'off'}.`]
  lines.push(`Judge: ${judgeName(judge)}.`)
  if (judge.kind === 'jev') {
    const found = await findKey($)
    lines.push(found ? `Key: from ${found.from}, ${await checkKey($, found.key)}.` : 'Key: none yet.\n' + SETUP)
  }
  lines.push(briefing
    ? 'Session brief: Haiku is writing a fresh one in the background.'
    : brief ? `Session brief: ready (${brief.split(/\s+/).length} words), refreshed in the background every few turns.` : 'Session brief: none yet (written in the background after your first reply).')
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
  '  /auto judge    choose the model that rates prompts: Jev, or one on your computer',
  '  /auto brief    show the session brief Haiku keeps in the background',
  '  /auto status   check the key, the judge, the mode and the last pick',
].join('\n')

async function setMode($: EngineInterface, mode: RouterMode) {
  await update($, modeAtom, () => mode)
  await $.store.set('mode', mode)
  pending = null
  routes.clear()
  shown = { mode, route: null }
  paint($)
}

// One handler for both commands: on/off, plus the setup words
async function runCommand($: EngineInterface, args: string, on: RouterMode): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const word = (parts[0] ?? '').toLowerCase()
  if (word === 'off') { await setMode($, 'off'); return 'Clutch off.' }
  if (word === 'key') return saveKey($, (parts[1] ?? '').toLowerCase() === 'judge')
  if (word === 'judge') return judgeCommand($, parts.slice(1))
  if (word === 'status') return status($)
  if (word === 'brief') return brief ? `Session brief${briefing ? ' (a fresh one is being written)' : ''}:\n${brief}` : 'No session brief yet. Haiku writes one in the background after your first reply while Clutch is on.'
  if (word === 'help' || word === '?') return HELP
  if (word) return `Unknown option "${word}".\n${HELP}`
  if (!(await ready($))) return SETUP
  await setMode($, on)
  const who = judge.kind === 'jev' ? 'Jev' : judge.kind === 'local' ? 'Your local decision model' : judge.model
  return on === 'auto'
    ? `Clutch engaged: ${who} picks the model and effort for every prompt, helped by a session brief Haiku keeps in the background. /auto off disengages.`
    : `Clutch effort engaged: ${who} picks the effort for every prompt, your model stays. /auto off disengages.`
}

// --- The session brief ---

type Row = { role: string; text: string; toolUses: { tool: string; input: Record<string, unknown>; isError?: true }[] }

function toolLine(u: Row['toolUses'][number]): string {
  const i = u.input
  const what = i.file_path ?? i.path ?? i.command ?? i.pattern ?? i.url ?? i.description ?? i.query ?? ''
  return `[${u.tool}${what ? ' ' + clip(String(what).replace(/\s+/g, ' '), 120) : ''}${u.isError ? ' FAILED' : ''}]`
}

const isCommand = (m: Row) => /^\s*<(command-|local-command)/.test(m.text)

// Newest messages first until the window is full, then back into reading order
function transcript(messages: Row[]): string {
  const parts: string[] = []
  let size = 0
  for (const m of [...messages].reverse()) {
    if (isCommand(m)) continue
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

const conversationSize = (messages: Row[]) => messages.reduce((n, m) => n + (isCommand(m) ? 0 : m.text.length + m.toolUses.length * 40), 0)

async function writeBrief($: EngineInterface, messages: Row[]) {
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

async function briefNow($: EngineInterface, messages: Row[], size: number) {
  const started = await $.clock.now()
  try { await writeBrief($, messages) } catch {}
  const debug = await $.env.get('CLUTCH_DEBUG')
  if (debug) await $.fs.write(debug, ((await $.fs.read(debug).catch(() => '')) + `\n=== brief rewritten in ${(await $.clock.now()) - started} ms (${turnsSinceBrief} turns, ${size - briefedChars} new chars)\n`))
  briefedChars = size
  turnsSinceBrief = 0
}

// Every few turns, or once enough is new: Haiku rewrites the brief while the user reads the reply
async function maybeBrief($: EngineInterface) {
  turnsSinceBrief++
  if (briefing) return
  const messages = await $.session.messages()
  if (!Array.isArray(messages) || !messages.length) return
  const size = conversationSize(messages)
  if (brief && size - briefedChars < BRIEF_EVERY_CHARS && turnsSinceBrief < BRIEF_EVERY_TURNS) return
  const run = briefNow($, messages, size)
  briefing = run
  paint($)
  await run
  if (briefing === run) briefing = null
  paint($)
}

// The route a prompt was given, until its turn starts; then each main turn's route by turn id
let pending: Route | null = null
const routes = new Map<string, Route>()

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'auto', description: 'Clutch: pick the model and effort for every prompt (/auto off, key, judge, brief, status, help)' })
    await $.command.register({ name: 'auto-effort', description: 'Clutch: pick only the effort, your model stays (/auto off to stop)' })
    const saved = (await $.store.get('mode')) as RouterMode | undefined
    const savedJudge = (await $.store.get('judge')) as Judge | undefined
    if (savedJudge?.kind) judge = savedJudge
    if (saved) await update($, modeAtom, () => saved)
    shown = { mode: saved ?? 'off', route: null }
    paint($)
    // First run: one line pointing at the setup, never again once a key exists
    if (!saved && !(await $.store.get('welcomed')) && !(await ready($))) {
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
    shown = { mode, route: route ?? { score: -1, level: -1, effort: 'high' } }
    paint($)
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
    if (mode !== 'off') void maybeBrief($).catch(() => {})
    return next(e)
  })
}
