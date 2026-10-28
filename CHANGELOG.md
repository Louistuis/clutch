# Changelog

## 1.7.0

- Live savings in the status line: `saved 61% (last 5)` shows what your last 5 messages cost against the same tokens on your session's own model, with the briefs and judge counted. When Clutch moved up to a stronger model it says `cost +12%` instead. `/clutch savings reset` clears it too.
- `CLUTCH_DEBUG` also logs the rolling figure after every reply.

## 1.6.0

Saves more without touching how smart it is.

- No bouncing: the first easy message after harder work counts the cost of coming back up, so a lone "ok" or "thanks" stays on the current model at low effort. Two easy messages in a row still move down.
- New-task hint: in a session past 60,000 tokens, the judge also answers "is this a new, unrelated task?". When it clearly is (and the message is a real task, not a quick side question), Clutch suggests `/clear` or `/compact`. It never clears anything itself.
- Subagent routing is on by default (`/clutch agents off` turns it off).
- Checked: changing only the effort does not break the prompt cache in Claude Code, so effort routing stays per message.

## 1.5.1

- Benchmarks: the Torque index (intelligence kept, cost and speed in one number) and BENCHMARKS.md, which explains every test and shows the raw results. New `bench/session_bench.py` (real coding sessions, with and without Clutch) and `bench/quality_bench.py` (trick questions graded by code).
- `CLUTCH_MODE=auto|effort|off` in the environment overrides every other setting (used by the benchmarks).

## 1.5.0

- Cost-aware shifting: before moving to a smaller model, Clutch prices the next request both ways at API list prices (Opus 5.5, Sonnet 5.5, Haiku 5.5, cache reads and writes) and moves when it is cheaper even after losing the prompt cache. Haiku nearly always is, so easy messages reach it at once; Opus to Sonnet still waits for three easy messages in a row or a cold cache.
- `/clutch savings`: every routed request priced at the model Clutch picked and at the session's own model, plus the briefs and the judge. `/clutch savings reset` starts over.
- `/clutch project`: per-project mode and a lowest or highest model.
- `/clutch agents on`: picks the model for general-purpose subagents that have none of their own. Off by default.
- The first brief waits until a session has some length.

## 1.4.0

Spends less.

- Cache-aware shifting: a smaller model is used only after three easy messages in a row, or once the prompt cache has gone cold (5 minutes). Until then the bigger model is kept at low effort, shown as `(held)`, because re-reading the conversation on a new model costs more than one easy reply saves. Moving up still happens at once.
- Thanks and greetings skip the judge: no call, no wait.
- `/clutch brief off` and `/clutch brief on`: the background brief is on by default and can now be turned off to save its Haiku calls.
- The README says plainly that the brief is a separate background call that never enters your conversation or Claude's context.

## 1.3.1

The commands are named after the plugin.

- `/auto` is now `/clutch`, and `/auto-effort` is now `/clutch-effort`. Every option moves with it: `/clutch off`, `/clutch local`, `/clutch local off`, `/clutch key`, `/clutch brief`, `/clutch status`, `/clutch help`. The old `/auto` commands no longer exist.
- Local setup is safer: one download at a time across Claude Code windows, `/clutch local off` also cancels a running download, and a failed setup waits for you instead of retrying on every message.

## 1.3.0

Local is now one switch, and Clutch sets it up by itself.

- `/auto local` checks the computer (Apple silicon, 8 GB of memory, free disk), downloads llama.cpp and H2O-Lightning-4B once into `~/.clutch` (pinned versions, SHA-256 checked, resumable), starts the server and rates messages with it. The status line shows the download and setup.
- `/auto local off` switches to Jev on OpenRouter and stops the server; the files stay.
- No OpenRouter key: `/auto` turns local on by itself, if the computer can run it.
- Removed `/auto judge` and its Ollama, LM Studio and chat options: one local judge, managed by Clutch.

## 1.2.0

- Local judges: `/auto judge` picks the model that rates each prompt. Jev on OpenRouter stays the default; `/auto judge ollama <model>`, `/auto judge lmstudio <model>` and `/auto judge chat <url> <model>` use a chat model on your own computer, and `/auto judge local [url]` uses llama.cpp's `/v1/systemone` decision endpoint. Setting a judge tests it on two sample prompts at once. `/auto key judge` saves a local server's key.
- The session brief now refreshes in the background every few turns (after the first reply, then every ~2,500 new characters or 4 replies), not after every reply. The status line shows `✎ brief` while Haiku writes it; `/auto brief` shows it.
- Benchmark: `bench_router.py --judge local|chat` tests a local judge. H2O-Lightning-4B scored 90.4% exact on the 73 prompts, both ways.
- Thinking is switched off for chat judges, so reasoning models answer at once.

## 1.1.1

- `/auto key` no longer saves a key that OpenRouter refuses; it says so and asks you to copy the whole key again. A key it cannot check (offline) is still saved.

## 1.1.0

The router is now called Clutch, and it installs as `clutch@clutch` from `Louistuis/clutch`.

- Beginner setup: `/auto key` saves the OpenRouter key from your clipboard (never shown in the chat) and checks it; `/auto status` checks the key, the mode and the last pick; `/auto help` lists the commands. `/auto` without a key shows the setup steps instead of turning on. A one-time hint appears after install.
- The README starts with a four-step setup for people new to coding and GitHub.

- Session briefs: after each main turn, Haiku at medium effort compresses the newest ~60,000 characters of the conversation (plus its previous brief) into a ~110-word routing brief. Jev reads it with every prompt, so routing knows what the session is in the middle of.
- The brief is written in the background; a prompt typed before it is ready waits at most 4 s, then uses the previous brief.
- Slash commands and their output are left out of the brief.
- Status line: `Clutch → sonnet · medium · 1.2/4 · ctx`.
- `CLUTCH_DEBUG=<file>` logs every score and the text Jev saw.

## 1.0.0

First public release.

- `/auto`: Jev 1.14 scores each prompt and picks the model and the effort for that turn.
- `/auto-effort`: Jev picks only the effort; your model and its prompt cache stay as they are.
- `/auto off` stops either mode. The mode is remembered across sessions.
- The status line shows each pick, for example `/auto → sonnet · medium · 1.2/4`.
- Reads the end of Claude's previous reply as well as your prompt, so "yes, do it" after a big plan counts as the plan's size.
- Falls back to the session's own settings if Jev does not answer within 2.5 s.
- Your OpenRouter key comes from `$OPENROUTER_API_KEY` or `~/.config/openrouter.key`.
- Benchmark script and results for 73 hand-labelled prompts in `bench/`.
