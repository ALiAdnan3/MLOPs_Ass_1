"""Wizard → five designs → editor, in browser mode (webapp-testing skill, Playwright).

Types the §22 example into the home prompt, walks every wizard step, generates designs A–E,
opens "Why this design?", uses design A and exports a drawing PDF preview. Screenshots go to
test-results/wizard. Needs `npm run web` running.
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:5199/?quality=high"
OUT = pathlib.Path("test-results/wizard")
PROMPT = ("Design a modern 10 marla double-storey house with 4 bedrooms, 2 car parking, basement, "
          "large lawn, patio, dirty kitchen, drawing room and a double-height entrance.")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    theme = sys.argv[1] if len(sys.argv) > 1 else "dark"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        page.goto(URL + ("&theme=light" if theme == "light" else ""))
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)
        page.get_by_placeholder("Describe the house you want", exact=False).fill(PROMPT)
        page.get_by_role("button", name="Plan my house").click()
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT / "step-7-review.png"))
        page.locator(".steps").get_by_text("Plot", exact=True).click()
        page.wait_for_timeout(600)
        for i, name in enumerate(["plot", "floors", "rooms", "outdoor", "special", "style", "preferences"]):
            page.screenshot(path=str(OUT / f"step-{i}-{name}.png"))
            page.get_by_role("button", name=re.compile(r"^Next")).click()
            page.wait_for_timeout(600)
        page.get_by_role("button", name="Generate designs").click()
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / "designs-generating.png"))
        page.wait_for_selector("text=Use this design", timeout=180000)
        page.wait_for_timeout(9000)
        page.screenshot(path=str(OUT / "designs.png"))
        page.get_by_role("button", name="Why this design?").first.click()
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "designs-why.png"))
        page.get_by_role("button", name="Use this design").first.click()
        page.wait_for_timeout(3000)
        page.screenshot(path=str(OUT / "editor.png"))
        # export dialog with live sheet preview
        page.get_by_role("button", name="Export", exact=True).click()
        page.wait_for_timeout(300)
        page.get_by_text("Export everything…").click()
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / "export.png"))
        browser.close()
    print("\n".join(errors) if errors else "no console errors")
    return 1 if any("pageerror" in e for e in errors) else 0


if __name__ == "__main__":
    sys.exit(main())
