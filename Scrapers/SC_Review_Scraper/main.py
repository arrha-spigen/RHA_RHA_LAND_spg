"""Apify Actor entrypoint for the SC Review Scraper.

Thin wrapper around scrape_sc_reviews.py — the existing 1300+ line scraper
is imported and run completely unmodified. This file's only jobs are:
  1. Translate Apify Actor input (secret fields) into the env vars /
     credentials file scrape_sc_reviews.py and sc_auth.py already expect.
  2. Restore the Chrome profile (session cookies) from Apify's Key-Value
     Store before the run, so sessions persist across daily runs the same
     way they do on a long-lived VPS — Actor runs are otherwise ephemeral
     containers with no normal persistent disk.
  3. Save the (possibly updated) profile back to the Key-Value Store after
     the run, trimming the same disposable cache directories a local
     Chrome profile accumulates (ML models, code cache, service worker
     cache) so the stored zip doesn't balloon in size over time.
"""

import asyncio
import os
import sys
import zipfile

from apify import Actor

PROFILE_STORE_NAME = "sc-scraper-state"
PROFILE_ZIP_KEY = "chrome-scraper-profile"

_SKIP_DIR_NAMES = {
    "OptGuideOnDeviceModel", "OptGuideOnDeviceClassifierModel",
    "optimization_guide_model_store", "WasmTtsEngine",
    "OnDeviceHeadSuggestModel", "component_crx_cache", "extensions_crx_cache",
    "Safe Browsing", "GraphiteDawnCache", "GrShaderCache", "Snapshots",
    "GCM Store", "Cache", "Code Cache", "Service Worker",
}


def _should_skip(path: str) -> bool:
    return any(part.startswith("BrowserMetrics") or part in _SKIP_DIR_NAMES
               for part in path.split(os.sep))


