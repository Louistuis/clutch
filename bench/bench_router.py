#!/usr/bin/env python3
"""Benchmarks the auto-router's classifier alone: Jev 1.14 scores labelled prompts, no LLM answers anything.

Same state, question and levels as hooks/register.ts. Labels (0-4) are hand-assigned by the author, so they carry
one person's judgement. Needs an OpenRouter key in $OPENROUTER_API_KEY or ~/.config/openrouter.key.
Usage: bench_router.py [--out results.json]
"""
import argparse, concurrent.futures as cf, json, os, statistics, time, urllib.request

URL = "https://openrouter.ai/api/alpha/decisions"
def load_key():
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if key:
        return key
    try:
        return open(os.path.expanduser("~/.config/openrouter.key")).read().strip()
    except OSError:
        raise SystemExit("Set OPENROUTER_API_KEY or put your key in ~/.config/openrouter.key")


KEY = load_key()
LEVELS = [
    "trivial: chat or a quick fact",
    "simple: one small edit or command",
    "moderate: a few steps or files",
    "hard: debugging, design or several systems",
    "very hard: large, ambiguous, high-stakes work",
]
TIER = ["haiku", "sonnet", "sonnet", "opus", "opus"]  # register.ts MODELS
NAMES = ["trivial", "simple", "moderate", "hard", "very hard"]

# (prompt, previous assistant message or None, expected level)
CASES = [
    # 0 trivial
    ("thanks!", None, 0), ("hi", None, 0), ("what does HTTP 404 mean?", None, 0),
    ("how do i say good morning in japanese", None, 0), ("what's 17% of 240", None, 0), ("ok cool", None, 0),
    ("what time zone is Oslo in", None, 0), ("lol that's funny", None, 0),
    ("what's the difference between git pull and git fetch, one sentence", None, 0), ("who created python", None, 0),
    ("nice, that worked", None, 0), ("what does the -r flag do in rm", None, 0),
    ("ok", "Done. The battery is at 58% with about 3 hours left.", 0),
    ("thanks, that's all", "Fixed: the tunnel now sends headers and body in one write, and 12 calls in a row took under 0.52 s.", 0),
    ("what's the capital of Australia", None, 0),
    # 1 simple
    ("rename the variable foo to bar in utils.py", None, 1), ("add node_modules to .gitignore", None, 1),
    ("run the tests", None, 1), ("fix the typo 'recieve' in README.md", None, 1),
    ("change the button colour to blue in styles.css", None, 1), ("install the requests package", None, 1),
    ("what's my macbook battery at", None, 1), ("show me the last 5 commits", None, 1),
    ("bump the version in package.json to 1.2.0", None, 1), ("delete the tmp folder in this repo", None, 1),
    ("make this function async: def load(): return open('a').read()", None, 1),
    ("convert this json to yaml: {\"a\":1,\"b\":[2,3]}", None, 1),
    ("add a docstring to the parse_args function", None, 1), ("restart the dev server", None, 1),
    ("yes do it", "Want me to fix the typo in the README?", 1),
    ("sure", "Want me to also add a unit test for that function?", 1),
    # 2 moderate
    ("add a dark mode toggle to the settings page", None, 2), ("write unit tests for the date utils module", None, 2),
    ("add pagination to the /users API endpoint and update the frontend list", None, 2),
    ("set up eslint and prettier for this project and fix the warnings", None, 2),
    ("add a CSV export button to the dashboard", None, 2),
    ("make a small CLI that resizes all images in a folder to 1024px", None, 2),
    ("add input validation to the signup form with error messages", None, 2),
    ("write a GitHub Actions workflow that runs the tests on every push", None, 2),
    ("migrate this React component from a class to hooks", None, 2),
    ("add a /health endpoint and a docker healthcheck", None, 2),
    ("translate the app's UI strings to Norwegian", None, 2), ("add retry with backoff to our HTTP client", None, 2),
    ("build a simple todo app with localStorage", None, 2),
    ("add caching to the weather API calls with a 10 minute TTL", None, 2),
    ("do both", "I can add the CSV export or the PDF export, or both.", 2),
    # 3 hard
    ("why does the tunnel stall POST responses for 20 seconds but GETs are fast? find the cause and fix it", None, 3),
    ("the app crashes randomly on launch on some users' Macs, figure out why", None, 3),
    ("our tests pass locally but fail in CI with a timeout, debug it", None, 3),
    ("design the database schema and API for a multiplayer leaderboard with seasons", None, 3),
    ("memory keeps climbing on the server until it OOMs after two days, find the leak", None, 3),
    ("set up a reverse tunnel from the Mac through the gateway server so the harness can reach the model, with auto-restart", None, 3),
    ("add passkey login next to the existing password auth across the web app and the Mac app", None, 3),
    ("the sync between the phone app and the server sometimes duplicates photos, find out why and fix it", None, 3),
    ("move the site from nginx on our server to a Cloudflare Worker without downtime", None, 3),
    ("profile the render loop and get the game from 30 to 60 fps", None, 3),
    ("implement end-to-end encryption for the chat archive with key rotation", None, 3),
    ("integrate Paddle billing with webhooks, subscription states and the existing user accounts", None, 3),
    ("race condition: two requests sometimes both get the last seat, fix it properly", None, 3),
    ("build a Claude Code mod that routes each prompt to a model by complexity", None, 3),
    ("why?", "The build failed: linker error, undefined symbol _OBJC_CLASS_$_SCNView, in the Release config only.", 3),
    # 4 very hard
    ("design and build a multiplayer backend for the game with rooms, matchmaking, anti-cheat and persistence, and deploy it", None, 4),
    ("rewrite the whole app from Electron to native SwiftUI with feature parity", None, 4),
    ("build a full LaTeX editor like Overleaf with real-time collaboration, compile servers and billing", None, 4),
    ("migrate all services from our two servers to a new Kubernetes cluster with zero downtime and a rollback path", None, 4),
    ("our production database got corrupted overnight, recover what you can and get the site back up", None, 4),
    ("build a Rust reimplementation of Minecraft's network protocol that vanilla clients can join", None, 4),
    ("make the AI chat site production ready: auth, rate limits, moderation, billing, monitoring and scaling to 10k users", None, 4),
    ("audit the entire codebase for security vulnerabilities and fix everything you find", None, 4),
    ("port the game engine to WebGPU and keep every existing feature working", None, 4),
    ("design a fault-tolerant distributed rate limiter across three regions with clock skew, partitions and hot keys, then implement it", None, 4),
    ("yes do it", "Plan: 1. migrate the database schema across the two servers, 2. rewrite the sync service, 3. move the tunnels, 4. cut over the live site with a rollback path. Shall I go ahead?", 4),
    ("go ahead", "I can rebuild the whole auth system with passkeys, migrate every existing user, and add an admin audit trail. Want that?", 4),
]


