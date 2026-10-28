#!/usr/bin/env python3
"""Measures how much intelligence Clutch gives up: the same questions, answered with and without Clutch.

quality.json holds short questions with one right answer each, graded by code (no AI grader). Most are edge
cases on purpose: messages that look easy but are not ("Which is larger, 9.11 or 9.9?", a two-line aliasing
puzzle, the digit sum of 2^100), exactly where a router could wrongly pick Haiku. Each question runs once as a
fresh `claude -p` session per arm: "regular" (Opus, Clutch off) and "clutch" (/clutch on), in an empty folder.
Answers are not allowed tools, so the model has to know or work it out.

  python3 bench/quality_bench.py [--claude PATH] [--out results.json] [--sessions session-results.json]

With --sessions (the output of session_bench.py) it also prints the Torque index. Spends real usage.
"""
import argparse, concurrent.futures as cf, json, os, re, subprocess, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
ASK = "Answer directly, without using any tools. End your reply with one final line in the form: ANSWER: <answer>"
ASK_CODE = "Reply with only the Python code in one code block, without using any tools."


def ask(claude, item, arm, root):
    work = tempfile.mkdtemp(prefix=f"{item['id']}-{arm}-", dir=root)
    prompt = f"{item['prompt']}\n\n{ASK_CODE if 'tests' in item else ASK}"
    env = dict(os.environ, CLUTCH_MODE="off" if arm == "regular" else "auto")
    t0 = time.time()
    r = subprocess.run([claude, "-p", prompt, "--model", "opus", "--output-format", "json"],
                       cwd=work, env=env, capture_output=True, text=True, timeout=600)
    seconds = time.time() - t0
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        return {"id": item["id"], "arm": arm, "correct": False, "error": r.stderr[-300:], "cost": 0, "seconds": seconds, "models": []}
    reply = d.get("result") or ""
    return {"id": item["id"], "kind": item["kind"], "arm": arm, "correct": grade(item, reply), "reply": reply[-400:],
            "cost": d.get("total_cost_usd") or 0, "seconds": round(seconds, 1), "models": sorted(d.get("modelUsage", {}))}


def grade(item, reply):
    if "tests" in item:
        code = re.search(r"```(?:python)?\n(.*?)```", reply, re.S)
        src = (code.group(1) if code else reply) + "\n" + item["tests"] + "\nprint('ok')"
        run = subprocess.run(["python3", "-I", "-c", src], capture_output=True, text=True, timeout=20)
        return run.returncode == 0 and "ok" in run.stdout
    line = re.findall(r"ANSWER:\s*(.+)", reply, re.I)
    if not line: return False
    got = line[-1].strip().lower().replace("$", "").replace("*", "").strip(" .`'\"")
    want = item["answer"].lower()
    if re.fullmatch(r"[\d.,/]+", want):
        nums = re.findall(r"\d+(?:[.,]\d+)*", got)
        return bool(nums) and nums[0].replace(" ", "") == want
    return got == want or got.split()[0].strip(".,!") == want or got.startswith(want)


def torque(q, c, v):
    """Quality retained to the 8th power, times the geometric mean of the cost and speed gains."""
    return q ** 8 * (c * v) ** 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--claude", default="claude"); ap.add_argument("--out"); ap.add_argument("--sessions")
    args = ap.parse_args()
    items = json.load(open(os.path.join(HERE, "quality.json")))
    root = tempfile.mkdtemp(prefix="clutch-quality-")
    jobs = [(i, arm) for i in items for arm in ("regular", "clutch")]
    with cf.ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda j: ask(args.claude, j[0], j[1], root), jobs))

    def arm(a): return [r for r in res if r["arm"] == a]
    print(f"{'question':<10} {'kind':<11} {'regular':<22} {'clutch':<22}")
    for item in items:
        a = next(r for r in res if r["id"] == item["id"] and r["arm"] == "regular")
        b = next(r for r in res if r["id"] == item["id"] and r["arm"] == "clutch")
        cell = lambda r: f"{'right' if r['correct'] else 'WRONG'} {','.join(m.split('-')[1] for m in r['models'] if m.startswith('claude-')):<8} {r['seconds']:>5.1f}s"
        print(f"{item['id']:<10} {item['kind']:<11} {cell(a):<22} {cell(b):<22}")
    reg, clu = arm("regular"), arm("clutch")
    q_reg, q_clu = sum(r["correct"] for r in reg), sum(r["correct"] for r in clu)
    c_reg, c_clu = sum(r["cost"] for r in reg), sum(r["cost"] for r in clu)
    t_reg, t_clu = sum(r["seconds"] for r in reg), sum(r["seconds"] for r in clu)
    print(f"\nright: regular {q_reg}/{len(items)}, clutch {q_clu}/{len(items)}")
    print(f"cost: regular ${c_reg:.3f}, clutch ${c_clu:.3f};  time: regular {t_reg:.0f}s, clutch {t_clu:.0f}s")

    q = q_clu / max(q_reg, 1)
    if args.sessions:
        s = json.load(open(args.sessions))
        cost_r = sum(r["total"] for r in s if r["arm"] == "regular"); cost_c = sum(r["total"] for r in s if r["arm"] == "clutch")
        time_r = sum(t["seconds"] for r in s if r["arm"] == "regular" for t in r["turns"])
        time_c = sum(t["seconds"] for r in s if r["arm"] == "clutch" for t in r["turns"])
        c, v = cost_r / cost_c, time_r / time_c
        print(f"\nTorque: quality {q:.3f} x cost {c:.2f}x x speed {v:.2f}x  ->  {torque(q, c, v):.2f}")
    if args.out: json.dump(res, open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
