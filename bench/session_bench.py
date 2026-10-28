#!/usr/bin/env python3
"""Measures what Clutch saves on real Claude Code sessions, not estimates.

Each scripted session in sessions.json runs twice on a fresh copy of fixture/ (a small Python shop with one
failing test): once the way a regular user would run it (Opus, Clutch off) and once with /clutch on. The cost
of each arm is what Claude Code itself reports (total_cost_usd, at API list prices), plus Clutch's background
briefs and judge calls, which Claude Code does not count. At the end both copies must pass their tests, so a
cheaper arm that broke the project shows up.

  python3 bench/session_bench.py [--claude PATH] [--out results.json] [--only build,debug]

Spends real usage: every session runs twice on your Claude account. Needs Clutch installed and a judge
(an OpenRouter key, or /clutch local).
"""
import argparse, concurrent.futures as cf, json, os, re, shutil, subprocess, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
JEV_COST = 0.00002  # measured: $0.00115 for 73 Jev calls


def run_arm(claude, name, prompts, arm, root):
    work = os.path.join(root, f"{name}-{arm}")
    shutil.copytree(os.path.join(HERE, "fixture"), work)
    log = os.path.join(root, f"{name}-{arm}.clutch.log")
    env = dict(os.environ, CLUTCH_DEBUG=log)
    p = subprocess.Popen([claude, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                          "--model", "opus", "--permission-mode", "bypassPermissions"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd=work, env=env)
    turns, cost, started = [], 0.0, time.time()

    def send(text):
        nonlocal cost
        p.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n")
        p.stdin.flush()
        models, t0 = set(), time.time()
        for line in p.stdout:
            e = json.loads(line)
            if e.get("type") == "assistant" and not e.get("parent_tool_use_id"):
                m = e["message"].get("model")
                if m and m != "<synthetic>": models.add(m)
            if e.get("type") == "result":
                c = e.get("total_cost_usd") or 0
                # Each result reports the session so far; keep the turn's own share
                turn_cost = max(0.0, c - cost) if c >= cost else c
                cost = max(cost, c)
                return {"prompt": text, "models": sorted(models), "cost": turn_cost, "reported": c, "seconds": round(time.time() - t0, 1)}

    # The arm is set per project folder, so both arms can run at once
    send("/clutch project off" if arm == "regular" else "/clutch project auto")
    for text in prompts:
        turns.append(send(text))
    p.stdin.close(); p.wait()

    tests = subprocess.run(["python3", "-m", "unittest"], cwd=work, capture_output=True, text=True)
    passed = tests.returncode == 0
    ran = re.search(r"Ran (\d+) test", tests.stderr)
    extra = open(log).read() if os.path.exists(log) else ""
    brief = sum(float(x) for x in re.findall(r"brief rewritten in \d+ ms, \$([\d.]+)", extra))
    judge = len(re.findall(r"^=== Jev:", extra, re.M)) * JEV_COST
    return {"session": name, "arm": arm, "turns": turns, "claude_cost": cost, "brief_cost": brief, "judge_cost": judge,
            "total": cost + brief + judge, "minutes": round((time.time() - started) / 60, 1),
            "tests_pass": passed, "tests_ran": int(ran.group(1)) if ran else 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--claude", default="claude")
    ap.add_argument("--out")
    ap.add_argument("--only")
    args = ap.parse_args()
    sessions = json.load(open(os.path.join(HERE, "sessions.json")))
    if args.only: sessions = {k: v for k, v in sessions.items() if k in args.only.split(",")}
    root = tempfile.mkdtemp(prefix="clutch-bench-")
    jobs = [(n, p, arm) for n, p in sessions.items() for arm in ("regular", "clutch")]
    with cf.ThreadPoolExecutor(len(jobs)) as ex:
        results = list(ex.map(lambda j: run_arm(args.claude, j[0], j[1], j[2], root), jobs))

    for name in sessions:
        reg = next(r for r in results if r["session"] == name and r["arm"] == "regular")
        clu = next(r for r in results if r["session"] == name and r["arm"] == "clutch")
        print(f"\n== {name} ({len(sessions[name])} messages)")
        for r in (reg, clu):
            print(f"  {r['arm']:<8} ${r['total']:.3f}  (Claude ${r['claude_cost']:.3f}, briefs ${r['brief_cost']:.4f}, judge ${r['judge_cost']:.4f})"
                  f"  {r['minutes']} min  tests {'pass' if r['tests_pass'] else 'FAIL'} ({r['tests_ran']})")
        for a, b in zip(reg["turns"], clu["turns"]):
            print(f"    {a['prompt'][:52]:<52} regular ${a['cost']:.3f} {','.join(m.split('-')[1] for m in a['models'])}"
                  f"  | clutch ${b['cost']:.3f} {','.join(m.split('-')[1] for m in b['models'])}")
    reg_total = sum(r["total"] for r in results if r["arm"] == "regular")
    clu_total = sum(r["total"] for r in results if r["arm"] == "clutch")
    print(f"\nAll sessions: regular ${reg_total:.3f}, Clutch ${clu_total:.3f}: "
          f"{reg_total / max(clu_total, 1e-9):.2f}x cheaper ({(1 - clu_total / max(reg_total, 1e-9)) * 100:.0f}% less)")
    print(f"work folders: {root}")
    if args.out: json.dump(results, open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
