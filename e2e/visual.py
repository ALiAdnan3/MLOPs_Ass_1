"""Visual quality and smoothness of the 3D view, per quality preset.

Opens the sample house in the design workspace, takes pictures of the same views at each preset
and measures how smoothly the view orbits. Run against a production web build:

  npx vite build --config vite.web.config.ts && npx vite preview --config vite.web.config.ts --port 5200
  python e2e/visual.py <label> [url] [presets]

Pictures go to test-results/visual/<label>/<preset>-<view>.png; numbers to test-results/visual.jsonl.
"""
import json
import os
import sys
import time
from playwright.sync_api import sync_playwright

label = sys.argv[1] if len(sys.argv) > 1 else "run"
URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:5200/"
PRESETS = (sys.argv[3] if len(sys.argv) > 3 else "low,medium,high,ultra").split(",")
OUT = os.path.join("test-results", "visual", label)
os.makedirs(OUT, exist_ok=True)

VIEWS = ["orbit", "facade", "interior"]
LIGHTS = {"day": 15.2, "evening": None}

LIGHT_JS = """(time) => {
  window.__hf.useProject.getState().commit('light', (d) => { Object.assign(d.settings.lighting, { preset: 'custom', time: time ?? 19.0, interiorLights: true, exteriorLights: true }) });
}"""

SHOT_JS = """() => new Promise((res) => { const e = window.__hf.engine(); if (!('refined' in e)) e.invalidate(); requestAnimationFrame(() => requestAnimationFrame(() => res(e.canvas.toDataURL('image/png')))) })"""

# frame probe: counts frames the engine actually draws while the view moves
PROBE = """
window.__fp = { on: false, frames: [], last: 0 };
(function tick(t) { const f = window.__fp; if (f.on) { if (f.last) f.frames.push(t - f.last); f.last = t } requestAnimationFrame(tick) })(0);
"""


def settle(pg, timeout=60):
    """Until the view has finished refining (new engine) or a fixed wait (old engine)."""
    pg.evaluate("() => window.__hf.engine().mats.waitIdle(20000, true)")
    has = pg.evaluate("() => 'refined' in window.__hf.engine()")
    if has:
        pg.wait_for_function("() => window.__hf.engine().refined", timeout=timeout * 1000)
        pg.wait_for_timeout(200)
    else:
        pg.wait_for_timeout(3500)


results = {"label": label, "url": URL, "presets": {}}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
    for q in PRESETS:
        pg = b.new_page(viewport={"width": 1536, "height": 1024})
        pg.add_init_script(PROBE)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL + f"?e2e&quality={q}")
        pg.wait_for_selector(".dash")
        pg.wait_for_function("() => !document.querySelector('.dash-hero-wait')", timeout=120000)
        fixture = os.path.join("e2e", "fixtures", "villa.json")
        if not os.path.exists(fixture):
            # first run: generate a 1 kanal house once and keep it, so every run shows the same house
            pg.locator(".size-grid button", has_text="1 Kanal").click()
            pg.get_by_role("button", name="Generate possible designs").click()
            pg.wait_for_function("() => window.__hf.getProject().designs.length >= 1", timeout=240000)
            pg.wait_for_timeout(1500)
            os.makedirs(os.path.dirname(fixture), exist_ok=True)
            with open(fixture, "w", encoding="utf-8") as f:
                f.write(pg.evaluate("() => JSON.stringify({ ...window.__hf.getProject(), designs: [] })"))
        with open(fixture, encoding="utf-8") as f:
            pg.evaluate("(j) => window.__hf.useProject.getState().load(JSON.parse(j))", f.read())
        pg.evaluate("() => window.__hf.useUI.getState().set({ screen: 'workspace', mode: '3d' })")
        pg.wait_for_timeout(1500)
        pg.evaluate("() => window.__hf.useUI.getState().set({ mode: '3d' })")
        pg.wait_for_timeout(2500)
        r = {}
        import base64
        for ln, lt in (LIGHTS.items() if not os.environ.get("NO_PICTURES") else []):
            pg.evaluate(LIGHT_JS, lt)
            pg.wait_for_timeout(1200)
            for v in VIEWS:
                pg.evaluate(f"() => window.__hf.engine().setCameraPreset('{v}', undefined, false)")
                settle(pg)
                data = pg.evaluate(SHOT_JS)
                with open(os.path.join(OUT, f"{q}-{ln}-{v}.png"), "wb") as f:
                    f.write(base64.b64decode(data.split(",", 1)[1]))
        # smoothness: orbit the exterior for ~2.5 s
        pg.evaluate("() => window.__hf.engine().setCameraPreset('orbit', undefined, false)")
        settle(pg)
        box = pg.evaluate("() => { const r = window.__hf.engine().canvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }")
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        # count the moving frames the engine actually draws, not the page's frames
        pg.evaluate("""() => { const f = window.__fp; f.frames = []; f.last = 0; f.on = false; const e = window.__hf.engine();
          const orig = e.renderFrame.bind(e); f.restore = () => { delete e.renderFrame };
          e.renderFrame = () => { const t = performance.now(); if (f.last) f.frames.push(t - f.last); f.last = t; orig() } }""")
        t0 = time.time()
        steps = 150
        for i in range(steps):
            pg.mouse.move(cx + 300 * (i / steps), cy + 20 * (i / steps))
            pg.wait_for_timeout(16)
        pg.mouse.up()
        frames = pg.evaluate("() => { const f = window.__fp; f.restore(); return f.frames }")
        dur = time.time() - t0
        frames = [x for x in frames if x > 0]
        frames.sort()
        r["orbit_fps"] = round(len(frames) / dur, 1)
        r["frame_p50_ms"] = round(frames[len(frames) // 2], 1) if frames else None
        r["frame_p95_ms"] = round(frames[int(len(frames) * 0.95)], 1) if frames else None
        r["frame_max_ms"] = round(frames[-1], 1) if frames else None
        r["errors"] = errs[:3]
        results["presets"][q] = r
        print(q, json.dumps(r), flush=True)
        pg.close()
    b.close()

with open(os.path.join("test-results", "visual.jsonl"), "a") as f:
    f.write(json.dumps(results) + "\n")
print("pictures in", OUT)
