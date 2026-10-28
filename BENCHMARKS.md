# Clutch benchmarks and the Torque index

Clutch makes one promise: spend much less, wait no longer, and get answers that are just as good. This page tests all three, explains exactly how, and shows every raw number. Nothing here is estimated unless it says so.

All tests ran on 28 October 2026 with Clutch 1.5, Claude Code 2.1.308, Jev 1.14 on OpenRouter as the judge, and the session brief on. The "regular" side of every comparison is what a typical Claude Code user runs: Claude Opus 5.5 at its default effort, no Clutch.

## The Torque index

Three numbers, folded into one.

| Part | What it measures | How it is computed | 1.0 means |
| --- | --- | --- | --- |
| **Q**, quality retained | Is Clutch as smart as Opus alone? | right answers with Clutch ÷ right answers without | no intelligence lost |
| **C**, cost gain | How much cheaper is it? | cost without Clutch ÷ cost with Clutch | same cost |
| **V**, speed gain | Is it any faster? | time without Clutch ÷ time with Clutch | same speed |

**Torque = Q⁸ × √(C × V)**

- **Why Q to the 8th power:** the goal is near-zero intelligence loss, so losing intelligence has to hurt far more than saving money helps. Every 1% of answers lost takes about 8% off the score. A 5% loss cuts Torque by a third, and a 10% loss more than halves it, whatever the savings.
- **Why the square root of C × V:** money and time count equally. The geometric mean means a gain in one cannot hide a loss in the other: twice as cheap but half as fast scores 1.0.
- **Reading it:** above 1 means Clutch is worth having on, and 1 means it changes nothing. Below 1, you are better off without it.

## Results

| Workload | Q | C | V | **Torque** |
| --- | --- | --- | --- | --- |
| Real coding sessions (test 1) | 1.00 | 1.33× | 0.84× | **1.06** |
| Single questions (test 2) | 1.00 | 8.6× | 1.04× | **2.99** |

In plain words:
- **In real coding sessions,** Clutch cut the bill by 25%, and both projects ended with every test passing. Speed was slower overall, but one slow API reply caused most of that (explained below).
- **On single questions,** including 11 trick questions built to catch a router that picks a weak model, Clutch got every answer right, for about a ninth of the cost.
- **No intelligence loss was measured.** Read the limits at the end before you trust that too far.

## Test 1: real coding sessions (cost, speed and outcome)

**What it shows:** what Clutch saves on the kind of work people actually do in Claude Code, and whether the work still comes out right.

**How it was done:**
1. **The project:** `bench/fixture/` is a tiny Python shop (a cart with a volume discount, an inventory, three tests). One test fails on purpose, because the discount uses `>` where it should use `>=`.
2. **The sessions:** `bench/sessions.json` holds two scripted sessions written the way people really type: "hi! can you look at this project…", "run the tests", "why?", "ok do it", "thanks". The **build** session has 10 messages (fix a bug, add a feature with a test, rename a function, write a CLI script), and the **debug** session has 8 (find a discount bug, explain it, fix it with tests, plan and build multi-currency support, write a README).
3. **Two runs each:** every session ran twice, at the same time, each on its own fresh copy of the project, as one continuous Claude Code session (`claude -p --input-format stream-json`), with Opus as the session model and full permissions so it could edit and run code. The regular run had Clutch off, and the Clutch run had `/clutch` on.
4. **Cost:** the price Claude Code itself reports for each run (`total_cost_usd`, at API list prices, prompt-cache reads and writes included), plus what Clutch spends that Claude Code does not count: the session briefs (Haiku) and the judge (Jev). Those two came to $0.0026 in total.
5. **Speed:** wall-clock time from sending each message to the end of Claude's reply.
6. **Outcome:** after the last message, the project's own test suite runs (`python3 -m unittest`). A cheaper run that broke the project would show up here.

**Results:**

**build session** (10 messages)

| # | Message | Regular | Clutch |
| --- | --- | --- | --- |
| 1 | hi! can you look at this project and tell me in two lines what it does? | Opus, $0.268, 14 s | Sonnet, $0.132, 24 s |
| 2 | run the tests | Opus, $0.034, 7 s | Sonnet, $0.016, 7 s |
| 3 | one test fails, find out why and fix it | Opus, $0.032, 6 s | Sonnet, $0.036, 18 s |
| 4 | thanks | Opus, $0.012, 2 s | Haiku, $0.006, 62 s |
| 5 | add a function to inventory.py that returns the items below a stock threshold, with a test | Opus, $0.044, 10 s | Sonnet, $0.036, 11 s |
| 6 | what's the difference between a list and a tuple in python? one line | Opus, $0.015, 2 s | Haiku, $0.001, 5 s |
| 7 | rename the function total_price to cart_total everywhere | Opus, $0.053, 10 s | Sonnet, $0.029, 18 s |
| 8 | ok run the tests again | Opus, $0.030, 4 s | Sonnet, $0.015, 3 s |
| 9 | add a small CLI script that prints a low-stock report | Opus, $0.044, 10 s | Sonnet, $0.022, 7 s |
| 10 | nice, thanks! | Opus, $0.013, 2 s | Haiku, $0.001, 5 s |
| | **Total** | **$0.545, 67 s, tests pass (6)** | **$0.294, 160 s, tests pass (6)** |

