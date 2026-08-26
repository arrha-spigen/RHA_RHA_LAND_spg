"""Automated login for the SC review scraper's EC2/unattended deployment.

Only activates when SC_SCRAPER_CREDENTIALS_FILE is set in the environment —
unset on the Mac, so the original manual input()/sleep-loop login flow in
scrape_sc_reviews.py is completely unchanged there.

Email + password are filled automatically from a local credentials file.
The OTP step is NOT automated with a stored TOTP secret (that would give a
compromised server permanent, silent MFA bypass). Instead, when Amazon asks
for a one-time code, this module:
  1. starts a small local HTTP server bound to 127.0.0.1 only,
  2. opens a cloudflared "quick tunnel" (no account needed, ephemeral
     https://xxxx.trycloudflare.com URL, no inbound port ever opened on the
     instance's security group),
  3. posts a link to that tunnel in a private Google Chat space,
  4. waits for a human to open the link on their phone, read the live code
     off Google Authenticator, and submit it.
"""

import os
import re
import time
import secrets
import asyncio
import subprocess

_EU_SUBCOUNTRIES = {"UK", "DE", "FR", "IT", "ES"}

CHAT_WEBHOOK_URL = os.environ.get("SC_SCRAPER_CHAT_WEBHOOK")
# New private Google Chat space webhook — deliberately NOT the shared GCX
# team-room webhook, since anyone in that room could see and race to submit
# an OTP before the intended user, defeating the point of human-approved MFA.


def credential_group(domain: str) -> str:
    """Map an EU sub-country code back to the shared 'EU' credential entry —
    all EU sub-countries log in through the same sellercentral-europe.amazon.com
    session, so they share one email/password."""
    return "EU" if domain in _EU_SUBCOUNTRIES else domain


def load_credentials(path: str) -> dict:
    """Parse the pipe-delimited secrets file: DOMAIN|EMAIL|PASSWORD per line."""
    creds = {}
    with open(os.path.expanduser(path), encoding="utf-8") as f:
        for lineno, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|")
            if len(parts) != 3:
                raise ValueError(
                    f"{path} line {lineno}: expected 3 pipe-separated fields "
                    f"(DOMAIN|EMAIL|PASSWORD), got {len(parts)}"
                )
            domain, email, password = (p.strip() for p in parts)
            creds[domain.upper()] = {"email": email, "password": password}
    return creds


def _notify_chat(text: str):
    if not CHAT_WEBHOOK_URL:
        return
    try:
        requests_module = __import__("requests")
        requests_module.post(CHAT_WEBHOOK_URL, json={"text": text}, timeout=10)
    except Exception as e:
        print(f"  [chat notify failed] {e}")


async def _request_otp_via_chat(domain: str, timeout: int = 300):
    """Starts a local HTTP server + cloudflared quick tunnel, posts a Chat
    message with a one-time link, waits for the user to submit the code.
    Returns the 6-digit code string, or None on timeout/failure."""
    from aiohttp import web  # lazy import — only needed on the EC2 deployment,
                              # which actually reaches this code path; keeps
                              # aiohttp off the Mac's required-dependency list
    token = secrets.token_urlsafe(24)
    code_holder = {}
    got_code = asyncio.Event()

    async def handle_get(request):
        return web.Response(
            text=f"""<html><body style="font-family:sans-serif;max-width:400px;margin:60px auto">
<h3>OTP for {domain} Seller Central</h3>
<form method="post"><input name="code" maxlength="6" autofocus
 style="font-size:24px;padding:8px;width:100%"><br><br>
<button type="submit" style="font-size:18px;padding:8px 20px">Submit</button></form>
</body></html>""",
            content_type="text/html",
        )

    async def handle_post(request):
        data = await request.post()
        code = str(data.get("code", "")).strip()
        if re.fullmatch(r"\d{6}", code):
            code_holder["code"] = code
            got_code.set()
            return web.Response(text="Submitted — you can close this tab.")
        return web.Response(text="Invalid code, go back and try again.", status=400)

    app = web.Application()
    app.router.add_get(f"/otp/{token}", handle_get)
    app.router.add_post(f"/otp/{token}", handle_post)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 8765)
    await site.start()

    tunnel = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", "http://localhost:8765"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    tunnel_url = None
    try:
        for _ in range(50):  # cloudflared prints the URL within a few seconds
            line = tunnel.stdout.readline()
            if not line:
                break
            m = re.search(r"https://[a-zA-Z0-9\-]+\.trycloudflare\.com", line)
            if m:
                tunnel_url = m.group(0)
                break
    except Exception:
        pass

    if not tunnel_url:
        tunnel.terminate()
        await runner.cleanup()
        print(f"  [{domain}] could not establish OTP relay tunnel")
        return None

    _notify_chat(
        f"🔐 OTP needed for *{domain}* Seller Central login\n"
        f"{tunnel_url}/otp/{token}\n"
        f"(expires in {timeout // 60} min)"
    )
    print(f"  [{domain}] OTP request sent to Chat — waiting up to {timeout}s for reply")

    try:
        await asyncio.wait_for(got_code.wait(), timeout=timeout)
        return code_holder.get("code")
    except asyncio.TimeoutError:
        _notify_chat(f"⏱ Timed out waiting for {domain} OTP.")
        return None
    finally:
        tunnel.terminate()
        await runner.cleanup()