def ask(case):
    text, before, _ = case
    state = (f"Assistant: {before[-1500:]}\n\n" if before else "") + f"User: {text[:8000]}"
    body = json.dumps({"model": "typesafe/jev-1.14", "state": state, "questions": {"difficulty": {
        "type": "score", "instructions": "How much work is the job the user's last message asks for (including anything it agrees to)?",
        "criteria": LEVELS}}}).encode()
    req = urllib.request.Request(URL, body, {"Content-Type": "application/json", "Authorization": "Bearer " + KEY, "User-Agent": "router-bench/1"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    return d["answers"]["difficulty"]["score"], (time.time() - t) * 1000, (d.get("usage") or {}).get("cost") or 0


def spearman(a, b):
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
        while i < len(v):
            j = i
            while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]: j += 1
            for k in range(i, j + 1): r[order[k]] = (i + j) / 2
            i = j + 1
        return r
    ra, rb = ranks(a), ranks(b)
    return statistics.correlation(ra, rb)


def report(name, pred, gold):
    n = len(gold)
    exact = sum(p == g for p, g in zip(pred, gold)) / n
    near = sum(abs(p - g) <= 1 for p, g in zip(pred, gold)) / n
    tier = sum(TIER[p] == TIER[g] for p, g in zip(pred, gold)) / n
    under = sum(TIER[p] != TIER[g] and p < g for p, g in zip(pred, gold))
    over = sum(TIER[p] != TIER[g] and p > g for p, g in zip(pred, gold))
    print(f"{name:<28} exact {exact:5.1%}  within ±1 {near:5.1%}  right model {tier:5.1%}  "
          f"(too weak {under}, too strong {over})")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out"); args = ap.parse_args()
    t0 = time.time()
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(ask, CASES))
    gold = [c[2] for c in CASES]
    scores = [r[0] for r in res]
    pred = [max(0, min(4, round(s))) for s in scores]
    print(f"{len(CASES)} prompts, Jev 1.14, wall {time.time() - t0:.1f} s, cost ${sum(r[2] for r in res):.5f}, "
          f"latency p50 {statistics.median(r[1] for r in res):.0f} ms, max {max(r[1] for r in res):.0f} ms\n")
    report("Jev (router as shipped)", pred, gold)
    # Baseline with no model at all: prompt length, cut at the length quantiles of this same set (flattered: tuned on it)
    lens = [len(c[0]) + (len(c[1]) if c[1] else 0) for c in CASES]
    cuts = [sorted(lens)[int(len(lens) * q)] for q in (0.2, 0.4, 0.6, 0.8)]
    base = [sum(l > c for c in cuts) for l in lens]
    report("length only (no model)", base, gold)
    print(f"\nrank correlation with the labels: Jev {spearman(scores, gold):.2f}, length {spearman(lens, gold):.2f}")
    print(f"mean |score - label|: {statistics.mean(abs(s - g) for s, g in zip(scores, gold)):.2f} levels\n")

    print("mean Jev score per labelled level:")
    for lv in range(5):
        s = [sc for sc, g in zip(scores, gold) if g == lv]
        print(f"  {lv} {NAMES[lv]:<10} n={len(s):2}  mean {statistics.mean(s):.2f}  range {min(s):.2f}-{max(s):.2f}")
    print("\nconfusion (rows = label, columns = Jev's level):")
    print("            " + " ".join(f"{i:>4}" for i in range(5)))
    for g in range(5):
        print(f"  {g} {NAMES[g]:<9}" + " ".join(f"{sum(1 for p, gg in zip(pred, gold) if gg == g and p == c):>4}" for c in range(5)))
    print("\nmisses (label → Jev):")
    for c, s, p in zip(CASES, scores, pred):
        if p != c[2]:
            ctx = f"  [after: {c[1][:40]}…]" if c[1] else ""
            print(f"  {c[2]} → {p} ({s:.2f})  {c[0][:80]}{ctx}")
    if args.out:
        json.dump([{"prompt": c[0], "context": c[1], "label": c[2], "score": s} for c, s in zip(CASES, scores)], open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
