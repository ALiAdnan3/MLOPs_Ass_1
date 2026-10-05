"""Dashboard (home screen) functional check: every control on the reference-v2 dashboard.
Run against `npm run web` (port 5199): python e2e/dashboard.py
"""
import sys
from playwright.sync_api import sync_playwright

UI = "window.__hf.useUI.getState()"
ROOM = "window.__hf.getProject().floors.flatMap(f => f.rooms).find(r => r.id === RID)"
BB = "(r => { const xs = r.polygon.map(q=>q.x), ys = r.polygon.map(q=>q.y); return [Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys), r.ceilingHeight] })"
res = []


def check(name, ok, info=''):
    res.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name, info)


def home(pg):
    pg.evaluate("() => " + UI + ".set({ screen: 'home' })")
    pg.wait_for_timeout(1500)


def ui(pg, expr):
    return pg.evaluate("() => { const s = " + UI + "; return " + expr + " }")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1536, "height": 1024})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto("http://localhost:5199/?e2e&quality=medium")
    pg.wait_for_load_state("networkidle")
    pg.wait_for_timeout(2000)

    # setup panel
    pg.locator(".custom-size input").check()
    pg.wait_for_timeout(300)
    check("custom size shows fields", pg.locator(".custom-size-fields").count() == 1)
    pg.locator(".size-grid button", has_text="10 Marla").click()
    check("preset clears custom", pg.locator(".custom-size-fields").count() == 0)
    pg.get_by_label("Bedrooms").select_option("4")
    pg.locator(".req-checks label", has_text="Pillars").locator("input").check()
    pg.get_by_role("button", name="Generate possible designs").click()
    pg.wait_for_function("() => window.__hf.getProject().designs.length >= 5", timeout=240000)
    pg.wait_for_timeout(1500)
    d = pg.evaluate("() => { const p = window.__hf.getProject(); return { styles: p.designs.map(d => d.house.exterior.style), beds: p.requirements.rooms.bedrooms, pillars: !!p.requirements.special.pillars, entrance: !!p.exterior.entrancePillars, style: p.exterior.style } }")
    check("5 designs in 5 styles", len(set(d['styles'])) == 5, d['styles'])
    check("luxury villa loaded first", d['style'] == 'luxury')
    check("requirements carried (4 bed, pillars)", d['beds'] == 4 and d['pillars'] and d['entrance'], d)

    pg.locator(".dash-design", has_text="Classic Elegance").get_by_role("button", name="Select").click()
    pg.wait_for_timeout(1500)
    check("select design", pg.evaluate("() => window.__hf.getProject().exterior.style") == 'european')

    rid = pg.evaluate("() => document.querySelector('.room-pick select').value")
    room = ROOM.replace("RID", "'" + rid + "'")
    pg.locator(".fin-swatch", has_text="Black Marble").click()
    pg.wait_for_timeout(500)
    fm = pg.evaluate("() => " + room + ".floorMaterial")
    check("swatch applies to room floor", fm == 'lib:marble-nero', fm)
    pg.locator(".dash-card", has_text="Materials & Finishes").get_by_role("radio", name="Walls").click()
    pg.locator(".fin-swatch", has_text="Grey Stone").click()
    pg.wait_for_timeout(400)
    wm = pg.evaluate("() => " + room + ".wallMaterial")
    check("swatch applies to walls", wm == 'lib:stone-slate', wm)

    before = pg.evaluate("() => " + BB + "(" + room + ")")
    pg.locator(".dims-card .dim-num").nth(2).fill("11")
    pg.wait_for_timeout(200)
    pg.get_by_role("button", name="Apply changes").click()
    pg.wait_for_timeout(600)
    after = pg.evaluate("() => " + BB + "(" + room + ")")
    check("height via number box", after[2] and abs(after[2] - 11 * 0.3048) < 0.02, (before, after))
    pg.locator(".hero-tools button[aria-label=Undo]").click()
    pg.wait_for_timeout(500)
    after2 = pg.evaluate("() => " + BB + "(" + room + ")")
    check("hero undo", after2[2] != after[2], after2)
    pg.locator(".hero-tools button[aria-label=Redo]").click()
    pg.wait_for_timeout(500)

    pg.locator(".thumb-row", has_text="Ceiling Design").locator("select").select_option("cove")
    pg.wait_for_timeout(300)
    ct = pg.evaluate("() => " + room + ".ceilingType")
    check("ceiling design", ct == 'cove', ct)
    pg.locator(".thumb-row", has_text="Furniture Style").locator("select").select_option("luxury")
    pg.wait_for_timeout(500)
    check("furniture style", pg.locator(".furn-thumb.luxury").count() == 1)

    pg.get_by_role("button", name="Day", exact=True).click()
    pg.wait_for_timeout(300)
    t = pg.evaluate("() => window.__hf.getProject().settings.lighting.time")
    check("day light", 11 < t < 14, t)

    pg.wait_for_timeout(2500)
    box = pg.locator(".dash-hero-canvas").bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.42, box['y'] + box['height'] * 0.62)
    pg.wait_for_timeout(500)
    sel = ui(pg, "s.selection")
    check("hero click selects", len(sel) == 1, sel)
    check("selection chip", pg.locator(".hero-chip.sel").count() == 1, pg.locator(".hero-chip.sel").all_inner_texts())

    fur = pg.evaluate("() => { const p = window.__hf.getProject(); const f = p.floors.find(f => f.furniture.length); const it = f.furniture[0]; return { id: it.id, floorId: f.id, rot: it.rotation } }")
    pg.evaluate("() => " + UI + ".set({ selection: [{ kind: 'furniture', id: '" + fur['id'] + "', floorId: '" + fur['floorId'] + "' }] })")
    pg.locator(".hero-tools button[aria-label=Rotate]").click()
    pg.wait_for_timeout(400)
    rot = pg.evaluate("() => window.__hf.getProject().floors.find(f => f.id === '" + fur['floorId'] + "').furniture.find(x => x.id === '" + fur['id'] + "').rotation")
    dr = abs(rot - fur['rot']) % 6.28318
    check("rotate furniture 90", abs(dr - 1.5708) < 0.01 or abs(dr - 4.7124) < 0.01, (fur['rot'], rot))
    pg.locator(".hero-tools button[aria-label=Move]").click()
    pg.wait_for_timeout(800)
    st = ui(pg, "[s.screen, s.mode, s.selection.length]")
    check("move opens plan with selection", st == ['workspace', 'plan', 1], st)
    home(pg)
    pg.locator(".hero-tools button[aria-label=Measure]").click()
    pg.wait_for_timeout(600)
    st = ui(pg, "[s.screen, s.mode, s.tool]")
    check("measure tool", st == ['workspace', 'plan', 'measure'], st)
    home(pg)

    pg.locator(".hero-panel").get_by_role("radio", name="Interior").click()
    pg.wait_for_timeout(1500)
    check("interior view inside a room", pg.evaluate("() => window.__hf.engine().cameraInside()"))
    opts = pg.locator(".hero-panel select option").count()
    check("interior camera lists rooms", opts > 4, opts)
    pg.locator(".hero-panel").get_by_role("radio", name="Top View").click()
    pg.wait_for_timeout(1500)
    y = pg.evaluate("() => window.__hf.engine().active.position.y")
    check("top view from above", y > 15, y)
    pg.locator(".hero-panel").get_by_role("radio", name="Exterior").click()
    pg.wait_for_timeout(800)
    pg.get_by_label("Camera").select_option("orbit")
    pg.wait_for_timeout(1200)
    a0 = pg.evaluate("() => window.__hf.engine().camera.position.toArray()")
    pg.wait_for_timeout(1500)
    a1 = pg.evaluate("() => window.__hf.engine().camera.position.toArray()")
    check("orbit turns", a0 != a1)
    pg.get_by_label("Camera").select_option("drone")
    pg.wait_for_timeout(800)
    n1 = pg.locator(".compass-rose g").get_attribute("transform")
    pg.get_by_label("Camera").select_option("right")
    pg.wait_for_timeout(1500)
    n2 = pg.locator(".compass-rose g").get_attribute("transform")
    check("compass follows camera", n1 != n2, (n1, n2))

    w0 = pg.evaluate("() => document.querySelector('.dash-tile-img.light canvas').style.width")
    pg.locator(".dash-tile").first.locator("button[aria-label='Zoom in']").click()
    pg.wait_for_timeout(800)
    w1 = pg.evaluate("() => document.querySelector('.dash-tile-img.light canvas').style.width")
    check("plan tile zoom", w0 != w1, (w0, w1))
    check("zoom did not open editor", ui(pg, "s.screen") == 'home')

    pg.get_by_role("button", name="Change Material", exact=True).click()
    pg.wait_for_timeout(800)
    st = ui(pg, "[s.screen, s.mode]")
    check("change material", st == ['workspace', 'materials'], st)
    home(pg)
    pg.locator(".sketch-tools button", has_text="Rectangle").click()
    pg.wait_for_timeout(800)
    st = ui(pg, "[s.screen, s.mode]")
    check("sketch rectangle", st == ['workspace', 'sketch'], st)
    on = pg.locator("button.icon-btn.active[aria-label='Rectangle']").count()
    check("rect tool active", on == 1, on)
    home(pg)
    pg.locator(".dash-video").get_by_role("button", name="Interior Tour").click()
    pg.wait_for_timeout(800)
    st = ui(pg, "[s.screen, s.mode]")
    check("video interior tour", st == ['workspace', 'drone'], st)
    home(pg)
    pg.locator(".avatar-btn").click()
    pg.wait_for_timeout(300)
    check("account menu", pg.get_by_text("Keyboard shortcuts").count() >= 1)
    pg.keyboard.press("Escape")
    pg.locator(".dash-links button", has_text="Materials").click()
    pg.wait_for_timeout(600)
    check("nav materials", ui(pg, "s.mode") == 'materials')
    print("errors", errs[:8])
    print(sum(1 for r in res if r[1]), "/", len(res), "passed")
    b.close()
sys.exit(0 if all(r[1] for r in res) and not errs else 1)
