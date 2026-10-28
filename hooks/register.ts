import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Route, RouterMode } from '../types'

// Clutch. /clutch: a small judge model picks the model and effort for every prompt. /clutch-effort: only the effort.
// /clutch off stops either. The judge is Jev 1.14 on OpenRouter (~0.3 s, ~$0.00004 a prompt), or, with
// /clutch local, H2O-Lightning-4B on this computer: Clutch checks the machine, downloads llama.cpp and the
// model once, and runs the server itself. Without an OpenRouter key, local is the default.
// Every few turns Haiku (medium effort) compresses the newest conversation into a short routing brief
// in the background, so the judge rates a prompt knowing what the session is in the middle of.
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
const JEV = 'typesafe/jev-1.14'
// The OpenRouter key: $OPENROUTER_API_KEY, else the first line of ~/.config/openrouter.key
const KEY_FILE = '.config/openrouter.key'
// How long the judge may take before the turn keeps the session's own model and effort. The hook that
// waits has a 10 s budget, shared with BRIEF_WAIT_MS.
const JEV_TIMEOUT_MS = 2500
const LOCAL_TIMEOUT_MS = 6000

// The local judge: pinned downloads, checked by SHA-256 before use
const LOCAL_DIR = '.clutch'
const LOCAL_PORT = 8749
const LLAMA = {
  url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11773/llama-b11773-bin-macos-arm64.tar.gz',
  sha256: 'ec085aac26d71d51b0f1d5a05bf3bd85b10a8e8f12c85e60c014e1857d88cd40',
  server: 'llama-b11773/llama-server',
}
const MODEL = {
  url: 'https://huggingface.co/h2oai/h2o-lightning-4b-gguf/resolve/3a0a341842c5d67443005d06c5e199d69c5c78af/h2o-lightning-4b-Q5_K_M.gguf',
  sha256: 'dc1854eab0fdebd7eae8c6313b1a2d13cbf42809bdfd173c240691fbd042ded6',
  file: 'h2o-lightning-4b-Q5_K_M.gguf',
  bytes: 3074991136,
}
// What a machine needs to run it fast enough: Apple silicon (Metal), 8 GB of memory, room for the files
const MIN_MEMORY = 8 * 2 ** 30
const MIN_FREE_DISK = MODEL.bytes + 2 ** 30

// Cost-aware shifting. A model change makes the API read the whole context (Claude Code's system prompt
// and tools, then the conversation) again at full price plus the cache write, while staying put reads it
// from the prompt cache. Moving down happens when the next request is cheaper on the smaller model even
// after that re-read (Haiku nearly always is), after DOWNSHIFT_AFTER easy picks in a row (the move then
// pays for itself over the next turns), or once the cache has gone cold. Moving up always happens at once.
const DOWNSHIFT_AFTER = 3
const CACHE_WARM_MS = 5 * 60 * 1000
// API list prices in USD per million tokens (Anthropic first-party, October 2026). A cache write costs
// 1.25 times input. Haiku 5.5 doubles past 100k tokens of prompt; its cache read is taken as a tenth of input
const PRICE: Record<string, { in: number; out: number; read: number }> = {
  opus: { in: 4, out: 20, read: 0.2 },
  sonnet: { in: 2, out: 10, read: 0.2 },
  haiku: { in: 0.1, out: 0.5, read: 0.01 },
  'haiku-long': { in: 0.5, out: 2.5, read: 0.05 },
}
// A new, unrelated task in a long session: suggest /clear or /compact, since every message re-reads it all
const NEW_TOPIC_MIN_TOKENS = 60000
const NEW_TOPIC_QUESTION = 'Does the user\'s last message start a new task unrelated to what the session has been working on?'
const NEW_TOPIC_HINT_AT = 0.8
// A rough guess at a reply's length (thinking included) by level, for comparing two models' next request
const EXPECTED_OUTPUT = [400, 1500, 4000, 8000, 15000]
// Thanks and greetings are trivial whatever came before: no judge call, no wait
const SMALL_TALK = /^\s*(thanks?( you)?( so much)?|thx|ty|cheers|hi|hey|hello|yo|nice|cool|great|awesome|lol|haha)[\s.!:)]*$/i
const rank = (model: string) => (/haiku/.test(model) ? 0 : /sonnet/.test(model) ? 1 : /opus/.test(model) ? 2 : undefined)

const BRIEF_MODEL = 'haiku'
// The newest conversation that goes to Haiku, in characters (~15k tokens), newest kept first
const BRIEF_WINDOW = 60000
// A new brief once this much conversation is new since the last one, or every BRIEF_EVERY_TURNS turns
const BRIEF_EVERY_CHARS = 2500
const BRIEF_EVERY_TURNS = 4
// The first brief waits for this much conversation, or a second reply
const BRIEF_START_CHARS = 1500
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

const last = atom({ plugin: 'clutch', key: 'last' } as const, null)
const modeAtom = atom({ plugin: 'clutch', key: 'mode' } as const, 'off')
const briefAtom = atom({ plugin: 'clutch', key: 'brief' } as const, '')