async def main():
    async with Actor:
        actor_input = await Actor.get_input() or {}

        # ── 1. Credentials file, in the DOMAIN|EMAIL|PASSWORD format sc_auth.py expects ──
        creds_lines = []
        for domain in ("US", "EU", "JP", "IN"):
            email = actor_input.get(f"{domain}_EMAIL")
            password = actor_input.get(f"{domain}_PASSWORD")
            if not email or not password:
                raise Exception(f"Missing {domain}_EMAIL/{domain}_PASSWORD in Actor input")
            creds_lines.append(f"{domain}|{email}|{password}")

        creds_path = "/tmp/sc_scraper_credentials.txt"
        with open(creds_path, "w", encoding="utf-8") as f:
            f.write("\n".join(creds_lines) + "\n")
        os.chmod(creds_path, 0o600)

        os.environ["SC_SCRAPER_CREDENTIALS_FILE"] = creds_path
        os.environ["SC_SCRAPER_CHAT_WEBHOOK"] = actor_input.get("CHAT_WEBHOOK_URL", "")
        os.environ["SC_SCRAPER_OUT_DIR"] = "/tmp/sc_scraper_output"
        os.environ["SC_SCRAPER_SCREENSHOT_DIR"] = "/tmp/sc_scraper_screenshots"
        # Apify containers have no X server / display — headed Chrome cannot
        # run here under any circumstances, so this is always forced on
        # regardless of the input toggle (kept only for schema/documentation
        # clarity; a Mac/VPS deployment with a real display could honor it).
        os.environ["SC_SCRAPER_HEADLESS"] = "1"
        os.environ["SC_SCRAPER_DIAGNOSE_ACCOUNTS"] = "1" if actor_input.get("DIAGNOSE_ACCOUNTS") else "0"
        os.environ["SC_SCRAPER_ISOLATED_TEST_DOMAIN"] = actor_input.get("ISOLATED_TEST_DOMAIN", "")
        os.makedirs(os.environ["SC_SCRAPER_OUT_DIR"], exist_ok=True)
        os.makedirs(os.environ["SC_SCRAPER_SCREENSHOT_DIR"], exist_ok=True)

        # ── 2. Google OAuth token for the Sheets upload ──
        gws_token_json = actor_input.get("GWS_TOKEN_JSON")
        if not gws_token_json:
            raise Exception("Missing GWS_TOKEN_JSON in Actor input")
        gws_dir = os.path.expanduser("~/.config/gws_shim")
        os.makedirs(gws_dir, exist_ok=True)
        token_path = os.path.join(gws_dir, "token.json")
        with open(token_path, "w", encoding="utf-8") as f:
            f.write(gws_token_json)
        os.chmod(token_path, 0o600)

        # ── 3. Restore Chrome profile from Key-Value Store (if a prior run saved one) ──
        profile_dir = os.path.expanduser("~/.chrome-scraper-profile")
        store = await Actor.open_key_value_store(name=PROFILE_STORE_NAME)
        zip_bytes = await store.get_value(PROFILE_ZIP_KEY)
        if zip_bytes:
            os.makedirs(profile_dir, exist_ok=True)
            restore_zip = "/tmp/profile_restore.zip"
            with open(restore_zip, "wb") as f:
                f.write(zip_bytes)
            with zipfile.ZipFile(restore_zip) as zf:
                zf.extractall(profile_dir)
            Actor.log.info("Restored Chrome profile from Key-Value Store (%d bytes)", len(zip_bytes))
        else:
            Actor.log.info("No saved Chrome profile in Key-Value Store — first run, starting fresh")

        # ── 4. Run the existing scraper, completely unmodified ──
        # scrape_sc_reviews.py decides interactive-vs-background login prompts
        # via sys.stdin.isatty(). Apify's container attaches something that
        # makes that return True even though nothing can ever type into it —
        # the script would call input() and hang forever waiting for an Enter
        # keypress that never comes. Force stdin to /dev/null so isatty() is
        # reliably False, matching how this script is meant to run unattended.
        sys.stdin = open(os.devnull, "r")

        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import scrape_sc_reviews  # noqa: E402  (import after env vars are set)

        run_failed = False
        try:
            await scrape_sc_reviews.main()
        except SystemExit as e:
            run_failed = bool(e.code)
        except Exception as e:
            Actor.log.exception("scrape_sc_reviews.main() raised: %s", e)
            run_failed = True

        # Surface every login checkpoint screenshot (and, when
        # SC_SCRAPER_DIAGNOSE_ACCOUNTS is set, diagnostic account-picker HTML
        # dumps) to the default Key-Value Store — the container filesystem is
        # gone once this run ends, and there is no display/Live View
        # available in this container at all, so this is the only way to see
        # what Amazon actually showed at each step.
        screenshot_dir = os.environ["SC_SCRAPER_SCREENSHOT_DIR"]
        _artifact_types = {".png": "image/png", ".html": "text/html"}
        if os.path.isdir(screenshot_dir):
            saved = 0
            for fn in sorted(os.listdir(screenshot_dir)):
                ext = os.path.splitext(fn)[1]
                if ext in _artifact_types:
                    with open(os.path.join(screenshot_dir, fn), "rb") as f:
                        await Actor.set_value(fn, f.read(), content_type=_artifact_types[ext])
                    saved += 1
            Actor.log.info("Saved %d diagnostic artifact(s) to Key-Value Store", saved)

        # ── 5. Save the (possibly updated) profile back, trimming disposable caches ──
        save_zip = "/tmp/profile_save.zip"
        with zipfile.ZipFile(save_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(profile_dir):
                dirs[:] = [d for d in dirs if not _should_skip(os.path.join(root, d))]
                for fn in files:
                    fp = os.path.join(root, fn)
                    if _should_skip(fp):
                        continue
                    try:
                        zf.write(fp, os.path.relpath(fp, profile_dir))
                    except FileNotFoundError:
                        # Chrome deletes lock/temp files (e.g. SingletonLock) as
                        # part of its own shutdown/crash cleanup — a file that
                        # existed when os.walk() listed it can vanish by the
                        # time we get to writing it. Not worth failing the whole
                        # profile save over.
                        pass
        with open(save_zip, "rb") as f:
            zip_data = f.read()
        await store.set_value(PROFILE_ZIP_KEY, zip_data, content_type="application/zip")
        Actor.log.info("Saved Chrome profile to Key-Value Store (%d bytes)", len(zip_data))

        if run_failed:
            raise Exception("scrape_sc_reviews.py reported at least one FAILED domain — see logs above")


if __name__ == "__main__":
    asyncio.run(main())
