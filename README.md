<p align="center"><img src="assets/clutch.svg" alt="Clutch: automatic gear changes for Claude Code" width="640"></p>

**Clutch picks the right Claude for every message you send.** A "thanks!" runs on fast, cheap Haiku. A hard bug runs on Opus with deep thinking. Everything in between gets Sonnet. You just type like normal.

It works inside [Claude Code](https://claude.com/claude-code), the coding assistant from Anthropic. You do not need to know how to code or how GitHub works to set it up.

## Set it up

You need Claude Code installed and signed in. If you can chat with Claude in your terminal or in the Claude desktop app's Code tab, you are ready.

**1. Install Clutch.** In Claude Code, type these two lines, one at a time, and press Enter after each:

```
/plugin marketplace add Louistuis/clutch
```

```
/plugin install clutch@clutch
```

Then type `/reload-plugins` (or just close Claude Code and open it again).

**2. Turn it on.**

```
/clutch
```

That's it. Clutch uses a small "judge" model to rate how hard each message is:

- **On a Mac with Apple silicon (M1 or newer, 8 GB of memory or more),** Clutch runs a free judge right on your computer. The first time, it downloads it once (about 3 GB) and starts it by itself; the status line shows the progress. No account, no key, nothing leaves your Mac for the rating.
- **On other computers,** Clutch uses Jev on OpenRouter instead, which needs a key. See [Use Jev on OpenRouter](#use-jev-on-openrouter) below; it takes two minutes and a dollar of credit.

Under the chat box you will see which Claude it picked for each message, for example `Clutch → sonnet · medium · 1.2/4 · local · ctx`.

| Status line piece | Meaning |
| --- | --- |
| `sonnet · medium` | the model and thinking effort this message got |
| `1.2/4` | how hard the judge rated it, from 0 (trivial) to 4 (very hard) |
| `✎ brief` | Haiku is quietly refreshing the session brief in the background |
| `ctx` | a session brief is ready and was used for this pick |
| `local` | the judge on your own computer rated it |
| `↓ local model 42%` | the one-time download is running |

Something not working? Type `/clutch status`. It tells you whether your key works, whether Clutch is on and what it picked last.

## Commands

| Type this | What happens |
| --- | --- |
| `/clutch` | Clutch picks the model and how hard it thinks, for every message. |
| `/clutch-effort` | Clutch picks only how hard it thinks. Your model stays the one you chose (cheaper on long chats). |
| `/clutch off` | Turns Clutch off. |
| `/clutch local` | Rates messages with the free judge on your computer (sets it up the first time). |
| `/clutch local off` | Rates messages with Jev on OpenRouter instead. |
| `/clutch key` | Saves the OpenRouter key on your clipboard (for Jev). |
| `/clutch brief` | Shows the session brief Haiku keeps in the background. |
| `/clutch status` | Shows the judge, the download or key, the mode and the last pick. |
| `/clutch help` | Lists these commands. |

Clutch stays on until you turn it off, in every session.

## What it costs

- **The judge:** free on your own computer (about 3 GB of disk, and some memory while Claude Code is open). Jev on OpenRouter costs about $0.00004 per message, so $1 lasts a very long time.
- **Your Claude plan:** every few replies, Clutch has Haiku write a short summary of the conversation in the background (see below). Haiku is Claude's smallest model, so this is a small extra on top of normal use. Picking Haiku or Sonnet for easy messages usually saves more than that.

## How it decides

The judge reads each message and scores how much work it is, from 0 (trivial) to 4 (very hard). It is one of two small decision models: [H2O-Lightning-4B](https://huggingface.co/h2oai/h2o-lightning-4b-gguf) (open, Apache-2.0) on your computer, or Jev 1.14 (TypeSafe) on [OpenRouter](https://openrouter.ai). Either answers in well under a second.

The judge does not read messages in a vacuum. Every few replies, in the background, Haiku (at medium effort) compresses the newest part of the conversation into a short routing brief: the task, its stage, the systems in play, what just happened and what is still open. Jev reads that brief with your next message, so "ok do it" after a long plan routes as the plan, and a quick question in the middle of a hard session still routes as a quick question.

| Jev's score | `/clutch` model | Effort (both commands) |
| --- | --- | --- |
| trivial (chat, a quick fact) | Haiku 5.5 | low |
| simple (one small edit or command) | Sonnet 5.5 | medium |
| moderate (a few steps or files) | Sonnet 5.5 | high |
| hard (debugging, design, several systems) | Opus 5.5 | high |
| very hard (large, ambiguous, high-stakes) | Opus 5.5 | max |

- Jev also reads the session brief and the end of Claude's previous reply, so "yes, do it" after a big plan counts as the plan's size.
- The brief is refreshed in the background while you read the reply, so it adds no delay to your next prompt. It is rewritten after your first reply, then whenever about 2,500 characters of conversation are new or every 4 replies, whichever comes first. Each rewrite takes Haiku about 2 s, and the status line shows `✎ brief` while it runs. If you type before it is ready, Clutch waits up to 2.5 s for it, then uses the previous brief.
- Subagents keep their own model and effort.
- Messages that start with a slash command, and messages that are not typed by you, are not routed.

## The local judge

`/clutch local` (or just `/clutch` without an OpenRouter key) does everything by itself:

1. **Checks your computer:** a Mac with Apple silicon, 8 GB of memory, and about 4 GB of free disk. If it can't run the judge well, it says why and stays on Jev.
2. **Downloads two files once,** into `~/.clutch`: llama.cpp's server (16 MB, from its official GitHub release) and H2O-Lightning-4B (3.1 GB, from Hugging Face). Both are pinned to exact versions and checked against their SHA-256 before use. An interrupted download picks up where it stopped.
3. **Starts the judge** on `127.0.0.1:8749` while Claude Code is open, and stops it when you close Claude Code. Several sessions share one copy.

Until it is ready, Jev keeps rating your messages if you have a key; otherwise those messages simply use your session's own model. `/clutch local off` switches to Jev and stops the local server; the files stay on disk. To remove them, delete the `~/.clutch` folder.

## Use Jev on OpenRouter

Jev 1.14 runs on OpenRouter, so it works on any computer. You need your own key:

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys), sign in (Google or GitHub sign-in works), and click **Create key**.
2. Add a little credit at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits). $1 covers about 25,000 messages.
3. Click the copy button next to your new key, then type `/clutch key` in Claude Code. Clutch reads the key from your clipboard, saves it in a private file and checks that it works. The key is never shown in the chat and never sent to Claude.
4. If local is on, type `/clutch local off` to switch to Jev.

### Other ways to give it the key

If `/clutch key` can't read your clipboard (some Linux setups), use one of these instead.

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

The environment variable wins if both are set. Without a key, `/clutch` shows the setup steps instead of turning on.

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

Type `/clutch brief` to read the current brief. Set `CLUTCH_DEBUG=/path/to/file` before starting Claude Code to append every score, the exact text the judge saw and each brief rewrite to that file.

## Benchmark

`bench/` holds a script that tests the classifier alone, with no model answering anything: 73 hand-labelled prompts (15 trivial, 16 simple, 15 moderate, 15 hard, 12 very hard), a few of them with a previous Claude reply as context.

| | exact level | within one level | right model |
| --- | --- | --- | --- |
| Jev 1.14 (OpenRouter, ~0.3 s) | 93.2% | 100% | 94.5% |
| H2O-Lightning-4B, the local judge (~0.7 s) | 90.4% | 98.6% | 93.2% |
| prompt length only (no model) | 56.2% | 95.9% | 79.5% |

The local row ran on a MacBook Air M4 with the same Q5_K_M file and llama.cpp build Clutch downloads.

An earlier run scored 91.8% exact; one borderline prompt (score 3.45 to 3.5) flips between runs. No prompt was off by more than one level, and Jev was never too strong on the model, only too weak on 4 prompts (a hard task sent to Sonnet).

Read these numbers with care. The labels are the author's own judgement, 73 prompts is a small sample, and some of the prompts overlap the ones used while tuning the wording of the question sent to Jev. The length baseline is cut at the quantiles of this same set, which flatters it. Treat the table as a sanity check, not a guarantee.

The benchmark scores single prompts (some with a previous reply), so it measures Jev and the question wording, not the session brief.

Run it yourself (needs Python 3):

```
python3 bench/bench_router.py
```

That tests Jev (your OpenRouter key; about $0.001 in total). To test the local judge while Clutch has it running:

```
python3 bench/bench_router.py --judge local --url http://127.0.0.1:8749/v1/systemone
```

Each run prints accuracy, a confusion matrix and the misses.

## Limits

- The model picker in the UI keeps showing your session's model, because mods cannot change it. The status line shows the model and effort the router actually used.
- Switching models skips the prompt cache, so `/clutch` can cost more than `/clutch-effort` on long conversations. If cost matters more than model choice, use `/clutch-effort`.
- If the judge does not answer in time (2.5 s for Jev, 6 s for the local one) or returns an error, that turn keeps your session's model and effort, and the status line says so.
- The mode is stored once and shared by all your sessions. Running `/clutch off` in one session turns it off in the others for their next prompt.
- The judge scores difficulty from text. The brief tells it what the session is about, but it still cannot read your code.
- Refreshing the brief costs one Haiku call every few turns on your Claude account while Clutch is on.

## Privacy

With Jev, for every routed prompt Clutch sends your prompt text (up to 8,000 characters), the last 1,500 characters of Claude's previous reply and the session brief (about 110 words summarising the conversation, which can name files, services and errors) to OpenRouter, which passes them to TypeSafe's Jev model to be scored. No files or raw tool output are sent there. The brief itself is written by Haiku through your own Claude account, the same way Claude Code sends the conversation already. The request is subject to OpenRouter's and TypeSafe's terms and privacy policies. With the local judge, nothing goes to OpenRouter at all. Turn Clutch off with `/clutch off` if your prompts must not leave your machine.

## How it works

`hooks/register.ts` registers the commands, refreshes the session brief on `turn.complete` with `$.model.complete`, scores each prompt on `prompt.submit` and overrides the model and effort on the turn's main-loop requests. The types are in `types/index.d.ts`.

## License

MIT. Copyright 2026 Louis Nordbø.
