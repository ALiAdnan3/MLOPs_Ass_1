"""Rasterize SVG files to PNG with headless Chromium (dev aid for visual review of generated plans).

Usage: python e2e/svg_to_png.py test-results/plans
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright


def main(folder: str) -> None:
    files = sorted(pathlib.Path(folder).glob("*.svg"))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 900, "height": 1400})
        for f in files:
            page.goto(f.resolve().as_uri())
            page.wait_for_timeout(100)
            svg = page.locator("svg")
            out = f.with_suffix(".png")
            svg.screenshot(path=str(out))
            print(out)
        browser.close()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "test-results/plans")
