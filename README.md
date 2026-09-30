# Checkpoint

A personal trading-discipline app for a futures day trader: a premarket checklist, a checklist before every trade with trade-cap and cooldown locks, and calm cooldown timers. It's phone-first, works on desktop, installs as an app and works offline.

**Live:** https://kwarciyk5-pixel.github.io/Checkpoint/

## Tabs

- **Premarket**: the daily pre-session checklist, with a "now" item, gates and focus mode.
- **Trade**: rules, session time, the pre-entry checklist, hold to enter, outcome logging, locks.
- **Cooldown**: timers built from editable presets. There is no skip button.
- **Settings**: edit every checklist, preset, rule and message, plus import/export.

Everything shown is editable. The defaults are only prefilled on first run.

## Desktop floating window (Chrome or Edge)

On a computer, the Trade tab has **OPEN FLOATING WINDOW**. It opens a small always-on-top window (Document Picture-in-Picture) that stays over your charts: session time, trade count, next check-in, **CHECK IN NOW** and the urge hold. **TRADE CHECKLIST** lets you arm the checks, hold to enter and log TP / SL / SCRATCH / MANUAL right there, with UNDO. At each check-in time (Settings → Check-ins) it glows and chimes, shows your cue and asks "How's it going?": Doing good · Not good (Break) · Done · Red Day · Done · Green Day. Red/Green Day run their cooldown, then show the session-over checklist and close the day. Every answer is saved, with a 10-second UNDO.

Keep the Checkpoint tab open while the window is in use; closing the tab closes the window. Phone and computer keep separate data: log trades on one device per session, and use Export + Merge to copy between them.

## Your data stays in this browser

There is no server, account or tracking. All data is saved in this browser's local storage on this device only. Clearing the browser's site data deletes it, and data isn't shared between devices or browsers.

**Export regularly:** Settings → Data → **EXPORT .JSON**. To restore, use **IMPORT** and choose **Merge**.

**Never commit backup JSON files** (`checkpoint-backup-*.json`) to this repository. They contain your personal trading records, and the repository is public. `.gitignore` already excludes them.

## Install on your phone

- **iPhone (Safari):** open the live URL → Share → **Add to Home Screen**.
- **Android (Chrome):** open the live URL → ⋮ menu → **Add to Home screen** / **Install app**.

When a new version is published, the app shows "Update available · Reload".

## Development

Plain HTML/CSS/JS with no build step. The app is `index.html`, and its sections are listed in [MAP.md](MAP.md).

```
python3 tests/static_checks.py      # node --check + smart-quote scan
node tests/unit.test.js             # defaults, trading-day key, isLoosening, merge
python3 -m http.server 8765 &       # then, with playwright-core available:
NODE_PATH=... node tests/browser.test.js /tmp/shots
```

If you change `index.html`, bump the cache name in `sw.js` (e.g. `checkpoint-v4` → `checkpoint-v5`) so installed copies pick up the update cleanly.
