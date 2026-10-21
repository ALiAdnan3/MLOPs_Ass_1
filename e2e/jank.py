"""Smoothness benchmark: does the app stutter while you use it?

For each interaction it records main-thread tasks over 50 ms (the browser's "long task": input and
frames wait meanwhile) and the gaps between animation frames. Run against a web build:

  BENCH_URL=http://localhost:5200/ python e2e/jank.py [label]

Appends to test-results/jank.jsonl.
"""
import json
import os
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("BENCH_URL", "http://localhost:5199/") + "?e2e&quality=high"
label = sys.argv[1] if len(sys.argv) > 1 else "run"
results = {"label": label}

PROBE = """
window.__jank = { tasks: [], frames: [], on: false, last: 0 };
new PerformanceObserver((l) => { if (!window.__jank.on) return; for (const e of l.getEntries()) window.__jank.tasks.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: false });
(function f(t) { const j = window.__jank; if (j.on && j.last) j.frames.push(t - j.last); j.last = t; requestAnimationFrame(f) })(0);
"""


def start(pg):
    pg.evaluate("() => { const j = window.__jank; j.tasks = []; j.frames = []; j.last = 0; j.on = true }")


def stop(pg, name):
    d = pg.evaluate("() => { const j = window.__jank; j.on = false; return { tasks: j.tasks, frames: j.frames } }")
    fr = sorted(d["frames"])
    n = len(fr)
    r = {
        "long_tasks": len(d["tasks"]),
        "longest_task_ms": max(d["tasks"], default=0),
        "blocked_ms": sum(d["tasks"]),
        "frames": n,
        "p95_frame_ms": round(fr[int(n * 0.95)] if n else 0, 1),
        "worst_frame_ms": round(fr[-1] if n else 0, 1),
        "frames_over_50ms": sum(1 for x in fr if x > 50),
    }
    results[name] = r
    print(name, r, flush=True)


def drag(pg, box, dx, dy, steps=60, wait=16, button="left"):
    x, y = box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.55
    pg.mouse.move(x, y)
    pg.mouse.down(button=button)
    for i in range(1, steps + 1):
        pg.mouse.move(x + dx * i / steps, y + dy * i / steps)
        pg.wait_for_timeout(wait)
    pg.mouse.up(button=button)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1536, "height": 1024})
    pg.add_init_script(PROBE)
    pg.goto(URL)
    pg.wait_for_function("() => window.__jank")

    start(pg)
    pg.wait_for_selector(".dash")
    pg.wait_for_function("() => !document.querySelector('.dash-hero-wait')", timeout=120000)
    pg.wait_for_timeout(15000)
    stop(pg, "1_startup_and_idle_15s")

    start(pg)
    drag(pg, pg.locator(".dash-hero-canvas").bounding_box(), 260, 40)
    stop(pg, "2_orbit_dashboard_3d")

    start(pg)
    pg.locator("textarea[aria-label='Describe your house']").click()
    pg.keyboard.type("10 marla, 2 floors, 4 bedrooms, basement, lawn", delay=25)
    stop(pg, "3_typing")

    pg.locator(".size-grid button", has_text="1 Kanal").click()
    start(pg)
    pg.get_by_role("button", name="Generate possible designs").click()
    pg.wait_for_function("() => document.querySelectorAll('.dash-design .img[style*=\"url\"]').length >= 5", timeout=240000)
    stop(pg, "4_generate_designs")

    pg.wait_for_timeout(3000)
    start(pg)
    pg.locator(".dash-links button[aria-label='Design']").click()
    pg.wait_for_timeout(2500)
    stop(pg, "5_open_plan_editor")

    canvas = pg.locator(".pane-body canvas").first.bounding_box()
    start(pg)
    pg.mouse.move(canvas["x"] + canvas["width"] / 2, canvas["y"] + canvas["height"] / 2)
    pg.mouse.wheel(0, -300)
    pg.wait_for_timeout(300)
    drag(pg, canvas, 120, 60, button="middle")
    stop(pg, "6_plan_zoom_and_pan")

    start(pg)
    drag(pg, canvas, 50, 30)
    pg.wait_for_timeout(500)
    stop(pg, "7_plan_drag_edit")
    pg.keyboard.press("Control+z")

    start(pg)
    pg.evaluate("() => window.__hf.useUI.getState().set({ mode: '3d' })")
    pg.wait_for_timeout(2500)
    stop(pg, "8_switch_to_3d")

    start(pg)
    r3 = pg.evaluate("() => { const r = window.__hf.engine().canvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }")
    drag(pg, r3, 300, 60)
    stop(pg, "9_orbit_workspace_3d")

    start(pg)
    pg.evaluate("() => window.__hf.useUI.getState().set({ mode: 'plan' })")
    pg.wait_for_timeout(1500)
    pg.evaluate("() => window.__hf.useUI.getState().set({ mode: '3d' })")
    pg.wait_for_timeout(1500)
    stop(pg, "10_mode_switch_back_and_forth")

    start(pg)
    pg.evaluate("() => window.__hf.useUI.getState().set({ screen: 'showcase' })")
    pg.wait_for_selector(".sc-card")
    n = pg.locator(".sc-card").count()
    pg.wait_for_function(f"() => document.querySelectorAll('.sc-card img').length >= {n}", timeout=300000)
    stop(pg, "11_open_showcase")

    start(pg)
    for _ in range(12):
        pg.mouse.move(700, 600)
        pg.mouse.wheel(0, 350)
        pg.wait_for_timeout(120)
    stop(pg, "12_scroll_showcase")

    start(pg)
    pg.evaluate("() => window.__hf.useUI.getState().set({ screen: 'home' })")
    pg.wait_for_timeout(2500)
    stop(pg, "13_back_to_dashboard")
    b.close()

tot = sum(v["blocked_ms"] for k, v in results.items() if isinstance(v, dict))
results["total_blocked_ms"] = tot
print("TOTAL blocked ms", tot)
with open("test-results/jank.jsonl", "a") as f:
    f.write(json.dumps(results) + "\n")