const short = (model: string) => model.replace('claude-', '').replace(/-\d.*$/, '')
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t)
const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

// Module state: local on or off and how far its setup is, the latest brief, what the status shows
let localOn = false
type LocalPhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'starting' | 'ready' | 'unavailable'
let local: { phase: LocalPhase; percent: number; note: string } = { phase: 'idle', percent: 0, note: '' }
let localSetup: Promise<void> | null = null
let server: AsyncGenerator<unknown, unknown> | null = null
let fetching: AsyncGenerator<unknown, unknown> | null = null
let briefOn = true
let lastMain: { model: string; at: number } | null = null
let easyStreak = 0
let agentsOn = true
let newTopic: number | null = null
let messagesSinceHint = 99
type ProjectRule = { mode?: RouterMode; min?: string; max?: string }
let project: ProjectRule = {}
let projectRoot = ''
let brief = ''
let briefing: Promise<void> | null = null
let briefedChars = 0
let turnsSinceBrief = 0
let shown: { mode: RouterMode; route: Route | null } = { mode: 'off', route: null }

// The status line: the pick, then what the judge and the brief are doing
function paint($: EngineInterface) {
  const { mode, route: r } = shown
  if (mode === 'off') return $.ui.status(undefined)
  const name = mode === 'auto' ? STATUS_NAME : `${STATUS_NAME} effort`
  const judgeNote = !localOn ? ''
    : local.phase === 'ready' ? ' · local'
    : local.phase === 'downloading' ? ` · ↓ local model ${local.percent}%`
    : local.phase === 'unavailable' ? ' · local unavailable'
    : local.phase === 'idle' ? '' : ` · local ${local.phase}`
  const tail = judgeNote + (briefing ? ' · ✎ brief' : brief ? ' · ctx' : '')
  if (!r) return $.ui.status(`${name} engaged${tail}`)
  if (r.score < 0) return $.ui.status(`${name}: no judge yet, session settings${tail}`)
  const model = r.model ? `${short(r.model)}${r.held ? ' (held)' : ''} · ` : ''
  $.ui.status(`${name} → ${model}${r.effort} · ${r.score.toFixed(1)}/4${tail}`)
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

const SETUP = [
  'Clutch needs a judge: a small model that rates each message.',
  'This computer cannot run the local one, so use Jev on OpenRouter (about $0.00004 a message, $1 lasts a long time):',
  '  1. Go to https://openrouter.ai/keys, sign in, and click "Create key".',
  '  2. Add a little credit at https://openrouter.ai/settings/credits ($1 to $5 is plenty).',
  '  3. Copy the key, then type /clutch key here. Clutch saves it from your clipboard; it never shows it in the chat.',
  '  4. Type /clutch to start.',
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

async function saveKey($: EngineInterface): Promise<string> {
  const key = await clipboard($)
  if (!/^sk-or-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return 'Your clipboard does not hold an OpenRouter key (they start with "sk-or-"). Copy the key from https://openrouter.ai/keys, then type /clutch key again.'
  }
  // A key OpenRouter refuses is not saved; one it could not check (offline) is
  const check = await checkKey($, key)
  if (check.includes('401')) return `Not saved: ${check}. Make sure you copied the whole key from https://openrouter.ai/keys, then type /clutch key again.`
  const h = await home($)
  if (!h) return 'Could not find your home folder to save the key in. Set OPENROUTER_API_KEY instead (see the README).'
  const path = `${h}/${KEY_FILE}`
  await $.fs.write(path, key + '\n')
  // Owner-only, where the system has chmod (Windows keeps the folder's own permissions)
  await $.process.run(['chmod', '600', path]).catch(() => null)
  return `Key saved to ~/${KEY_FILE} (${check}).${localOn ? ' Local is on, so Clutch keeps using the model on this computer; /clutch local off switches to Jev.' : ' Type /clutch to start Clutch.'}`
}

// --- The local judge ---

async function setLocal($: EngineInterface, phase: LocalPhase, note = '', percent = local.percent) {
  local = { phase, note, percent }
  paint($)
}

// Apple silicon with 8 GB and room for the model; anything else is told why not
async function sha256($: EngineInterface, path: string): Promise<string> {
  const r = await $.process.run(['shasum', '-a', '256', path], { timeoutMs: 300000 }).catch(() => null)
  return r?.stdout.split(/\s+/)[0] ?? ''
}

async function eligibility($: EngineInterface): Promise<string | null> {
  const os = await $.process.run(['uname', '-sm']).catch(() => null)
  if (!os || os.stdout.trim() !== 'Darwin arm64') return 'the local model needs a Mac with Apple silicon (M1 or newer) for now'
  const mem = Number((await $.process.run(['sysctl', '-n', 'hw.memsize'])).stdout.trim())
  if (mem < MIN_MEMORY) return `the local model needs 8 GB of memory, and this Mac has ${gb(mem)}`
  const h = (await home($))!
  if (!(await modelOk($, `${h}/${LOCAL_DIR}/${MODEL.file}`))) {
    const df = (await $.process.run(['df', '-k', h])).stdout.trim().split('\n').pop()?.split(/\s+/) ?? []
    const free = Number(df[3]) * 1024
    if (free < MIN_FREE_DISK) return `the local model needs ${gb(MIN_FREE_DISK)} of free disk space, and there is ${gb(free)}`
  }
  return null
}

// curl with resume, its progress bar read for the status line
async function download($: EngineInterface, url: string, to: string, label: string) {
  const curl = $.process.spawn({ argv: ['curl', '-fL', '--retry', '3', '-C', '-', '-#', '-o', to, url] })
  fetching = curl
  let shown = -1
  for await (const piece of curl) {
    const found = [...piece.text.matchAll(/(\d+(?:\.\d+)?)%/g)].pop()
    const pct = found ? Math.floor(Number(found[1])) : shown
    if (pct !== shown) { shown = pct; await setLocal($, 'downloading', label, pct) }
  }
  if (fetching !== curl) throw new Error('the download was stopped')
  fetching = null
  const end = await curl.result
  if (end.code !== 0) throw new Error(`the download of ${label} stopped (curl exit ${end.code}); /clutch local tries again and picks up where it left off`)
}

const sizeOf = ($: EngineInterface, path: string) =>
  $.process.run(['stat', '-f', '%z', path]).then(r => (r.exitCode === 0 ? Number(r.stdout.trim()) : 0)).catch(() => 0)

// Checked once after download; then a marker next to it saves hashing 3 GB at every session start
async function modelOk($: EngineInterface, path: string): Promise<boolean> {
  const marker = (await $.fs.read(`${path}.sha256`).catch(() => '')).trim()
  return marker === MODEL.sha256 && (await sizeOf($, path)) === MODEL.bytes
}

async function serverUp($: EngineInterface): Promise<boolean> {
  const r = await $.http.fetch(`http://127.0.0.1:${LOCAL_PORT}/health`).catch(() => null)
  return !!r && r.ok
}

// Runs for the session's life: the loop is the server's; leaving it stops the server
async function runServer($: EngineInterface, bin: string, model: string, onReady: () => void) {
  const child = $.process.spawn({
    argv: [bin, '-m', model, '--host', '127.0.0.1', '--port', String(LOCAL_PORT), '-ngl', '99', '-c', '8192', '-np', '1', '--no-webui'],
  })
  server = child
  for await (const piece of child) {
    if (/listening on|all slots are idle/.test(piece.text)) onReady()
  }
  if (server === child) server = null
}

async function fetchFiles($: EngineInterface, dir: string, bin: string, model: string) {
  if ((await $.process.run(['test', '-x', bin])).exitCode !== 0) {
    const tgz = `${dir}/llama.tar.gz`
    await download($, LLAMA.url, tgz, 'llama.cpp')
    await setLocal($, 'verifying', 'checking llama.cpp')
    if ((await sha256($, tgz)) !== LLAMA.sha256) {
      await $.process.run(['rm', '-f', tgz])
      return setLocal($, 'unavailable', 'the llama.cpp download did not match its checksum; /clutch local tries again')
    }
    await $.process.run(['tar', 'xzf', tgz, '-C', dir])
    await $.process.run(['rm', '-f', tgz])
  }
  // A complete file without its marker (moved, or the marker deleted) is hashed, not fetched again
  if (!(await modelOk($, model)) && (await sizeOf($, model)) === MODEL.bytes) {
    await setLocal($, 'verifying', 'checking the model (a few seconds)')
    if ((await sha256($, model)) === MODEL.sha256) await $.fs.write(`${model}.sha256`, MODEL.sha256 + '\n')
    else await $.process.run(['rm', '-f', model])
  }
  if (!(await modelOk($, model))) {
    await download($, MODEL.url, `${model}.part`, 'the local model')
    await setLocal($, 'verifying', 'checking the model (a few seconds)')
    if ((await sha256($, `${model}.part`)) !== MODEL.sha256) {
      await $.process.run(['rm', '-f', `${model}.part`])
      return setLocal($, 'unavailable', 'the model download did not match its checksum; /clutch local downloads it again')
    }
    await $.process.run(['mv', `${model}.part`, model])
    await $.fs.write(`${model}.sha256`, MODEL.sha256 + '\n')
  }
}

async function prepareLocal($: EngineInterface) {
  await setLocal($, 'checking', 'checking this computer')
  const why = await eligibility($)
  if (why) return setLocal($, 'unavailable', why)
  const h = (await home($))!
  const dir = `${h}/${LOCAL_DIR}`
  await $.process.run(['mkdir', '-p', dir])
  const bin = `${dir}/${LLAMA.server}`
  const model = `${dir}/${MODEL.file}`
  const lock = `${dir}/.downloading`
  const needsFiles = (await $.process.run(['test', '-x', bin])).exitCode !== 0 || !(await modelOk($, model))
  // One download at a time across every Claude Code window: mkdir is atomic. A lock older than an hour is stale
  if (needsFiles) {
    await $.process.run(['find', lock, '-maxdepth', '0', '-mmin', '+60', '-exec', 'rmdir', '{}', ';']).catch(() => null)
    if ((await $.process.run(['mkdir', lock])).exitCode !== 0) return setLocal($, 'idle', 'another Claude Code window is downloading it')
  }
  try {
    await fetchFiles($, dir, bin, model)
  } finally {
    if (needsFiles) await $.process.run(['rmdir', lock]).catch(() => null)
  }
  if (local.phase === 'unavailable') return

  // Another session may already run it on the same port
  if (await serverUp($)) return setLocal($, 'ready', 'running')
  await setLocal($, 'starting', 'loading the model')
  let resolveReady!: () => void
  const ready = new Promise<void>(r => { resolveReady = r })
  const running = runServer($, bin, model, resolveReady).catch(() => {})
  // The log line says it is listening; the health check says it can answer (the model may still be loading)
  await Promise.race([ready, running])
  for (let i = 0; i < 40 && !(await serverUp($)); i++) await $.clock.sleep(500)
  if (await serverUp($)) await setLocal($, 'ready', 'running')
  else await setLocal($, 'unavailable', `the local server did not start; its files are in ~/${LOCAL_DIR}`)
  void running.then(() => { if (localOn && local.phase === 'ready') return setLocal($, 'idle', 'stopped') })
}

// Starts the setup once; later calls see it running or done
function ensureLocal($: EngineInterface) {
  if (local.phase === 'ready' || localSetup) return
  const run = prepareLocal($)
    .catch(err => setLocal($, 'unavailable', String(err?.message ?? err)))
    .finally(() => { if (localSetup === run) localSetup = null })
  localSetup = run
}

async function stopLocal($: EngineInterface) {
  const child = server
  const curl = fetching
  server = null
  fetching = null
  await child?.return(undefined).catch(() => {})
  await curl?.return(undefined).catch(() => {})
  await setLocal($, 'idle', '', 0)
}

async function setLocalOn($: EngineInterface, on: boolean) {
  localOn = on
  await $.store.set('local', on)
  if (on && local.phase === 'unavailable') local.phase = 'idle'
  if (on) ensureLocal($)
  else await stopLocal($)
}

function localSummary(): string {
  switch (local.phase) {
    case 'ready': return 'Local model: running on this computer.'
    case 'downloading': return `Local model: downloading ${local.note}, ${local.percent}% (one time only).`
    case 'unavailable': return `Local model: not available: ${local.note}.`
    case 'idle': return 'Local model: not started yet.'
    default: return `Local model: ${local.note}.`
  }
}

// --- Scoring ---

async function post($: EngineInterface, url: string, key: string | null, body: unknown, timeoutMs: number) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  const answer = $.http.fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => null)
  const res = await Promise.race([answer, $.clock.sleep(timeoutMs).then(() => null)])
  return res && res.ok ? JSON.parse(res.text) : null
}

