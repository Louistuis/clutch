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

That's it. Under the chat box you will see which Claude it picked for each message, for example `Clutch → sonnet · medium · 1.2/4 · ctx`.

| Status line piece | Meaning |
| --- | --- |
| `sonnet · medium` | the model and thinking effort this message got |
| `1.2/4` | how hard the judge rated it, from 0 (trivial) to 4 (very hard) |
| `✎ brief` | Haiku is quietly refreshing the session brief in the background |
| `ctx` | a session brief is ready and was used for this pick |
| `local` or a model name | a judge on your own computer is rating prompts instead of Jev |

Don't want OpenRouter at all? Skip steps 2 and 3 and use a free model on your own computer instead: see [Run the judge on your own computer](#run-the-judge-on-your-own-computer).

Something not working? Type `/auto status`. It tells you whether your key works, whether Clutch is on and what it picked last.

## Commands

| Type this | What happens |
| --- | --- |
| `/auto` | Clutch picks the model and how hard it thinks, for every message. |
| `/auto-effort` | Clutch picks only how hard it thinks. Your model stays the one you chose (cheaper on long chats). |
| `/auto off` | Turns Clutch off. |
| `/auto key` | Saves the OpenRouter key on your clipboard. |
| `/auto judge` | Chooses the model that rates your messages: Jev, or one on your computer. |
| `/auto brief` | Shows the session brief Haiku keeps in the background. |
| `/auto status` | Checks your key, the judge, the mode and the last pick. |
| `/auto help` | Lists these commands. |

Clutch stays on until you turn it off, in every session.

## What it costs

- **OpenRouter:** about $0.00004 per message for Jev. $1 lasts a very long time. A judge on your own computer costs nothing.
- **Your Claude plan:** every few replies, Clutch has Haiku write a short summary of the conversation in the background (see below). Haiku is Claude's smallest model, so this is a small extra on top of normal use. Picking Haiku or Sonnet for easy messages usually saves more than that.

## How it decides

