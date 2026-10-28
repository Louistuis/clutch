# auto-router

A [Claude Code](https://claude.com/claude-code) mod that picks the model and the thinking effort for each prompt you type, so a "thanks!" does not run on Opus at max effort and a hard debugging session does not run on Haiku.

Jev 1.14, TypeSafe's decision model, reads each prompt through [OpenRouter](https://openrouter.ai) and scores how much work it is. The router then sets that turn to match. One call takes about 0.3 s and costs about $0.00004.

## Commands

| Command | What it does |
| --- | --- |
| `/auto` | Jev picks the model and the effort for every prompt. |
| `/auto-effort` | Jev picks only the effort. Your model stays as you chose it, and so does its prompt cache. |
| `/auto off` | Stops either mode. |

Each command turns its mode on and switches the other off. The setting is remembered across sessions, and the status line shows each pick, for example `/auto → sonnet · medium · 1.2/4`.

## How it routes

| Jev's score | `/auto` model | Effort (both commands) |
| --- | --- | --- |
| trivial (chat, a quick fact) | Haiku 5.5 | low |
| simple (one small edit or command) | Sonnet 5.5 | medium |
| moderate (a few steps or files) | Sonnet 5.5 | high |
| hard (debugging, design, several systems) | Opus 5.5 | high |
| very hard (large, ambiguous, high-stakes) | Opus 5.5 | max |

- Jev also reads the end of Claude's previous reply, so "yes, do it" after a big plan counts as the plan's size.
- Subagents keep their own model and effort.
- Prompts that start with a slash command, and messages that are not typed by you, are not routed.

## Install

Inside Claude Code:

```
/plugin marketplace add Louistuis/claude-code-auto-router
/plugin install auto-router@auto-router
```

Or from a shell:

```
claude plugin marketplace add Louistuis/claude-code-auto-router
claude plugin install auto-router@auto-router
```

Then start a new session, or run `/reload-plugins`, and type `/auto` or `/auto-effort`.

## Set your OpenRouter key

You bring your own key. Create one at [openrouter.ai/keys](https://openrouter.ai/keys) and add a little credit (each prompt costs about $0.00004, so $1 covers roughly 25,000 prompts). Then use either:

```
export OPENROUTER_API_KEY=YOUR_KEY
```

or a file that only you can read:

```
mkdir -p ~/.config
printf '%s\n' 'YOUR_KEY' > ~/.config/openrouter.key
chmod 600 ~/.config/openrouter.key
```

The environment variable wins if both are set. Without a key, the router does nothing and your session settings are used.

## Benchmark

`bench/` holds a script that tests the classifier alone, with no model answering anything: 73 hand-labelled prompts (15 trivial, 16 simple, 15 moderate, 15 hard, 12 very hard), a few of them with a previous Claude reply as context.

| | exact level | within one level | right model |
| --- | --- | --- | --- |
| Jev 1.14 | 93.2% | 100% | 94.5% |
| prompt length only (no model) | 56.2% | 95.9% | 79.5% |

An earlier run scored 91.8% exact; one borderline prompt (score 3.45 to 3.5) flips between runs. No prompt was off by more than one level, and Jev was never too strong on the model, only too weak on 4 prompts (a hard task sent to Sonnet).

Read these numbers with care. The labels are the author's own judgement, 73 prompts is a small sample, and some of the prompts overlap the ones used while tuning the wording of the question sent to Jev. The length baseline is cut at the quantiles of this same set, which flatters it. Treat the table as a sanity check, not a guarantee.

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
- Jev scores difficulty from the text alone. It cannot know that a short prompt touches a risky part of your code.

## Privacy

For every routed prompt, the router sends your prompt text (up to 8,000 characters) and the last 1,500 characters of Claude's previous reply to OpenRouter, which passes them to TypeSafe's Jev model to be scored. Nothing else is sent: no files, tool output or earlier history. The request is subject to OpenRouter's and TypeSafe's terms and privacy policies. Turn the router off with `/auto off` if your prompts must not leave your machine.

## How it works

`hooks/register.ts` registers the two commands, scores each prompt on `prompt.submit` and overrides the model and effort on the turn's main-loop requests. The types are in `types/index.d.ts`.

## License

MIT. Copyright 2026 Louis Nordbø.