// Local when it is on and running; Jev when local is off. Jev and llama.cpp's /v1/systemone take the same request
let used = 'Jev'
async function score($: EngineInterface, state: string, askNewTopic = false): Promise<number | null> {
  const questions: Record<string, unknown> = { difficulty: { type: 'score', instructions: QUESTION, criteria: LEVELS } }
  if (askNewTopic) questions.newTopic = { type: 'noul', instructions: NEW_TOPIC_QUESTION }
  newTopic = null
  let d: any = null
  used = localOn && local.phase === 'ready' ? 'local' : 'Jev'
  if (localOn && local.phase === 'ready') {
    d = await post($, `http://127.0.0.1:${LOCAL_PORT}/v1/systemone`, null, { state, questions }, LOCAL_TIMEOUT_MS)
    // The session that ran the server may have closed: start it again for the next prompt
    if (!d && !(await serverUp($))) { local.phase = 'idle'; ensureLocal($) }
  } else {
    // A failed setup waits for /clutch local; it is not retried on every message
    if (localOn && local.phase !== 'unavailable') ensureLocal($)
    // Jev while local is off, or while it is still being set up and a key exists
    const key = (await findKey($))?.key
    if (!key) return null
    d = await post($, JEV_URL, key, { model: JEV, state, questions }, JEV_TIMEOUT_MS)
    if (typeof d?.usage?.cost === 'number') await addSavings($, { judge: d.usage.cost })
  }
  const s = d?.answers?.difficulty?.score
  const n = d?.answers?.newTopic?.noul
  if (typeof n === 'number') newTopic = n
  return typeof s === 'number' ? s : null
}