The judge, Jev 1.14 by default (TypeSafe's decision model), reads each message through [OpenRouter](https://openrouter.ai) and scores how much work it is, from 0 (trivial) to 4 (very hard). One call takes about 0.3 s.

The judge does not read messages in a vacuum. Every few replies, in the background, Haiku (at medium effort) compresses the newest part of the conversation into a short routing brief: the task, its stage, the systems in play, what just happened and what is still open. Jev reads that brief with your next message, so "ok do it" after a long plan routes as the plan, and a quick question in the middle of a hard session still routes as a quick question.

| Jev's score | `/auto` model | Effort (both commands) |
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

## Run the judge on your own computer

The judge is the small model that rates each message. Jev on OpenRouter is the default, but any model on your own computer can do the job instead: free, private, no account. You need a little app that runs models locally. [Ollama](https://ollama.com) is the easiest.

**With Ollama (easiest):**

1. Install Ollama from [ollama.com/download](https://ollama.com/download) and open it.
2. In a terminal, download a judge model (about 3 GB, once):

   ```
   ollama pull hf.co/h2oai/h2o-lightning-4b-gguf:Q5_K_M
   ```

3. In Claude Code:

   ```
   /auto judge ollama hf.co/h2oai/h2o-lightning-4b-gguf:Q5_K_M
   ```

   Clutch rates two sample messages with it right away and tells you if it answers. Then type `/auto`.

**With LM Studio:** load a model, start its local server, then `/auto judge lmstudio <model name>`.

**Any OpenAI-compatible server** (llama.cpp, vLLM, a server on another machine): `/auto judge chat <url> <model>`.

**llama.cpp's decision endpoint:** a recent `llama-server` serves `/v1/systemone`, the same scoring API Jev uses, which gives a real expected score instead of a number the model writes out:

```
llama-server -hf h2oai/h2o-lightning-4b-gguf:Q5_K_M
```

then `/auto judge local` (it defaults to `http://127.0.0.1:8080`).

Notes:
- H2O-Lightning-4B is an open (Apache-2.0) decision model built for this kind of rating, which is why it is the suggestion. Other small chat models work too; `/auto judge test` and the benchmark show how well. Thinking is switched off in the request, so a reasoning model answers at once.
- A local judge gets up to 6 s per message before Clutch falls back to your session's settings. A Mac with Apple silicon answers in well under a second.
- If your server wants a key: copy it, then `/auto key judge` (or set `CLUTCH_JUDGE_KEY`).
- `/auto judge jev` switches back to Jev. The choice is remembered.

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

Type `/auto brief` to read the current brief. Set `CLUTCH_DEBUG=/path/to/file` before starting Claude Code to append every score, the exact text the judge saw and each brief rewrite to that file.

## Benchmark

`bench/` holds a script that tests the classifier alone, with no model answering anything: 73 hand-labelled prompts (15 trivial, 16 simple, 15 moderate, 15 hard, 12 very hard), a few of them with a previous Claude reply as context.

| | exact level | within one level | right model |
| --- | --- | --- | --- |
| Jev 1.14 (OpenRouter, ~0.3 s) | 93.2% | 100% | 94.5% |
| H2O-Lightning-4B, decision endpoint (local, ~0.7 s) | 90.4% | 98.6% | 93.2% |
| H2O-Lightning-4B, chat mode (local, ~0.5 s) | 90.4% | 98.6% | 94.5% |
| prompt length only (no model) | 56.2% | 95.9% | 79.5% |

The local rows ran on a MacBook Air M4 with the Q5_K_M build, through llama.cpp. Ollama and LM Studio use the same chat request but were not benchmarked here.

An earlier run scored 91.8% exact; one borderline prompt (score 3.45 to 3.5) flips between runs. No prompt was off by more than one level, and Jev was never too strong on the model, only too weak on 4 prompts (a hard task sent to Sonnet).

Read these numbers with care. The labels are the author's own judgement, 73 prompts is a small sample, and some of the prompts overlap the ones used while tuning the wording of the question sent to Jev. The length baseline is cut at the quantiles of this same set, which flatters it. Treat the table as a sanity check, not a guarantee.

The benchmark scores single prompts (some with a previous reply), so it measures Jev and the question wording, not the session brief.

Run it yourself (needs Python 3):

```
python3 bench/bench_router.py
```

That tests Jev (your OpenRouter key as above; about $0.001 in total). To test a judge on your computer instead:

```
python3 bench/bench_router.py --judge chat --url http://127.0.0.1:11434/api/chat --model hf.co/h2oai/h2o-lightning-4b-gguf:Q5_K_M
```

or `--judge local --url http://127.0.0.1:8080/v1/systemone`. Each run prints accuracy, a confusion matrix and the misses.

## Limits

- The model picker in the UI keeps showing your session's model, because mods cannot change it. The status line shows the model and effort the router actually used.
- Switching models skips the prompt cache, so `/auto` can cost more than `/auto-effort` on long conversations. If cost matters more than model choice, use `/auto-effort`.
- If the judge does not answer in time (2.5 s for Jev, 6 s for a local judge) or returns an error, that turn keeps your session's model and effort, and the status line says so.
- The mode is stored once and shared by all your sessions. Running `/auto off` in one session turns it off in the others for their next prompt.
- The judge scores difficulty from text. The brief tells it what the session is about, but it still cannot read your code.
- Refreshing the brief costs one Haiku call every few turns on your Claude account while Clutch is on.

## Privacy

For every routed prompt, Clutch sends your prompt text (up to 8,000 characters), the last 1,500 characters of Claude's previous reply and the session brief (about 110 words summarising the conversation, which can name files, services and errors) to OpenRouter, which passes them to TypeSafe's Jev model to be scored. No files or raw tool output are sent there. The brief itself is written by Haiku through your own Claude account, the same way Claude Code sends the conversation already. The request is subject to OpenRouter's and TypeSafe's terms and privacy policies. With a judge on your own computer, nothing goes to OpenRouter at all. Turn Clutch off with `/auto off` if your prompts must not leave your machine.

## How it works

`hooks/register.ts` registers the commands, refreshes the session brief on `turn.complete` with `$.model.complete`, scores each prompt on `prompt.submit` and overrides the model and effort on the turn's main-loop requests. The types are in `types/index.d.ts`.

## License

MIT. Copyright 2026 Louis Nordbø.
