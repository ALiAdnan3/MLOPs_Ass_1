"""§72 FINAL PRODUCT EXPERIENCE, end to end in browser mode (webapp-testing skill, Playwright).

1 Kanal, double story + basement, 5 bedrooms, 2 guest rooms, 3-car garage, lawn, patio, pool,
drawing, dining, TV lounge, 2 kitchens, study, prayer room, modern luxury, large windows, high
privacy → generate designs → pick one → enlarge the master bedroom → upload white_marble.jpg
onto the living floor → marble floor, paint walls, stone TV wall, wood stairs → walk → drone →
sketch an extra room → 3D → export floor-plan PDF, 3D images, presentation, 3D model, project.

Needs `npm run web`. Screenshots and downloaded files go to test-results/final.
"""
import math
import pathlib
import re
import struct
import sys
import zlib

from playwright.sync_api import sync_playwright

URL = "http://localhost:5199/?e2e&quality=medium"
OUT = pathlib.Path("test-results/final")
DL = OUT / "downloads"
PROMPT = ("1 kanal double story house with basement, 5 bedrooms, 2 guest rooms, 3 car garage, large lawn, "
          "patio, swimming pool, drawing room, dining room, TV lounge, 2 kitchens, study, prayer room, "
          "modern luxury style, large windows, high privacy")