async function classify($: EngineInterface, text: string, mode: RouterMode): Promise<Route | null> {
  const messages = await $.session.messages()
  if (SMALL_TALK.test(text)) return shift($, { score: 0, level: 0, effort: EFFORTS[0], model: mode === 'auto' ? clamp(MODELS[0]!) : undefined })
  // One transcript, so "yes, do it" after a big plan reads as the plan's size (a separate field was ignored)
  const before = messages.filter(m => m.role === 'assistant' && m.text).at(-1)?.text ?? ''
  // The brief is background; the job is still whatever the last message asks for
  const state = (brief ? `Background on the session (it does not set the job size; the user's last message does):\n${brief}\n\n` : '')
    + (before ? `Assistant: ${before.slice(-1500)}\n\n` : '') + `User: ${text.slice(0, 8000)}`
  messagesSinceHint++
  // Only worth asking once the session is long and has a brief to compare against
  const long = !!brief && messagesSinceHint > 5 && (await contextTokens($)) >= NEW_TOPIC_MIN_TOKENS
  const s = await score($, state, long)
  // A quick side question ("what's the capital of Peru?") is unrelated too, but not worth leaving the session for
  if (long && s !== null && s >= 1.5 && newTopic !== null && newTopic >= NEW_TOPIC_HINT_AT) {
    messagesSinceHint = 0
    const k = Math.round((await contextTokens($)) / 1000)
    $.ui.toast(`Clutch: this looks like a new task. Every message here re-reads about ${k}k tokens of the old one; /clear starts fresh, /compact keeps a short summary.`, { timeoutMs: 15000 })
  }
  // CLUTCH_DEBUG=<file>: append what the judge saw and said, for testing the router
  const debug = await $.env.get('CLUTCH_DEBUG')
  if (debug) await $.fs.write(debug, ((await $.fs.read(debug).catch(() => '')) + `\n=== ${used}: ${s?.toFixed(2) ?? 'no answer'}${newTopic !== null ? ` (new topic ${newTopic.toFixed(2)})` : ''}\n${state}\n`))
  if (s === null) return null
  const level = Math.max(0, Math.min(4, Math.round(s)))
  return shift($, { score: s, level, effort: EFFORTS[level] ?? 'high', model: mode === 'auto' ? clamp(MODELS[level]!) : undefined })
}

