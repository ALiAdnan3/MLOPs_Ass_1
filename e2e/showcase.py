"""Home Showcase (amendment A9) functional check. Run against `npm run web` (port 5199):

  python e2e/showcase.py
"""
import sys
import time
from playwright.sync_api import sync_playwright

res = []


def check(name, ok, info=''):
    res.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name, info)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1536, "height": 1024}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto("http://localhost:5199/?e2e&quality=medium")
    pg.wait_for_load_state("networkidle")
    pg.locator(".size-grid button", has_text="1 Kanal").click()
    pg.get_by_role("button", name="Generate possible designs").click()
    pg.wait_for_function("() => window.__hf.getProject().designs.length >= 5", timeout=240000)
    pg.wait_for_timeout(1000)
    pg.locator(".dash-links button", has_text="Showcase").click()
    pg.wait_for_selector(".sc-gallery .sc-card")
    titles = pg.locator(".sc-card b").all_inner_texts()
    for want in ["Kitchen", "TV Lounge", "Master Bedroom", "Master Bath", "Garage", "Front elevation"]:
        check(f"area: {want}", any(t.startswith(want) for t in titles))
    check("key features listed", pg.locator(".sc-feature").count() >= 6, pg.locator(".sc-feature b").all_inner_texts())
    check("plot size", "500 sq yds" in pg.locator(".sc-plot").inner_text())
    n = pg.locator(".sc-card").count()
    t0 = time.time()
    pg.wait_for_function(f"() => document.querySelectorAll('.sc-card img').length >= {n}", timeout=300000)
    check(f"{n} area pictures rendered", True, f"{round(time.time() - t0)} s")
    pg.locator(".sc-chips button", has_text="Bathrooms").click()
    baths = pg.locator(".sc-card b").all_inner_texts()
    check("bathrooms filter", len(baths) >= 3 and all("Bath" in t or "Powder" in t for t in baths), baths)
    pg.locator(".sc-chips button", has_text="All areas").click()
    pg.locator(".sc-card", has_text="Kitchen").first.click()
    pg.wait_for_selector(".sc-stage img", timeout=60000)
    check("viewer opens", pg.locator(".sc-viewer header b").inner_text() == "Kitchen")
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(300)
    check("next area", pg.locator(".sc-viewer header b").inner_text() != "Kitchen")
    pg.get_by_role("button", name="Look around in 3D").click()
    pg.wait_for_timeout(2000)
    check("look around inside the room", pg.evaluate("() => !!document.querySelector('.sc-live canvas') && window.__hf.engine().cameraInside()"))
    pg.get_by_role("button", name="Make AI photo").click()
    pg.wait_for_timeout(600)
    check("AI photo explains it needs the desktop app", "desktop app" in " ".join(pg.locator(".toast").all_inner_texts()))
    pg.get_by_role("button", name="Open in 3D editor").click()
    pg.wait_for_timeout(1200)
    check("open in 3D editor", pg.evaluate("() => [window.__hf.useUI.getState().screen, window.__hf.useUI.getState().mode]") == ['workspace', '3d'])
    pg.evaluate("() => window.__hf.useUI.getState().set({ screen: 'showcase' })")
    pg.wait_for_selector(".sc-card img")
    # adding an AI photo-like concept image must not re-render the gallery
    before = pg.evaluate("() => [...document.querySelectorAll('.sc-card img')].map(i => i.src).join()")
    pg.evaluate("() => window.__hf.useProject.getState().commit('rename', d => { d.name = d.name + ' x' })")
    pg.wait_for_timeout(800)
    after = pg.evaluate("() => [...document.querySelectorAll('.sc-card img')].map(i => i.src).join()")
    check("pictures kept across unrelated edits", before == after)
    with pg.expect_download(timeout=300000) as d:
        pg.get_by_role("button", name="Save brochure (PDF)").click()
    path = "test-results/sc-brochure.pdf"
    d.value.save_as(path)
    with open(path, "rb") as fh:
        head = fh.read(5)
    check("brochure PDF", head == b"%PDF-")
    check("no console errors", not errs, errs[:3])
    b.close()
print(sum(res), "/", len(res), "passed")
sys.exit(0 if all(res) else 1)