**debug session** (8 messages)

| # | Message | Regular | Clutch |
| --- | --- | --- | --- |
| 1 | the discount calculation feels wrong for orders of exactly 500, check cart.py | Opus, $0.275, 18 s | Sonnet, $0.147, 19 s |
| 2 | why? | Opus, $0.021, 8 s | Haiku, $0.006, 6 s |
| 3 | ok fix it and add tests for the edge cases | Opus, $0.061, 16 s | Sonnet, $0.027, 14 s |
| 4 | how would you add multi-currency support to the cart? just a short plan, no code | Opus, $0.028, 10 s | Sonnet, $0.013, 8 s |
| 5 | ok do it | Opus, $0.337, 90 s | Opus, $0.474, 60 s |
| 6 | run the tests | Opus, $0.048, 8 s | Opus, $0.046, 5 s |
| 7 | cool | Opus, $0.017, 3 s | Haiku, $0.008, 2 s |
| 8 | write a short README.md section about currencies | Opus, $0.099, 24 s | Sonnet, $0.062, 19 s |
| | **Total** | **$0.886, 178 s, tests pass (17)** | **$0.785, 132 s, tests pass (24)** |


| | Regular | Clutch | Gain |
| --- | --- | --- | --- |
| Cost, both sessions | $1.432 | $1.078 | **1.33× cheaper** (25% less) |
| Time, both sessions | 245 s | 292 s | **0.84×** (slower) |
| Tests at the end | pass (6 and 17) | pass (6 and 24) | same outcome |

**What the numbers say:**
- **Where the savings come from:** most messages ran on Sonnet or Haiku at about half the price or less, including the first look at the project, the test runs and the small talk. Clutch moved up to Opus once, for "ok do it" on the multi-currency plan, the biggest job of the run. That message cost more with Clutch ($0.474 against $0.337), because that run did more: it ended with 24 tests where the regular run had 17.
- **The slow outlier:** with Clutch, "thanks" took 62 s. The session's own log shows Claude Code sent that request at 14:04:41 and Haiku's two-line answer arrived at 14:05:43, so the API was slow and Clutch's hooks added no delay. Leave that one message out of both runs and the times are 230 s for Clutch against 243 s regular (1.06× faster). The table keeps it in, because you would have waited for it too.
- **Sonnet is sometimes slower than Opus** at agentic steps in this test (the first look at the project took 24 s against 14 s). Speed is noisy with this few messages.

## Test 2: single questions (intelligence)

**What it shows:** whether routing costs intelligence. The danger of any router is a message that looks easy, gets sent to a small model, and comes back wrong. So most of this test is exactly that kind of message.

**How it was done:**
1. **The questions:** `bench/quality.json` holds 16 questions with one right answer each:
   - 4 **easy** questions, as controls (17 × 23, a capital city).
   - 6 **traps** that catch fast or careless answers: 9.11 vs 9.9, counting letters, the bat-and-ball puzzle, a syllogism, Python list aliasing, JavaScript's string sort.
   - 5 **short but hard** questions that need real working out: whether 1,000,003 is prime, the digit sum of 2^100, the trailing zeros of 100!, domino tilings, a probability.
   - 1 **code** task: write `is_balanced(s)`, graded by hidden tests.
2. **Two runs each:** every question ran once with Clutch off and once with Clutch on, each in a fresh `claude -p` session in an empty folder, with Opus as the session model. The model was told not to use tools, so it could not run code to get the answer, and to end with a line `ANSWER: <answer>`.
3. **Grading, by code only, with no AI grader:** the `ANSWER:` line is compared with the known answer (numbers by value, words exactly), and the code task runs against hidden tests in a separate Python process. Everything is in `bench/quality_bench.py`.
4. **Cost and speed:** as in test 1, from Claude Code's own reported cost and the wall-clock time.

**Results:**