const FAMILY: Record<string, string> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }

// This project's floor and ceiling, if it has them
function clamp(model: string): string {
  const r = rank(model) ?? 2
  if (project.min && r < (rank(project.min) ?? 0)) return FAMILY[project.min]!
  if (project.max && r > (rank(project.max) ?? 2)) return FAMILY[project.max]!
  return model
}

// Keeps the bigger model while moving down would cost more in cache misses than it saves
async function shift($: EngineInterface, r: Route): Promise<Route> {
  const was = lastMain ? rank(lastMain.model) : undefined
  const now = r.model ? rank(r.model) : undefined
  if (!lastMain || !r.model || was === undefined || now === undefined || now >= was) { easyStreak = 0; return r }
  easyStreak++
  const warm = (await $.clock.now()) - lastMain.at < CACHE_WARM_MS
  if (!warm || easyStreak >= DOWNSHIFT_AFTER) { easyStreak = 0; return r }
  const context = await contextTokens($)
  const out = EXPECTED_OUTPUT[r.level] ?? 1500
  const stay = priceOf(lastMain.model, context)
  const move = priceOf(r.model, context)
  const stayCost = context * stay.read + out * stay.out
  // The first easy message after harder work is usually a one-off ("thanks", "ok"): count the trip back up too
  const returnTrip = easyStreak === 1 ? context * (stay.in * 1.25 - stay.read) : 0
  const moveCost = context * move.in * 1.25 + out * move.out + returnTrip
  if (moveCost <= stayCost) { easyStreak = 0; return r }
  return { ...r, model: lastMain.model, held: true }
}

function priceOf(model: string, promptTokens: number) {
  const family = /haiku/.test(model) ? (promptTokens > 100000 ? 'haiku-long' : 'haiku') : /sonnet/.test(model) ? 'sonnet' : 'opus'
  return PRICE[family]!
}

// The context the next request reads: what the session last measured, else a guess from the transcript
async function contextTokens($: EngineInterface): Promise<number> {
  const measured = await $.session.usage().then(u => u.context.tokens).catch(() => undefined)
  if (measured) return measured
  return 20000 + Math.round(textSize(await $.session.messages()) / 4)
}

