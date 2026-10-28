<p align="center"><img src="assets/clutch.svg" alt="Clutch: automatic gear changes for Claude Code" width="640"></p>

**Clutch picks the right Claude for every message you send.** A "thanks!" runs on fast, cheap Haiku. A hard bug runs on Opus with deep thinking. Everything in between gets Sonnet. You just type like normal.

It works inside [Claude Code](https://claude.com/claude-code), the coding assistant from Anthropic. You do not need to know how to code or how GitHub works to set it up: it takes about five minutes and a dollar of credit.

## Set it up in 4 steps

You need Claude Code installed and signed in. If you can chat with Claude in your terminal or in the Claude desktop app's Code tab, you are ready.

**1. Install Clutch.** In Claude Code, type these two lines, one at a time, and press Enter after each:

```
/plugin marketplace add Louistuis/clutch
```

```
/plugin install clutch@clutch
```

Then type `/reload-plugins` (or just close Claude Code and open it again).

**2. Get an OpenRouter key.** Clutch asks a tiny, fast decision model called Jev how hard each message is. Jev runs on OpenRouter, so you need your own key there:

- Go to [openrouter.ai/keys](https://openrouter.ai/keys), sign in (Google or GitHub sign-in works), and click **Create key**.
- Add a little credit at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits). $1 covers about 25,000 messages, so $1 to $5 is plenty.
- Click the copy button next to your new key.

**3. Save the key.** Back in Claude Code, with the key still copied, type:

```
/auto key
```

Clutch reads the key from your clipboard, saves it in a private file on your computer and checks that it works. The key is never shown in the chat and never sent to Claude.

**4. Turn it on.**

```
/auto
```

That's it. Under the chat box you will see which Claude it picked for each message, for example `Clutch → sonnet · medium · 1.2/4`.

Something not working? Type `/auto status`. It tells you whether your key works, whether Clutch is on and what it picked last.

## Commands

| Type this | What happens |
| --- | --- |
| `/auto` | Clutch picks the model and how hard it thinks, for every message. |
| `/auto-effort` | Clutch picks only how hard it thinks. Your model stays the one you chose (cheaper on long chats). |
| `/auto off` | Turns Clutch off. |
| `/auto key` | Saves the OpenRouter key on your clipboard. |
| `/auto status` | Checks your key, the mode and the last pick. |
| `/auto help` | Lists these commands. |

Clutch stays on until you turn it off, in every session.

## What it costs

- **OpenRouter:** about $0.00004 per message for Jev. $1 lasts a very long time.
- **Your Claude plan:** Clutch writes a short summary of the conversation with Haiku after each reply (see below). Haiku is Claude's smallest model, so this is a small extra on top of normal use. Picking Haiku or Sonnet for easy messages usually saves more than that.

## How it decides

Jev 1.14, TypeSafe's decision model, reads each message through [OpenRouter](https://openrouter.ai) and scores how much work it is, from 0 (trivial) to 4 (very hard). One call takes about 0.3 s.

Jev does not read messages in a vacuum. After each reply, Haiku (at medium effort) compresses the newest part of the conversation into a short routing brief: the task, its stage, the systems in play, what just happened and what is still open. Jev reads that brief with your next message, so "ok do it" after a long plan routes as the plan, and a quick question in the middle of a hard session still routes as a quick question.

| Jev's score | `/auto` model | Effort (both commands) |
| --- | --- | --- |
| trivial (chat, a quick fact) | Haiku 5.5 | low |
| simple (one small edit or command) | Sonnet 5.5 | medium |
| moderate (a few steps or files) | Sonnet 5.5 | high |
| hard (debugging, design, several systems) | Opus 5.5 | high |
| very hard (large, ambiguous, high-stakes) | Opus 5.5 | max |

- Jev also reads the session brief and the end of Claude's previous reply, so "yes, do it" after a big plan counts as the plan's size.
- The brief is written in the background while you read the reply, so it adds no delay to your next prompt. If you type before it is ready, Clutch waits up to 4 s for it, then uses the previous brief.
- Subagents keep their own model and effort.
- Messages that start with a slash command, and messages that are not typed by you, are not routed.

## Other ways to give it the key

If `/auto key` can't read your clipboard (some Linux setups), use one of these instead.

Set an environment variable before starting Claude Code:

```
export OPENROUTER_API_KEY=YOUR_KEY
```

Or put the key in a file only you can read (macOS and Linux):

```
mkdir -p ~/.config
printf '%s\n' 'YOUR_KEY' > ~/.config/openrouter.key
chmod 600 ~/.config/openrouter.key
```

The environment variable wins if both are set. Without a key, `/auto` shows the setup steps instead of turning on.

## The session brief

Haiku sees up to the newest ~60,000 characters of the conversation (your messages, Claude's replies, and one line per tool call such as `[Edit src/sync.py]`), plus its own previous brief for older context. It writes at most about 110 words in a fixed shape:

```
TASK:  what you are working on
STAGE: chatting, exploring, planning, building, debugging, reviewing, shipping
SCOPE: the files, services and systems in play
STATE: what just happened, or what Claude just offered and how big it is
OPEN:  unresolved problems, errors or decisions
WEIGHT: what makes the work hard or easy
```

It runs through your own Claude Code session (the same account and credentials), only while Clutch is on, and only for the main conversation, not subagents.

From a live test session (Opus as the session model):

| Prompt | Picked |
| --- | --- |
| "in Python, how do I format a datetime as 2026-10-28? one line" | Haiku |
| "users see duplicate photos after flaky networks, what are the likely causes?" | Opus |
| "ok write the full fix: server endpoint, migration and the swift retry queue" | Opus |
| "thanks!" | Sonnet |

The last one shows the trade-off: in a heavy session a bare "thanks!" scored 0.53, just over the line between trivial and simple. Clutch errs towards a stronger model rather than a weaker one.

Set `CLUTCH_DEBUG=/path/to/file` before starting Claude Code to append every score and the exact text Jev saw to that file.

## Benchmark

`bench/` holds a script that tests the classifier alone, with no model answering anything: 73 hand-labelled prompts (15 trivial, 16 simple, 15 moderate, 15 hard, 12 very hard), a few of them with a previous Claude reply as context.

| | exact level | within one level | right model |
| --- | --- | --- | --- |
| Jev 1.14 | 93.2% | 100% | 94.5% |
| prompt length only (no model) | 56.2% | 95.9% | 79.5% |

An earlier run scored 91.8% exact; one borderline prompt (score 3.45 to 3.5) flips between runs. No prompt was off by more than one level, and Jev was never too strong on the model, only too weak on 4 prompts (a hard task sent to Sonnet).

Read these numbers with care. The labels are the author's own judgement, 73 prompts is a small sample, and some of the prompts overlap the ones used while tuning the wording of the question sent to Jev. The length baseline is cut at the quantiles of this same set, which flatters it. Treat the table as a sanity check, not a guarantee.

The benchmark scores single prompts (some with a previous reply), so it measures Jev and the question wording, not the session brief.

Run it yourself (needs Python 3 and your key as above):

```
python3 bench/bench_router.py --out my-results.json
```

It sends the 73 prompts to OpenRouter (about $0.001 in total) and prints accuracy, a confusion matrix and the misses.

## Limits

- The model picker in the UI keeps showing your session's model, because mods cannot change it. The status line shows the model and effort the router actually used.
- Switching models skips the prompt cache, so `/auto` can cost more than `/auto-effort` on long conversations. If cost matters more than model choice, use `/auto-effort`.
- If Jev does not answer within 2.5 s, or returns an error, that turn keeps your session's model and effort.
- The mode is stored once and shared by all your sessions. Running `/auto off` in one session turns it off in the others for their next prompt.
- Jev scores difficulty from text. The brief tells it what the session is about, but it still cannot read your code.
- Writing the brief costs one Haiku call per turn on your Claude account while Clutch is on.

## Privacy

For every routed prompt, Clutch sends your prompt text (up to 8,000 characters), the last 1,500 characters of Claude's previous reply and the session brief (about 110 words summarising the conversation, which can name files, services and errors) to OpenRouter, which passes them to TypeSafe's Jev model to be scored. No files or raw tool output are sent there. The brief itself is written by Haiku through your own Claude account, the same way Claude Code sends the conversation already. The request is subject to OpenRouter's and TypeSafe's terms and privacy policies. Turn the router off with `/auto off` if your prompts must not leave your machine.

## How it works

`hooks/register.ts` registers the commands, writes the session brief on `turn.complete` with `$.model.complete`, scores each prompt on `prompt.submit` and overrides the model and effort on the turn's main-loop requests. The types are in `types/index.d.ts`.

## License

MIT. Copyright 2026 Louis Nordbø.
