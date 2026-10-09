"""Performance benchmark of the user-facing waits. Run against `npm run web` (port 5199):

  python e2e/bench.py [label]

Prints and appends to test-results/bench.jsonl: dashboard start-up, the sample house appearing,
the dashboard's pictures, generating five designs and their cards, and filling the Home Showcase.
"""
import json
import os
import sys
import time
from playwright.sync_api import sync_playwright

label = sys.argv[1] if len(sys.argv) > 1 else "run"
out = {"label": label}

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1536, "height": 1024})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    t0 = time.time()
    pg.goto(os.environ.get("BENCH_URL", "http://localhost:5199/") + "?e2e&quality=high")
    pg.wait_for_selector(".dash")
    out["dashboard_visible_s"] = round(time.time() - t0, 2)
    pg.wait_for_function("() => !document.querySelector('.dash-hero-wait')", timeout=120000)
    out["sample_house_s"] = round(time.time() - t0, 2)
    pg.wait_for_function("() => document.querySelector('.dash-tiles .dash-tile:nth-child(2) .dash-tile-img').style.backgroundImage && document.querySelector('.fin-preview').style.backgroundImage && document.querySelector('.dash-video').style.backgroundImage", timeout=120000)
    out["dashboard_pictures_s"] = round(time.time() - t0, 2)
    out["js_heap_mb"] = round(pg.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize / 1e6 : 0"), 1)

    pg.locator(".size-grid button", has_text="1 Kanal").click()
    t1 = time.time()
    pg.get_by_role("button", name="Generate possible designs").click()
    pg.wait_for_function("() => window.__hf.getProject().designs.length >= 5", timeout=240000)
    out["generate_5_designs_s"] = round(time.time() - t1, 2)
    pg.wait_for_function("() => document.querySelectorAll('.dash-design .img[style*=\"url\"]').length >= 5", timeout=240000)
    out["design_cards_s"] = round(time.time() - t1, 2)
    pg.wait_for_timeout(4000)

    t2 = time.time()
    pg.evaluate("() => window.__hf.useUI.getState().set({ screen: 'showcase' })")
    pg.wait_for_selector(".sc-card")
    n = pg.locator(".sc-card").count()
    pg.wait_for_function("() => document.querySelector('.sc-hero img')", timeout=300000)
    out["showcase_hero_s"] = round(time.time() - t2, 2)
    pg.wait_for_function(f"() => document.querySelectorAll('.sc-card img').length >= {n}", timeout=300000)
    out["showcase_all_s"] = round(time.time() - t2, 2)
    out["showcase_pictures"] = n
    out["per_picture_ms"] = round((time.time() - t2) * 1000 / (n + 1))
    # switching the rooms' light re-renders the interiors
    t3 = time.time()
    pg.locator(".sc-toggle", has_text="Rooms").locator("button", has_text="Evening").click()
    pg.wait_for_timeout(300)
    pg.wait_for_function(f"() => document.querySelectorAll('.sc-card img').length >= {n}", timeout=300000)
    out["showcase_relight_rooms_s"] = round(time.time() - t3, 2)
    # opening an area: the large picture
    t4 = time.time()
    pg.locator(".sc-card", has_text="Kitchen").first.click()
    pg.wait_for_selector(".sc-stage img", timeout=60000)
    out["viewer_first_picture_s"] = round(time.time() - t4, 2)
    pg.wait_for_selector(".sc-stage img:not(.sc-preview)", timeout=60000)
    out["viewer_full_detail_s"] = round(time.time() - t4, 2)
    out["js_heap_end_mb"] = round(pg.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize / 1e6 : 0"), 1)
    out["errors"] = errs[:3]
    b.close()

print(json.dumps(out, indent=1))
with open("test-results/bench.jsonl", "a") as f:
    f.write(json.dumps(out) + "\n")