// USD for one request's usage, at one model's prices
function costOf(model: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number {
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const p = priceOf(model, prompt)
  return (u.input_tokens * p.in + u.cache_creation_input_tokens * p.in * 1.25 + u.cache_read_input_tokens * p.read + u.output_tokens * p.out) / 1e6
}

// --- Savings: every routed main request priced twice, at what ran and at the session's own model ---

type Savings = { since: number; requests: number; actual: number; baseline: number; brief: number; judge: number }
const emptySavings = async ($: EngineInterface): Promise<Savings> => ({ since: await $.clock.now(), requests: 0, actual: 0, baseline: 0, brief: 0, judge: 0 })

async function addSavings($: EngineInterface, change: Partial<Savings>) {
  const s = ((await $.store.get('savings')) as Savings | undefined) ?? (await emptySavings($))
  for (const [k, v] of Object.entries(change)) (s as any)[k] += v
  await $.store.set('savings', s)
}

async function savingsReport($: EngineInterface, arg: string): Promise<string> {
  if (arg === 'reset') { await $.store.set('savings', await emptySavings($)); return 'Savings tally reset.' }
  const s = (await $.store.get('savings')) as Savings | undefined
  if (!s || !s.requests) return 'No routed requests counted yet. Clutch counts them while /clutch is on.'
  const days = Math.max(1, Math.round(((await $.clock.now()) - s.since) / 86400000))
  const spent = s.actual + s.brief + s.judge
  const saved = s.baseline - spent
  const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 5 : n < 1 ? 3 : 2)}`
  return [
    `Clutch over the last ${days} day${days === 1 ? '' : 's'}: ${s.requests} requests routed.`,
    `  On the models Clutch picked:     ${usd(s.actual)}`,
    `  Session briefs (Haiku):          ${usd(s.brief)}`,
    `  Judge (Jev on OpenRouter):       ${usd(s.judge)}`,
    `  The same requests on your own session model: ${usd(s.baseline)}`,
    saved >= 0 ? `  Saved about ${usd(saved)} (${Math.round((saved / Math.max(s.baseline, 1e-9)) * 100)}%).` : `  Clutch cost about ${usd(-saved)} more, mostly from moving up to a stronger model.`,
    'At API list prices. The same tokens are priced at both models, so effort savings (fewer tokens) are not counted, and on a Pro or Max plan this is a share of your usage limits rather than money. /clutch savings reset starts over.',
  ].join('\n')
}

// --- Commands ---

async function status($: EngineInterface): Promise<string> {
  const mode = await effectiveMode($)
  const lines = [`Clutch is ${mode === 'auto' ? 'on (/clutch: model and effort)' : mode === 'effort' ? 'on (/clutch-effort: effort only)' : 'off'}.`]
  if (localOn) lines.push(`Judge: H2O-Lightning-4B on this computer (/clutch local off switches to Jev).`, localSummary())
  else {
    const found = await findKey($)
    lines.push('Judge: Jev 1.14 on OpenRouter (/clutch local runs one on this computer instead).')
    lines.push(found ? `Key: from ${found.from}, ${await checkKey($, found.key)}.` : 'Key: none yet. /clutch key saves one, or /clutch local skips OpenRouter.')
  }
  if (project.mode || project.min || project.max) lines.push(`This project: ${[project.mode ? `mode ${project.mode}` : '', project.min ? `at least ${project.min}` : '', project.max ? `at most ${project.max}` : ''].filter(Boolean).join(', ')}.`)
  lines.push(`Subagents: ${agentsOn ? 'routed (general-purpose ones)' : 'not routed'}.`)
  lines.push(!briefOn ? 'Session brief: off (/clutch brief on turns it on).' : briefing
    ? 'Session brief: Haiku is refreshing it in the background.'
    : brief ? `Session brief: ready (${brief.split(/\s+/).length} words), refreshed in the background every few turns.` : 'Session brief: none yet (written in the background after your first reply).')
  const r = (await $.state.get({ plugin: 'clutch', key: 'last' })).value as Route | null
  if (r && r.score >= 0) lines.push(`Last pick: ${r.model ? short(r.model) + ', ' : ''}${r.effort} effort (score ${r.score.toFixed(2)} of 4)${r.held ? '; the model was held to keep the prompt cache' : ''}.`)
  return lines.join('\n')
}

const HELP = [
  'Clutch picks the model and effort for each message you send.',
  '  /clutch            turn it on (picks model and effort)',
  '  /clutch-effort     turn it on, but keep your model (picks effort only)',
  '  /clutch off        turn it off',
  '  /clutch local      rate messages with a free model on this computer (one-time 3 GB download)',
  '  /clutch local off  rate messages with Jev on OpenRouter instead',
  '  /clutch key        save the OpenRouter key on your clipboard (for Jev)',
  '  /clutch brief      show the session brief Haiku keeps in the background',
  '  /clutch brief off  stop the brief to save usage (/clutch brief on turns it back on)',
  '  /clutch savings    what Clutch saved so far, at API prices',
  '  /clutch project    settings for this project only (mode, min and max model)',
  '  /clutch agents off stop picking the model for general-purpose subagents (on by default)',
  '  /clutch status     check the judge, the key, the mode and the last pick',
].join('\n')

async function setMode($: EngineInterface, mode: RouterMode) {
  await update($, modeAtom, () => mode)
  await $.store.set('mode', mode)
  pending = null
  routes.clear()
  shown = { mode, route: null }
  paint($)
}

async function localCommand($: EngineInterface, arg: string): Promise<string> {
  if (arg === 'off') {
    await setLocalOn($, false)
    return (await findKey($))
      ? 'Local off: Jev on OpenRouter rates your messages now. The model stays on disk for next time.'
      : 'Local off. Jev on OpenRouter needs a key: copy one from https://openrouter.ai/keys and type /clutch key.'
  }
  const why = await eligibility($)
  if (why) return `This computer can't run the local model: ${why}. Clutch stays on Jev (OpenRouter).`
  await setLocalOn($, true)
  if (local.phase === 'ready') return 'Local on: the model on this computer rates your messages.'
  return `Local on. Clutch is setting up the model on this computer: a one-time download of about ${gb(MODEL.bytes)}, then it starts by itself. The status line shows the progress; until it is ready, ${(await findKey($)) ? 'Jev keeps rating your messages' : 'messages use your session\'s own model'}.`
}

