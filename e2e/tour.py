"""Visual tour of HomeForge AI in browser mode (webapp-testing skill, Playwright).

Starts from the home screen, opens the demo house and visits every mode, saving screenshots to
test-results/tour and printing console errors. Run with the dev server up (npm run web):

    python e2e/tour.py [--theme light] [--only home,plan,3d]
"""
import argparse
import pathlib
import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:5199/?quality=high"
OUT = pathlib.Path("test-results/tour")
if "--theme" in sys.argv and "light" in sys.argv:
    OUT = pathlib.Path("test-results/tour-light")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--theme", default="dark")
    ap.add_argument("--only", default="")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1000)
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    OUT.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    def want(name: str) -> bool:
        return not only or name in only

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": args.width, "height": args.height}, device_scale_factor=1)
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error",) else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        page.goto(URL + ("&theme=light" if args.theme == "light" else ""))
        page.wait_for_load_state("networkidle")
        if args.theme == "light":
            page.evaluate("document.documentElement.dataset.theme = 'light'")
        page.wait_for_timeout(2500)
        if want("home"):
            page.screenshot(path=str(OUT / "01-home.png"))
        page.get_by_role("button", name="Demo house", exact=True).click()
        page.wait_for_timeout(6000)
        if want("dashboard"):
            page.wait_for_timeout(8000)
            page.screenshot(path=str(OUT / "01b-dashboard.png"))
        page.get_by_role("button", name="Design", exact=True).click()
        page.wait_for_timeout(1500)
        shots = [
            ("plan", "Plan", 1500),
            ("3d", "3D", 7000),
            ("materials", "Materials", 5000),
            ("interior", "Interior", 5000),
            ("exterior", "Exterior", 5000),
            ("sketch", "Sketch", 1500),
            ("walk", "Walkthrough", 4000),
            ("drone", "Drone", 4000),
            ("present", "Present", 12000),
        ]
        for i, (key, label, wait) in enumerate(shots, start=2):
            if not want(key):
                continue
            page.get_by_role("tab", name=label, exact=True).click()
            page.wait_for_timeout(wait)
            page.screenshot(path=str(OUT / f"{i:02d}-{key}.png"))
            if key == "present":
                page.keyboard.press("Escape")
                page.wait_for_timeout(800)
        if want("assistant"):
            page.get_by_role("tab", name="Plan", exact=True).click()
            page.wait_for_timeout(800)
            page.keyboard.press("Control+k")
            page.wait_for_timeout(500)
            page.get_by_label("Message the assistant").fill("Make the master bedroom 2 feet wider")
            page.keyboard.press("Enter")
            page.wait_for_timeout(2500)
            page.screenshot(path=str(OUT / "20-assistant.png"))
        if want("export"):
            page.keyboard.press("Escape")
            page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {key: 'e', ctrlKey: true, shiftKey: true}))")
            page.wait_for_timeout(500)
        browser.close()
    print("\n".join(errors) if errors else "no console errors")
    return 1 if any("pageerror" in e for e in errors) else 0


if __name__ == "__main__":
    sys.exit(main())