async def _checkpoint(page, screenshot_dir, domain, step):
    """Save a numbered screenshot at each stage of the login flow, regardless
    of success/failure. There is no display/Live View available in a headless
    cloud container (Apify's containers have no X server at all), so this is
    how a run gets visually inspected after the fact — via the Key-Value
    Store instead of watching live."""
    if not screenshot_dir:
        return
    try:
        os.makedirs(screenshot_dir, exist_ok=True)
        fname = os.path.join(screenshot_dir, f"{int(time.time())}_{domain}_{step}.png")
        await page.screenshot(path=fname)
    except Exception as e:
        print(f"  [{domain}] checkpoint screenshot '{step}' failed: {e}")


async def _drive_amazon_signin(page, email: str, password: str, domain: str,
                                screenshot_dir: str = None):
    """Best-effort pass through Amazon's multi-stage signin form. Selectors
    are Amazon's long-standing standard IDs — CONFIRM them against the
    checkpoint screenshots from the first run before relying on this
    unattended; Amazon changes markup occasionally."""
    await _checkpoint(page, screenshot_dir, domain, "0_arrived")

    if await page.locator("#ap_email").count():
        await page.fill("#ap_email", email)
        await _checkpoint(page, screenshot_dir, domain, "1_email_filled")
        await page.click("#continue")
        await page.wait_for_load_state("domcontentloaded")
        await _checkpoint(page, screenshot_dir, domain, "2_after_continue")

    if await page.locator("#ap_password").count():
        await page.fill("#ap_password", password)
        for sel in ("#auth-remember-device", "input[name='rememberDevice']"):
            if await page.locator(sel).count():
                await page.check(sel)
                break
        await _checkpoint(page, screenshot_dir, domain, "3_password_filled")
        await page.click("#signInSubmit")
        await page.wait_for_load_state("domcontentloaded")
        await _checkpoint(page, screenshot_dir, domain, "4_after_signin_submit")

    otp_sel = "#auth-mfa-otpcode, input[name='otpCode']"
    try:
        await page.wait_for_selector(otp_sel, timeout=15000)
        await _checkpoint(page, screenshot_dir, domain, "5_otp_prompt")
        code = await _request_otp_via_chat(domain)
        if not code:
            return  # timed out — caller's URL-check will fail and retry/report
        await page.fill(otp_sel, code)
        for sel in ("#auth-mfa-remember-device", "input[name='rememberDevice']"):
            if await page.locator(sel).count():
                await page.check(sel)
                break
        for sel in ("#auth-signin-button", "input[type='submit']"):
            if await page.locator(sel).count():
                await page.click(sel)
                break
        await page.wait_for_load_state("domcontentloaded")
        await _checkpoint(page, screenshot_dir, domain, "6_after_otp_submit")
    except Exception:
        pass  # OTP step skipped — already-verified device, or not required


async def ensure_logged_in(page, label: str, creds: dict, *, max_attempts: int = 2,
                            screenshot_dir: str = None) -> bool:
    """Drop-in automation for the manual input()/sleep-loop login blocks.
    Returns True once the existing URL-substring check passes (no '/ap/',
    'signin', or 'mfa' in page.url) — same check the rest of the script
    already uses to detect a logged-in session. Returns False after
    max_attempts — caller decides whether to fall back to manual behavior."""
    group = credential_group(label)
    account = creds.get(group)
    if not account:
        return False

    for attempt in range(1, max_attempts + 1):
        try:
            await _drive_amazon_signin(page, account["email"], account["password"], label,
                                        screenshot_dir=screenshot_dir)
        except Exception as e:
            print(f"  [{label}] login automation error (attempt {attempt}): {e}")

        if not any(x in page.url for x in ["/ap/", "signin", "mfa"]):
            print(f"  [{label}] automated login succeeded (attempt {attempt})")
            return True

        print(f"  [{label}] not logged in yet (attempt {attempt}/{max_attempts})")

    await _checkpoint(page, screenshot_dir, label, "9_final_failure")
    print(f"  [{label}] login FAILED after {max_attempts} attempts")
    _notify_chat(f"❌ {label} login FAILED after {max_attempts} attempts — checkpoint screenshots saved.")
    return False
