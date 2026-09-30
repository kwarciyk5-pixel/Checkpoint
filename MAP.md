# MAP: section banners in `index.html`

`index.html` is the whole app: markup, one `<style>` and one `<script>`. Each section starts with a banner comment like `/* ==== STATE: load/save ==== */`. Change instructions use these banners as FIND anchors, so keep the banner text **unique and unchanged**. Sections appear in this order.

## `<style>`

| Banner | Purpose | Key selectors |
|---|---|---|
| `/* ==== STYLE: tokens ==== */` | Colour/font tokens on `:root`, base element styles | `--bg`, `--accent`, `--lock`, `--info`, `.mono` |
| `/* ==== STYLE: layout + tabs ==== */` | Page padding, bottom tab bar (phone) and left rail (≥900px) | `#view`, `.wrap`, `.tabs`, `.tab` |
| `/* ==== STYLE: components ==== */` | Cards, buttons, pills, tags, progress bar, banner, checkbox | `.card`, `.btn`, `.pill`, `.bar`, `.banner`, `.cb` |
| `/* ==== STYLE: premarket ==== */` | Now strip, categories, item rows, gate buttons, focus mode | `.now-strip`, `.cat-head`, `.item`, `.gate-btns`, `.focus-wrap` |
| `/* ==== STYLE: trade ==== */` | Rules cells, session bar, counter + pips, Enter/hold buttons, outcomes, urge | `.rules`, `.session-bar`, `.pip`, `.enter`, `.hold`, `.urge` |
| `/* ==== STYLE: cooldown ==== */` | Preset chips, ring timer, steps | `.chips`, `.chip`, `.ring-wrap`, `.step` |
| `/* ==== STYLE: settings + editors ==== */` | Settings fields, stepper, switches, day chips, pending rows, editors, drag visuals | `.field`, `.stepper`, `.switch`, `.pending`, `.handle`, `.lifted`, `.drop-ph` |
| `/* ==== STYLE: check-ins + floating window ==== */` | Check-in card and banner, floating-window layout (`.pw`, lit / cool states), check-in settings rows | `.ci-card`, `.ci-answers`, `.ci-banner`, `.pw`, `.pw-head`, `.pw-ring`, `.pw-undo`, `.ci-row` |
| `/* ==== STYLE: modal + toast ==== */` | In-app modal, toasts, reduced-motion overrides | `.modal-back`, `.modal`, `.toast` |

## `<script>` (everything lives inside the single `App` namespace)