| Question | Kind | Right answer | Regular | Clutch |
| --- | --- | --- | --- | --- |
| What is 17 times 23? | easy | 391 | right, Opus, $0.203, 12 s | right, Haiku, $0.009, 14 s |
| What is the capital of Australia? | easy | canberra | right, Opus, $0.203, 12 s | right, Haiku, $0.009, 11 s |
| What weekday was 1 January 2000? | easy | saturday | right, Opus, $0.210, 9 s | right, Haiku, $0.005, 9 s |
| In Python, what does print(0.1 + 0.2 == 0.3) print? | easy | false | right, Opus, $0.213, 9 s | right, Haiku, $0.005, 8 s |
| Which is larger, 9.11 or 9.9? | trap | 9.9 | right, Opus, $0.211, 13 s | right, Haiku, $0.005, 12 s |
| How many times does the letter r appear in "strawberry raspberry"? | trap | 6 | right, Opus, $0.212, 12 s | right, Haiku, $0.005, 10 s |
| A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. How many cents does the ball cost? | trap | 5 | right, Opus, $0.206, 9 s | right, Haiku, $0.005, 9 s |
| All bloops are razzies and some razzies are lazzies. Must some bloops be lazzies? Yes or no? | trap | no | right, Opus, $0.213, 11 s | right, Haiku, $0.005, 9 s |
| In Python: x = [1, 2, 3]; y = x; y += [4]. What is len(x)? | trap | 4 | right, Opus, $0.214, 8 s | right, Haiku, $0.005, 8 s |
| What does JavaScript print for console.log([10, 1, 2].sort().join(','))? | trap | 1,10,2 | right, Opus, $0.215, 11 s | right, Haiku, $0.005, 9 s |
| Is 1000003 prime? Yes or no. | hard-short | yes | right, Opus, $0.212, 8 s | right, Haiku, $0.005, 7 s |
| What is the sum of the digits of 2^100? Work it out without running code. | hard-short | 115 | right, Opus, $0.217, 9 s | right, Sonnet, $0.204, 12 s |
| How many trailing zeros does 100! have? | hard-short | 24 | right, Opus, $0.213, 9 s | right, Haiku, $0.005, 8 s |
| In how many ways can a 2 by 10 board be tiled with 1 by 2 dominoes? | hard-short | 89 | right, Opus, $0.216, 10 s | right, Haiku, $0.006, 9 s |
| What is the probability of at least one six in four rolls of a fair die, to 3 decimals? | hard-short | 0.518 | right, Opus, $0.213, 9 s | right, Haiku, $0.005, 8 s |
| Write a Python function is_balanced(s) that returns True when every (, [ and { in s is closed in the right order, ignoring other characters. | code | passes the hidden tests | right, Opus, $0.212, 7 s | right, Sonnet, $0.106, 9 s |

| | Regular | Clutch | Gain |
| --- | --- | --- | --- |
| Right answers | 16 / 16 | 16 / 16 | **Q = 1.00** |
| Cost | $3.383 | $0.393 | **8.6× cheaper** |
| Time | 158 s | 152 s | **1.04× faster** |

**What the numbers say:**
- **Clutch picked Haiku for 13 of the 16 questions,** Sonnet for the 2^100 digit sum and the code task, and got every one right. Haiku 5.5 handled every trap.
- **The cost gap is this large because each question was a fresh session,** so most of the price is Claude Code reading its own setup for the first time, and that costs forty times less on Haiku than on Opus. In a long session that setup is cached, which is why test 1 saves less.

## Test 3: the judge alone

**What it shows:** how well the judge rates difficulty, with no Claude model answering anything. It is the quickest and cheapest check, and `bench/bench_router.py` runs it.

**How it was done:** 73 prompts, each labelled by hand from 0 (trivial) to 4 (very hard), with 12 to 16 at each level and a few that include Claude's previous reply as context. The judge scores each one with exactly the request Clutch sends, and the score is compared with the label.

| Judge | Exact level | Within one level | Right model |
| --- | --- | --- | --- |
| Jev 1.14 (OpenRouter, ~0.3 s) | 93.2% | 100% | 94.5% |
| H2O-Lightning-4B, the local judge (~0.7 s) | 90.4% | 98.6% | 93.2% |
| Prompt length only (no model) | 56.2% | 95.9% | 79.5% |

When Jev was wrong about the model, it always picked one too weak (4 prompts, all a hard task sent to Sonnet), never one too strong.

## Limits: read these before quoting the numbers

- **Small samples:** 18 session messages, 16 questions and 73 judge prompts, each run once. One flipped answer moves Q by 6%. These results show Clutch works as intended; they do not prove the exact figures.
- **No intelligence loss was measured, but that is not proof there is none.** Harder questions than these, or long multi-step reasoning, could separate Haiku from Opus where these did not.
- **The labels and questions were written by the author** of Clutch, and some judge prompts overlap the ones used to tune it.
- **Speed depends on the API's load** at the time. One slow reply moved test 1's speed from 1.06× to 0.84×.
- **API prices, not plan usage:** on a Pro or Max plan the same ratios apply to your usage limits, not your bill.
- **The cost of running these tests** was about $6.30 at API prices, mostly the Opus side.

## Run them yourself

Each test spends real usage on your Claude account, except test 3.

```
python3 bench/session_bench.py --out sessions.json
python3 bench/quality_bench.py --sessions sessions.json --out quality.json
python3 bench/bench_router.py
```

The first two need Clutch installed and a judge (an OpenRouter key or `/clutch local`); they set `CLUTCH_MODE` or a per-project mode for each side, so your own settings are not touched. The raw results of the runs above are in `bench/results-sessions.json` and `bench/results-quality.json`.
