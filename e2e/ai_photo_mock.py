"""End-to-end check of AI photos (amendment A9) in the real desktop app, without spending money.

A local stand-in for OpenAI's image edit endpoint records each request and answers with a JPEG.
The app is started with OPENAI_BASE_URL pointing at it (the official SDK honours that variable)
and a throwaway profile, then driven over the DevTools protocol:

  npm run build
  python e2e/ai_photo_mock.py
"""
import base64
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "test-results" / "ai-photo"
OUT.mkdir(parents=True, exist_ok=True)
REQUESTS: list[dict] = []
# a real JPEG to answer with: any render will do; make a plain one if none is around
REPLY = next((p for p in (ROOT / "docs" / "screenshots").glob("*.png")), None)


def reply_jpeg() -> bytes:
    from PIL import Image  # pillow ships with the test tooling
    import io
    im = Image.open(REPLY).convert("RGB").resize((1536, 1024)) if REPLY else Image.new("RGB", (1536, 1024), (200, 180, 150))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=85)
    return b.getvalue()


JPEG = reply_jpeg()


def parse_multipart(body: bytes, ctype: str) -> dict:
    boundary = ctype.split("boundary=")[1].strip().strip('"').encode()
    out: dict = {}
    for part in body.split(b"--" + boundary):
        if b"\r\n\r\n" not in part:
            continue
        head, data = part.split(b"\r\n\r\n", 1)
        data = data.rstrip(b"\r\n")
        h = head.decode(errors="replace")
        name = h.split('name="')[1].split('"')[0] if 'name="' in h else "?"
        if "filename=" in h:
            ct = h.split("Content-Type:")[1].strip().split("\r\n")[0] if "Content-Type:" in h else ""
            out[name] = {"filename": h.split('filename="')[1].split('"')[0], "content_type": ct, "bytes": len(data), "jpeg": data[:2] == b"\xff\xd8", "png": data[:8] == b"\x89PNG\r\n\x1a\n"}
        else:
            out[name] = data.decode(errors="replace")
    return out


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        fields = parse_multipart(body, self.headers.get("Content-Type", ""))
        REQUESTS.append({"path": self.path, "auth": self.headers.get("Authorization", "")[:12], "fields": fields})
        time.sleep(1.5)  # the real service takes a while
        out = json.dumps({"created": int(time.time()), "data": [{"b64_json": base64.b64encode(JPEG).decode()}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Mock)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="hf-ai-photo-")
    env = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
    env.update({"OPENAI_API_KEY": "sk-test-mock", "OPENAI_BASE_URL": f"http://127.0.0.1:{port}/v1"})
    electron = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"
    app = subprocess.Popen([str(electron), str(ROOT), "--remote-debugging-port=9334", f"--user-data-dir={profile}"], env=env, cwd=ROOT)
    ok = True
    try:
        with sync_playwright() as p:
            browser = None
            for _ in range(60):
                try:
                    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9334")
                    break
                except Exception:
                    time.sleep(0.5)
            assert browser, "the app did not start"
            page = None
            for _ in range(60):
                pages = [pg for c in browser.contexts for pg in c.pages if not pg.url.startswith("devtools")]
                if pages:
                    page = pages[0]
                    break
                time.sleep(0.5)
            assert page, "no window"
            page.wait_for_selector(".dash", timeout=60000)
            page.get_by_role("button", name="Demo house", exact=True).click()
            page.wait_for_function("() => document.querySelectorAll('.dash-design').length >= 1", timeout=120000)
            page.locator(".dash-links button", has_text="Showcase").click()
            page.wait_for_selector(".sc-card", timeout=60000)
            page.locator(".sc-card", has_text="Kitchen").first.click()
            page.get_by_role("button", name="Make AI photo").click()
            page.wait_for_selector(".sc-stage img[alt$='AI photo']", timeout=120000)
            page.wait_for_timeout(500)
            page.screenshot(path=str(OUT / "viewer-ai.png"))
            first = REQUESTS[0]
            f = first["fields"]
            checks = {
                "endpoint": first["path"] == "/v1/images/edits",
                "key sent": first["auth"].startswith("Bearer sk-te"),
                "model": f.get("model") == "gpt-image-2",
                "quality": f.get("quality") == "high",
                "size": f.get("size") == "1536x1024",
                "jpeg out": f.get("output_format") == "jpeg",
                "no input_fidelity for gpt-image-2": "input_fidelity" not in f,
                "render attached (lossless PNG)": isinstance(f.get("image"), dict) and f["image"]["png"] and f["image"]["content_type"] == "image/png" and f["image"]["bytes"] > 200000,
                "brochure staging by default": "Stage it like a luxury property brochure" in f.get("prompt", ""),
                "prompt names the area": "kitchen" in f.get("prompt", "").lower(),
                "prompt keeps the design": "Keep the same camera position" in f.get("prompt", "") and "do not change the architecture" in f.get("prompt", ""),
            }
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
            checks["AI photo on the card"] = page.locator(".sc-card", has_text="Kitchen").locator(".sc-badge").count() == 1
            checks["kept on the concept board"] = page.evaluate("() => document.querySelectorAll('.sc-badge').length") >= 1
            # every bathroom at once
            page.locator(".sc-chips button", has_text="Bathrooms").click()
            n = page.locator(".sc-card").count()
            before = len(REQUESTS)
            page.get_by_role("button", name="AI photos for these areas").click()
            page.get_by_role("button", name=f"Make {n} photos").click()
            page.wait_for_function(f"() => document.querySelectorAll('.sc-card .sc-badge').length >= {n}", timeout=180000)
            checks[f"batch made {n} photos"] = len(REQUESTS) - before == n
            page.wait_for_timeout(800)
            page.screenshot(path=str(OUT / "batch.png"))
            for k, v in checks.items():
                print(("PASS " if v else "FAIL ") + k)
                ok = ok and v
            (OUT / "requests.json").write_text(json.dumps([{**r, "fields": {k: v for k, v in r["fields"].items() if k != "prompt"}} for r in REQUESTS], indent=2))
            print("prompt:", f.get("prompt", "")[:400])
    finally:
        app.terminate()
        try:
            app.wait(10)
        except Exception:
            app.kill()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)
    print("AI PHOTO E2E PASSED" if ok else "AI PHOTO E2E FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