| Banner | Purpose | Key functions |
|---|---|---|
| `/* ==== CORE: helpers ==== */` | Constants and small helpers: ids, escaping, time formatting, object paths | `uid`, `escapeHTML` (`esc`), `hmToMin`, `relMin`, `fmtMS`, `fmtDur`, `getPath`, `setPath`, `$`, `$$` |
| `/* ==== DEFAULTS: prefilled content ==== */` | The whole default data object (checklists, presets, settings) and an empty day | `makeDefaults`, `newDay` |
| `/* ==== TIME: trading day + session ==== */` | Trading-day key (rolls over at `resetHour`), active days, session phase | `tradingDayKey`, `todayKey`, `isActiveDay`, `sessionPhase`, `sessionInfo`, `sessionLive` |
| `/* ==== STATE: load/save ==== */` | localStorage `checkpoint.v1`, migration by deep-filling missing keys, corrupt backup, debounced save | `load`, `normalise`, `fillMissing`, `save`, `saveNow`, `getDay`, `findPreset`, `findItem`, `findCat` |
| `/* ==== SYNC PREP: device, record ids, change stamps ==== */` | Device id/name/check-in switch (`checkpoint.v1.device`), ids + device on every record, migration of old records, `meta.updatedAt` stamps | `loadDevice`, `saveDevice`, `devId`, `pipSupported`, `migrateDayRecords`, `initStamps`, `stampChanges` |
| `/* ==== RULES: loosening + pending ==== */` | Which changes loosen a rule, the pending queue, applying it after the reset | `LOOSEN`, `isLoosening`, `propose`, `applyOp`, `applyDuePending`, `pendingFor`, `targetValue` |
| `/* ==== AUDIO + HAPTICS ==== */` | Web Audio chime, vibration, screen wake lock | `unlockAudio`, `chime`, `vibrate`, `requestWakeLock`, `releaseWakeLock` |
| `/* ==== UI: shell, modal, toast ==== */` | UI state, accent, tab switching, render dispatcher, modal/toast helpers | `ui`, `applyAccent`, `setTab`, `render`, `flashSaved`, `toast`, `openModal`, `confirmModal`, `typedConfirm` |
| `/* ==== VIEW: premarket ==== */` | Premarket tab: progress, now strip, categories, gates, focus mode | `viewPremarket`, `pmCurrent`, `pmStats`, `pmCatFolded`, `gateButtons`, `pmAfterChange` |
| `/* ==== VIEW: trade ==== */` | Trade tab: rules, session bar, checklist, hold to enter, outcomes, locks, session-over and day-done screens | `viewTrade`, `tradeCtx`, `viewTradeTop`, `urgeBlock`, `outcomeButtons`, `logTrade`, `undoTrade` (10s UNDO toast) |
| `/* ==== VIEW: cooldown ==== */` | Cooldown tab, start/replace/record, finishing, per-tick DOM update | `viewCooldown`, `startCooldown`, `recordCooldown`, `finishCooldownIfDue`, `tickCooldownDom` |
| `/* ==== VIEW: settings ==== */` | Settings root screen (sections 1–7), pending rows, switches | `viewSettings`, `pendingRow`, `sw`, `changeSetting`, `LINK_LABELS`, `BEHAVIOUR_SW`, `HOLD_FIELDS` |
| `/* ==== VIEW: checklist editor ==== */` | Shared editor for the 3 checklists, move logic (drag and keyboard) | `viewChecklistEditor`, `editorItem`, `newItem`, `moveEntry`, `moveByKey` |
| `/* ==== VIEW: preset editor ==== */` | Preset editor screen | `viewPresetEditor` |
| `/* ==== DRAG: pointer reorder ==== */` | Pointer Events drag and drop from ⠿ handles, placeholder, auto-scroll | `dragStart`, `dragMove`, `dragPlace`, `dragAutoScroll`, `dragEnd` |
| `/* ==== CHECK-INS ==== */` | Check-in schedule, due/next logic, the 4 answers, undo, chime once when due | `dueCheckinFor`, `nextCheckinFor`, `currentCheckin`, `checkinCard`, `checkinBanner`, `answerCheckin`, `undoCheckin`, `undoOffer`, `checkinTick` |
| `/* ==== FLOAT: floating window ==== */` | Document Picture-in-Picture window: open/attach, modes (main, check-in, cooldown, session over, flash), render + per-tick update | `openPip`, `attachPip`, `pipMode`, `pipView`, `pipRender`, `pipTickDom`, `floatButton` |
| `/* ==== VIEW: check-in settings ==== */` | Settings section: check-ins on this device, times + messages, question, good message, device name, open button | `checkinSettings` |
| `/* ==== HOLD: press-and-hold buttons ==== */` | Hold-to-confirm buttons (enter, urge, end early) | `bindHolds`, `bindHold`, `onHoldComplete` |
| `/* ==== DATA: export/import/reset ==== */` | JSON export, import (merge / replace), reset to defaults, clear history, erase all data; Replace/Reset/Clear/Erase blocked while the session is live | `lockedBySession`, `exportData`, `validImport`, `mergeImport`, `handleImportFile`, `resetDefaults`, `exportFirst`, `clearHistory`, `checkpointKeys`, `eraseAll` |
| `/* ==== EVENTS: actions ==== */` | Delegated click actions (`data-act`) and change handlers (`data-change`), global listeners | `ACTIONS`, `CHANGES`, `bindEvents`, `onResume` |
| `/* ==== PWA: service worker ==== */` | Registers `sw.js`, shows the "Update available · Reload" toast | `registerSW` |
| `/* ==== BOOT ==== */` | 250ms tick, startup, the public `App` api | `tick`, `init`, `api` |

## Other files

| File | Purpose |
|---|---|
| `sw.js` | Service worker. Cache `checkpoint-v3` (on activate it deletes only old `checkpoint-*` caches, never other apps' caches on the same site): network-first for the page, cache-first for icons/manifest, runtime cache for Google Fonts |
| `manifest.webmanifest` | PWA manifest (relative paths, works under `/Checkpoint/`) |
| `icons/` | App icons. Regenerate with `python3 tests/make_icons.py` (needs Pillow) |
| `tests/` | `static_checks.py` (syntax + smart quotes), `unit.test.js` (data, day key, loosening, merge), `browser.test.js` (Playwright smoke test + screenshots), `patch1.test.js` (undo, session guards, reset-hour pending, clear history, erase all), `v11.test.js` (floating window, check-ins, answers + undo, Red Day routing, sync-ready records) |