def white_marble(path: pathlib.Path, n: int = 512) -> None:
    """A synthetic white-marble photo (soft grey veins) as a PNG, written without extra packages."""
    rows = []
    for y in range(n):
        row = bytearray([0])
        for x in range(n):
            t = x * 0.018 + y * 0.011
            turb = sum(abs(math.sin((x * f * 0.9 + y * f * 1.3) * 0.013 + f)) / f for f in (1, 2, 4, 8))
            v = abs(math.sin(t + turb * 2.4))
            vein = max(0.0, 1 - v * 7) * 70
            base = 236 - vein - (x ^ y) % 5
            row += bytes((int(base), int(base), int(base + 3 if base < 252 else 255)))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 6)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    DL.mkdir(parents=True, exist_ok=True)
    marble = OUT / "white_marble.png"
    white_marble(marble)
    errors: list[str] = []
    downloads: list[str] = []
    step = [0]

    def shot(page, name: str) -> None:
        step[0] += 1
        try:
            page.screenshot(path=str(OUT / f"{step[0]:02d}-{name}.png"), timeout=90000)
        except Exception as e:  # a slow frame must not abort the scenario
            errors.append(f"[screenshot skipped] {name}: {str(e).splitlines()[0]}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        def on_download(d):
            target = DL / d.suggested_filename
            d.save_as(str(target))
            downloads.append(target.name)

        page.on("download", on_download)
        hf = "window.__hf"

        # ── requirements → designs ─────────────────────────────────────────
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1200)
        page.get_by_placeholder("Describe the house you want", exact=False).fill(PROMPT)
        page.get_by_role("button", name="Plan my house").click()
        page.wait_for_timeout(1200)
        shot(page, "requirements-review")
        page.get_by_role("button", name="Generate designs").click()
        page.wait_for_selector("text=Use this design", timeout=240000)
        page.wait_for_timeout(8000)
        shot(page, "designs")
        page.get_by_role("button", name="Use this design").first.click()
        page.wait_for_timeout(2500)
        shot(page, "plan-2d")
        print("design errors:", page.evaluate(f"() => {hf}.issues()"))
        page.get_by_role("tab", name="3D", exact=True).click()
        page.wait_for_timeout(6000)
        shot(page, "house-3d")

        # ── edit: enlarge the master bedroom ──────────────────────────────
        def master_area():
            return page.evaluate(f"""() => {{ const p = {hf}.getProject(); for (const f of p.floors) for (const r of f.rooms) if (r.type === 'master_bedroom') {{
                let a = 0; const q = r.polygon; for (let i = 0; i < q.length; i++) {{ const j = (i + 1) % q.length; a += q[i].x * q[j].y - q[j].x * q[i].y }} return Math.abs(a) / 2 }} return 0 }}""")

        a0 = master_area()
        page.get_by_role("tab", name="Plan", exact=True).click()
        page.keyboard.press("Control+k")
        page.wait_for_timeout(400)

        def say(text: str, wait: int = 1800) -> str:
            page.get_by_label("Message the assistant").fill(text)
            page.keyboard.press("Enter")
            page.wait_for_timeout(wait)
            return page.locator(".msg.ai").last.inner_text()

        print("assistant:", say("Make the master bedroom 2 feet wider").replace("\n", " | "))
        a1 = master_area()
        print(f"master bedroom {a0:.1f} m² → {a1:.1f} m²")
        shot(page, "master-enlarged")
        page.get_by_role("button", name="Close assistant").click()

        # ── living floor ← white_marble.jpg ──────────────────────────────
        lounge = page.evaluate(f"""() => {{ const p = {hf}.getProject(); const order = ['tv_lounge','living','family','drawing'];
            let best = null; for (const f of p.floors) for (const r of f.rooms) if (order.includes(r.type) && (!best || order.indexOf(r.type) < order.indexOf(best.r.type))) best = {{ f, r }};
            return {{ floorId: best.f.id, roomId: best.r.id, name: best.r.name }} }}""")
        page.get_by_role("tab", name="Materials", exact=True).click()
        page.wait_for_timeout(3500)
        page.evaluate(f"""(s) => {hf}.useUI.getState().set({{ floorId: s.floorId, selection: [{{ kind: 'room', id: s.roomId, floorId: s.floorId }}], surface: {{ kind: 'roomFloor', floorId: s.floorId, roomId: s.roomId }} }})""", lounge)
        page.wait_for_timeout(800)
        page.locator(".dropzone input[type=file]").set_input_files(str(marble))
        page.wait_for_selector("text=Apply this material to the selected surface?", timeout=60000)
        shot(page, "apply-material-confirm")
        page.get_by_role("button", name="Yes, apply").click()
        page.wait_for_selector("text=Before and after", timeout=60000)
        page.wait_for_timeout(800)
        shot(page, "before-after")
        page.get_by_role("button", name="Keep new material").click()
        page.wait_for_timeout(500)
        floor_mat = page.evaluate(f"""(s) => {hf}.getProject().floors.find(f => f.id === s.floorId).rooms.find(r => r.id === s.roomId).floorMaterial""", lounge)
        print("living floor material:", floor_mat)

        # ── finishes by instruction ───────────────────────────────────────
        page.keyboard.press("Control+k")
        page.wait_for_timeout(300)
        for t in (f"Paint the {lounge['name']} walls white", f"Make the TV wall in the {lounge['name']} stone", "Use wood for the stairs"):
            print("assistant:", say(t).replace("\n", " | "))
        page.get_by_role("button", name="Close assistant").click()
        page.get_by_role("tab", name="Interior", exact=True).click()
        page.wait_for_timeout(5000)
        shot(page, "interior-finishes")

        # ── walk & drone ──────────────────────────────────────────────────
        page.get_by_role("tab", name="Walkthrough", exact=True).click()
        page.wait_for_timeout(3500)
        page.keyboard.down("w")
        page.wait_for_timeout(900)
        page.keyboard.up("w")
        page.wait_for_timeout(800)
        shot(page, "walk")
        page.get_by_role("tab", name="Drone", exact=True).click()
        page.wait_for_timeout(7000)
        shot(page, "drone")

        # ── sketch an additional room behind the house ────────────────────
        page.get_by_role("tab", name="Sketch", exact=True).click()
        page.wait_for_timeout(1200)
        geo = page.evaluate(f"""() => {{ const p = {hf}.getProject(); const g = p.floors.find(f => f.level === 0);
            {hf}.useUI.getState().set({{ floorId: g.id }});
            const pts = g.rooms.filter(r => !['garage','terrace','courtyard','void'].includes(r.type)).flatMap(r => r.polygon);
            return {{ top: Math.min(...pts.map(q => q.y)), left: Math.min(...pts.map(q => q.x)), right: Math.max(...pts.map(q => q.x)), rear: p.plot.setbacks.rear }} }}""")
        page.wait_for_timeout(800)
        depth = max(2.8, min(3.6, geo["top"] - geo["rear"] - 0.3))
        x0 = geo["left"] + 1.0
        corners = [(x0, geo["top"]), (x0, geo["top"] - depth), (x0 + 4.2, geo["top"] - depth), (x0 + 4.2, geo["top"])]

        def to_screen(x: float, y: float):
            return page.evaluate(f"(q) => {hf}.sketchToScreen(q)", {"x": x, "y": y})

        for (ax, ay), (bx, by) in zip(corners, corners[1:]):
            a = to_screen(ax, ay)
            b = to_screen(bx, by)
            page.mouse.move(a["x"], a["y"])
            page.mouse.down()
            for k in range(1, 21):
                t = k / 20
                wob = math.sin(k * 1.7) * 1.5
                page.mouse.move(a["x"] + (b["x"] - a["x"]) * t + wob, a["y"] + (b["y"] - a["y"]) * t + wob)
            page.mouse.up()
        page.get_by_role("button", name="Label").click()
        c = to_screen(x0 + 2.1, geo["top"] - depth / 2)
        page.mouse.click(c["x"], c["y"])
        page.keyboard.type("Study")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        shot(page, "sketch-drawn")
        page.get_by_role("button", name="Recognize sketch").click()
        page.wait_for_timeout(1200)
        shot(page, "sketch-recognized")
        page.get_by_role("button", name="Generate 3D").click()
        page.wait_for_timeout(6000)
        shot(page, "sketch-room-in-3d")
        studies = page.evaluate(f"() => {hf}.getProject().floors.flatMap(f => f.rooms).filter(r => r.type === 'study').map(r => r.name)")
        print("study rooms after sketch:", studies)
        print("errors after edits:", page.evaluate(f"() => {hf}.issues()"))

        # ── exports ───────────────────────────────────────────────────────
        def export_menu(label: str):
            page.locator(".titlebar").get_by_role("button", name="Export", exact=True).click()
            page.wait_for_timeout(300)
            page.get_by_text(label, exact=True).click()
            page.wait_for_timeout(1500)

        def attempt(name: str, fn) -> None:
            try:
                fn()
            except Exception as e:  # keep going so every export is tried; the failure is recorded
                errors.append(f"[step failed] {name}: {str(e).splitlines()[0]}")
                shot(page, f"FAILED-{name}")
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)

        def floor_pdf():
            export_menu("Floor plan PDF")
            shot(page, "export-floor-plan")
            with page.expect_download(timeout=120000):
                page.get_by_role("button", name=re.compile(r"^Export \d+ sheets? as PDF")).click()
            page.wait_for_timeout(1500)

        def images():
            export_menu("Image of the current view")
            shot(page, "export-images")
            with page.expect_download(timeout=180000):
                page.get_by_role("button", name="Export images").click()
            page.wait_for_timeout(5000)

        def model():
            export_menu("3D model (GLB / GLTF / OBJ)")
            with page.expect_download(timeout=180000):
                page.get_by_role("button", name="Export GLB").click()
            page.wait_for_timeout(1500)

        def project():
            export_menu("Export everything…")
            page.get_by_role("button", name=re.compile("Project file")).click()
            page.wait_for_timeout(400)
            with page.expect_download(timeout=120000):
                page.get_by_role("button", name="Export project copy").click()
            page.wait_for_timeout(1500)

        def presentation():
            page.get_by_role("tab", name="Present", exact=True).click()
            page.wait_for_timeout(25000)
            shot(page, "presentation")
            with page.expect_download(timeout=180000):
                page.get_by_role("button", name="Export PDF").click()
            page.wait_for_timeout(1500)

        for name, fn in (("floor-plan-pdf", floor_pdf), ("images", images), ("model", model), ("project", project), ("presentation", presentation)):
            attempt(name, fn)
        browser.close()

    print("downloads:", ", ".join(sorted(downloads)))
    print("\n".join(errors) if errors else "no console errors")
    ok = a1 > a0 + 0.5 and floor_mat and str(floor_mat).startswith("upl:") and studies and any(n.endswith(".pdf") for n in downloads) and any(n.endswith(".glb") for n in downloads) and any(n.endswith(".homeforge") for n in downloads)
    print("SCENARIO", "PASSED" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
