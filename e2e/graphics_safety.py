"""Graphics-backend safety (amendment A12): a backend that leaves the window black, flickers or crashes
must not trap the user. Runs the real desktop app with a throwaway profile:

  npm run build
  python e2e/graphics_safety.py
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
ELECTRON = ROOT / "node_modules" / "electron" / "dist" / "electron.exe"
ok = True


def check(name, cond, info=""):
    global ok
    ok = ok and bool(cond)
    print(("PASS " if cond else "FAIL ") + name, info, flush=True)


def run(settings: dict, seconds: float, extra=()):
    """Start the app with these saved settings for a while; return the settings it left behind."""
    # a long path (Windows short names like ALIADN~1 confuse the profile lock)
    (ROOT / "test-results").mkdir(exist_ok=True)
    profile = tempfile.mkdtemp(prefix="hf-gfx-", dir=str(ROOT / "test-results"))
    with open(os.path.join(profile, "settings.json"), "w", encoding="utf-8") as f:
        json.dump(settings, f)
    env = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
    p = subprocess.Popen([str(ELECTRON), str(ROOT), f"--user-data-dir={profile}", *extra], env=env, cwd=ROOT)
    time.sleep(seconds)
    with open(os.path.join(profile, "settings.json"), encoding="utf-8") as f:
        after = json.loads(f.read().lstrip("﻿"))
    log = ""
    lp = os.path.join(profile, "homeforge.log")
    if os.path.exists(lp):
        log = open(lp, encoding="utf-8").read()
    # close every instance started from this profile (a revert relaunches the app)
    subprocess.run(["powershell", "-NoProfile", "-Command", f"Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object {{ $_.CommandLine -like '*{os.path.basename(profile)}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"], capture_output=True)
    p.wait(10)
    time.sleep(1)
    shutil.rmtree(profile, ignore_errors=True)
    return after, log


base = {"theme": "dark", "quality": "high", "uiMode": "beginner", "aiProvider": "offline", "autosaveSeconds": 20, "firstRunDone": True}

# 1. the last start with OpenGL never got as far as drawing (the user closed a black window)
after, _ = run({**base, "graphicsBackend": "opengl", "graphicsTrial": "opengl"}, 6)
check("stuck trial: next start goes back to Automatic", after.get("graphicsBackend") == "auto", after)
check("stuck trial: the user is told once", after.get("graphicsFailed") in ("opengl", None), after.get("graphicsFailed"))

# 2. --safe-graphics always starts with Automatic
after, _ = run({**base, "graphicsBackend": "vulkan"}, 6, ["--safe-graphics"])
check("--safe-graphics: Automatic", after.get("graphicsBackend") == "auto", after)

# 3. a fresh OpenGL trial: either it works and is confirmed, or it is caught and reverted
after, log = run({**base, "graphicsBackend": "opengl"}, 22)
outcome = "confirmed" if after.get("graphicsVerified") == "opengl" and after.get("graphicsBackend") == "opengl" else "reverted" if after.get("graphicsBackend") == "auto" else "undecided"
check("OpenGL trial decided (confirmed or reverted)", outcome in ("confirmed", "reverted"), {"outcome": outcome, "settings": after, "log": log.strip().splitlines()[-2:] if log else []})
check("no trial left pending", "graphicsTrial" not in after or after.get("graphicsBackend") == "auto", after)

print("GRAPHICS SAFETY PASSED" if ok else "GRAPHICS SAFETY FAILED")
sys.exit(0 if ok else 1)
