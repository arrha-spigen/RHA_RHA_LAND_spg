# Auto-broadcast (unattended weekday schedule)

Sends the Pixel 11 + Galaxy Z8 배드리뷰(1~3점) cards to all 12 GCX rooms **every weekday
at 10:30 AM KST**, skipping Korean public holidays automatically — **no test-send, no
confirmation prompt.** Added 2026-09-15 per explicit user request. This is a *separate*
path from the interactive `badreview-chat-broadcast` skill, which still requires a
test-send + explicit "yes" on every manual run — that hard rule is untouched.

## Files

| File | Purpose |
|------|---------|
| `auto_broadcast.py` | the unattended script `launchd` runs |
| `~/Library/LaunchAgents/com.spigen.gcx.badreview-broadcast.plist` | the schedule (Mon–Fri, 10:30 local time = KST) |
| `logs/auto_broadcast.log` | one line per run: skipped (weekend/holiday) or per-room OK/ERR |
| `logs/launchd.out.log` / `launchd.err.log` | raw stdout/stderr from launchd itself |

## How it works

1. `launchd` fires the script at 10:30 AM every weekday (`StartCalendarInterval`, one
   entry per Weekday 1–5). Requires the Mac to be **on and awake** at that time — if
   it's asleep/off, that day's run is simply skipped (launchd does not queue/catch up
   missed fires for `StartCalendarInterval`, unlike `cron`'s behavior on some systems).
2. The script checks `today.weekday() >= 5` (weekend safety net, launchd shouldn't fire
   then anyway) and calls the free **Nager.Date API**
   (`https://date.nager.at/api/v3/PublicHolidays/{year}/KR`) for that year's Korean
   public holidays. If today is in that set → log `SKIP` and exit, nothing sent.
   - Nager's KR list does **not** include 근로자의날/Labour Day (May 1) — matches
     "national holiday" (관공서 공휴일) intent, not "day off for private companies."
     If that's wrong for GCX's actual calendar, adjust `kr_holidays()`.
   - If the API call fails (network hiccup), falls back to a **hardcoded 2026 list**
     baked into the script (`KR_HOLIDAYS_FALLBACK_2026`) — re-derive this every
     January from the same API for the new year, or the fallback silently stops
     covering real holidays.
3. Otherwise: refreshes the `gws_shim` Sheets API token, reads both sheets' `1-3점`
   tab directly (Sheets API v4 — **not** the browser/`gviz` method the interactive
   skill uses, since there's no Chrome session in an unattended launchd run), computes
   the same `{todayCount, todayTags, recentAvg, film, case}` shape as the interactive
   flow (including the `recentAvg` trailing-7-day baseline for significance
   highlighting), then **imports** (doesn't duplicate) `report.py` from both
   `~/.claude/skills/{pixel11,glxz8}-badreview-chat-report/` for card-building and
   `broadcast.py` from `~/.claude/skills/badreview-chat-broadcast/` for the room list
   + POST helper. Any card-layout or room-list change made to those files takes effect
   here automatically — nothing to keep in sync manually.
4. Posts Z8 then PX to all 12 rooms (same order/pacing as the interactive `--all`),
   logs each result.

## Manual controls

```bash
# See what launchd currently has loaded
launchctl print gui/$(id -u)/com.spigen.gcx.badreview-broadcast

# Test the logic without sending anything
python3 auto_broadcast.py --dry-run                    # as if run today
python3 auto_broadcast.py --dry-run --date 2026-09-25   # simulate a holiday (should SKIP)

# Force a real send right now, bypassing the weekday/holiday check (careful — this is live)
python3 auto_broadcast.py --force

# Unload / reload after editing the plist
launchctl bootout gui/$(id -u)/com.spigen.gcx.badreview-broadcast
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.spigen.gcx.badreview-broadcast.plist

# Disable temporarily without deleting anything
launchctl bootout gui/$(id -u)/com.spigen.gcx.badreview-broadcast
```

There is no delete/uninstall step needed to try this out — `bootout` stops it, and it
won't restart until the plist is `bootstrap`ped again (or the Mac reboots and something
re-loads LaunchAgents automatically, which does NOT happen for a bootout'd agent — it
stays off until manually bootstrapped again).