// One handler for both commands: on/off, plus the setup words
async function runCommand($: EngineInterface, args: string, on: RouterMode): Promise<string> {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const word = parts[0] ?? ''
  if (word === 'off') { await setMode($, 'off'); return 'Clutch off.' }
  if (word === 'key') return saveKey($)
  if (word === 'local') return localCommand($, parts[1] ?? 'on')
  if (word === 'status') return status($)
  if (word === 'savings') return savingsReport($, parts[1] ?? '')
  if (word === 'project') return projectCommand($, parts.slice(1))
  if (word === 'agents' && (parts[1] === 'on' || parts[1] === 'off')) {
    agentsOn = parts[1] === 'on'
    await $.store.set('agents', agentsOn)
    return agentsOn
      ? 'Subagents on: a general-purpose helper agent with no model of its own gets one picked for its task (in /clutch mode). Agents that name their model keep it.'
      : 'Subagents off: helper agents keep the model they would get without Clutch.'
  }
  if (word === 'brief' && (parts[1] === 'off' || parts[1] === 'on')) {
    briefOn = parts[1] === 'on'
    await $.store.set('brief', briefOn)
    if (!briefOn) brief = ''
    paint($)
    return briefOn
      ? 'Session brief on: every few replies, Haiku quietly writes a short summary for the judge, outside your conversation.'
      : 'Session brief off: the judge sees only your message and the end of the last reply. Saves the Haiku calls; picks are a little less precise in long sessions.'
  }
  if (word === 'brief' && !briefOn) return 'The session brief is off. /clutch brief on turns it back on.'
  if (word === 'brief') return brief ? `Session brief${briefing ? ' (a fresh one is being written)' : ''}:\n${brief}` : 'No session brief yet. Haiku writes one in the background after your first reply while Clutch is on.'
  if (word === 'help' || word === '?') return HELP
  if (word) return `Unknown option "${word}".\n${HELP}`

  // No OpenRouter key: local is the default, if this computer can run it
  let intro = ''
  if (!localOn && !(await findKey($))) {
    if (await eligibility($)) return SETUP
    intro = (await localCommand($, 'on')) + '\n'
  }
  await setMode($, on)
  const who = localOn ? 'the model on this computer' : 'Jev'
  return intro + (on === 'auto'
    ? `Clutch engaged: ${who} picks the model and effort for every message${briefOn ? ', helped by a session brief Haiku keeps silently in the background (outside your conversation)' : ''}. /clutch off disengages.`
    : `Clutch effort engaged: ${who} picks the effort for every message, your model stays. /clutch off disengages.`)
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

// Conversation text, for how often the brief is refreshed
const textSize = (messages: Row[]) => messages.reduce((n, m) => n + (isCommand(m) ? 0 : m.text.length + m.toolUses.length * 40), 0)

// Returns what the call cost, in USD at list prices
async function writeBrief($: EngineInterface, messages: Row[]): Promise<number> {
  const recent = transcript(messages)
  if (!recent) return 0
  const r = await $.model.complete({
    model: BRIEF_MODEL,
    effort: 'medium',
    maxTokens: 400,
    timeoutMs: 30000,
    system: BRIEF_SYSTEM,
    prompt: (brief ? `Previous brief (older context, may be stale):\n${brief}\n\n` : '') + `Newest conversation:\n${recent}`,
  })
  const cost = r.usage ? costOf(BRIEF_MODEL, r.usage) : 0
  if (cost) await addSavings($, { brief: cost })
  if (r.isAnswered && r.text.trim()) {
    brief = r.text.trim().slice(0, 1200)
    await update($, briefAtom, () => brief)
  }
  return cost
}

async function briefNow($: EngineInterface, messages: Row[], size: number) {
  const started = await $.clock.now()
  let cost = 0
  try { cost = await writeBrief($, messages) } catch {}
  const debug = await $.env.get('CLUTCH_DEBUG')
  if (debug) await $.fs.write(debug, ((await $.fs.read(debug).catch(() => '')) + `\n=== brief rewritten in ${(await $.clock.now()) - started} ms, $${cost.toFixed(5)} (${turnsSinceBrief} turns, ${size - briefedChars} new chars)\n`))
  briefedChars = size
  turnsSinceBrief = 0
}

// Every few turns, or once enough is new: Haiku rewrites the brief while the user reads the reply
async function maybeBrief($: EngineInterface) {
  turnsSinceBrief++
  if (briefing) return
  const messages = await $.session.messages()
  if (!Array.isArray(messages) || !messages.length) return
  const size = textSize(messages)
  // A short session needs no brief yet: the last reply already says everything
  if (!brief && size < BRIEF_START_CHARS && turnsSinceBrief < 2) return
  if (brief && size - briefedChars < BRIEF_EVERY_CHARS && turnsSinceBrief < BRIEF_EVERY_TURNS) return
  const run = briefNow($, messages, size)
  briefing = run
  paint($)
  await run
  if (briefing === run) briefing = null
  paint($)
}

// This project's own mode wins over the global one
// CLUTCH_MODE=auto|effort|off in the environment wins over both (the benchmarks use it to run one arm each)
async function effectiveMode($: EngineInterface): Promise<RouterMode> {
  const forced = await $.env.get('CLUTCH_MODE')
  if (forced === 'auto' || forced === 'effort' || forced === 'off') return forced
  return project.mode ?? (await $.state.get({ plugin: 'clutch', key: 'mode' })).value ?? 'off'
}

async function loadProject($: EngineInterface) {
  projectRoot = await $.session.root().catch(() => '')
  const all = ((await $.store.get('projects')) as Record<string, ProjectRule> | undefined) ?? {}
  project = all[projectRoot] ?? {}
}

async function projectCommand($: EngineInterface, parts: string[]): Promise<string> {
  const [what = '', value = ''] = parts
  const all = ((await $.store.get('projects')) as Record<string, ProjectRule> | undefined) ?? {}
  const rule: ProjectRule = { ...(all[projectRoot] ?? {}) }
  const where = projectRoot.split('/').filter(Boolean).pop() ?? 'this project'
  if (['auto', 'effort', 'off'].includes(what)) rule.mode = what as RouterMode
  else if ((what === 'min' || what === 'max') && FAMILY[value]) rule[what] = value
  else if (what === 'reset') { delete all[projectRoot]; await $.store.set('projects', all); project = {}; paint($); return `${where}: back to your global Clutch settings.` }
  else if (what) return [
    'Settings for this project only (the folder Claude Code started in):',
    '  /clutch project auto | effort | off   the mode here, whatever the global one is',
    '  /clutch project min sonnet            never go below Sonnet here (haiku, sonnet or opus)',
    '  /clutch project max sonnet            never go above Sonnet here',
    '  /clutch project reset                 use the global settings again',
  ].join('\n')
  if (what) { all[projectRoot] = rule; await $.store.set('projects', all); project = rule; paint($) }
  const bits = [rule.mode ? `mode ${rule.mode}` : 'global mode', rule.min ? `at least ${rule.min}` : '', rule.max ? `at most ${rule.max}` : ''].filter(Boolean)
  return `${where}: ${bits.join(', ')}.${what ? '' : ' /clutch project help lists the options.'}`
}

// The route a prompt was given, until its turn starts; then each main turn's route by turn id
let pending: Route | null = null
const routes = new Map<string, Route>()

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'clutch', description: 'Clutch: pick the model and effort for every message (/clutch off, local, key, brief, status, help)' })
    await $.command.register({ name: 'clutch-effort', description: 'Clutch: pick only the effort, your model stays (/clutch off to stop)' })
    const saved = (await $.store.get('mode')) as RouterMode | undefined
    localOn = (await $.store.get('local')) === true
    briefOn = (await $.store.get('brief')) !== false
    agentsOn = (await $.store.get('agents')) !== false
    await loadProject($)
    if (saved) await update($, modeAtom, () => saved)
    shown = { mode: saved ?? 'off', route: null }
    paint($)
    // Local and on: get the model server going before the first message
    if (localOn && saved && saved !== 'off') ensureLocal($)
    // First run: one line pointing at the setup
    if (!saved && !(await $.store.get('welcomed'))) {
      $.ui.toast('Clutch is installed. Type /clutch to start, or /clutch help.')
      await $.store.set('welcomed', true)
    }
    return next(e)
  })

  // Always on, never a toggle: the mode is shared by every session, so a toggle could switch it off unseen
  on('command.run', { command: 'clutch' }, async ($, e) => ({ text: await runCommand($, e.args, 'auto') }))
  on('command.run', { command: 'clutch-effort' }, async ($, e) => ({ text: await runCommand($, e.args, 'effort') }))

  on('prompt.submit', async ($, e, next) => {
    const mode = await effectiveMode($)
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

  // Opt-in: a general-purpose subagent with no model of its own gets one picked for its task
  on('agent.spawn', async ($, e, next) => {
    if (!agentsOn || e.model || e.fork || e.isTeammate || e.workflow || e.subagentType !== 'general-purpose') return next(e)
    if ((await effectiveMode($)) !== 'auto') return next(e)
    const s = await score($, `A coding assistant hands this task to a helper agent.\n\nUser: ${e.prompt.slice(0, 8000)}`).catch(() => null)
    if (s === null) return next(e)
    const level = Math.max(0, Math.min(4, Math.round(s)))
    return next({ ...e, model: clamp(MODELS[level]!) })
  })

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
    if (e.agentId === undefined) lastMain = { model: route?.model ?? e.model, at: await $.clock.now() }
    if (!route) return yield* next(e)
    const res = yield* next({ ...e, effort: route.effort, ...(route.model ? { model: route.model } : {}) })
    if (res?.usage) await addSavings($, { requests: 1, actual: costOf(res.usage.model, res.usage), baseline: costOf(e.model, res.usage) })
    return res
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    routes.delete(e.turnId)
    const mode = await effectiveMode($)
    // Not awaited: the brief is written while the user reads the reply, ready for their next prompt
    if (mode !== 'off' && briefOn) void maybeBrief($).catch(() => {})
    return next(e)
  })
}
