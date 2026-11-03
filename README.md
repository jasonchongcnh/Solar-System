# Solar-System

GitHub Pages dashboard for the smart floating solar power system.

## ESP32 Hall-Sensor Firmware

The **UNO R4 WiFi access point + local MQTT** architecture has separate [gateway/node firmware and setup instructions](firmware/MQTT.md). The UNO creates `HexagonSolar-UNO-R4`; XIAO ESP32-C3 nodes and a computer running Mosquitto join that AP. Its AP configuration requests nine stations for up to eight XIAOs plus the broker computer, using a compatible official connectivity firmware. The UNO aggregates their MQTT data, and the console connects through UNO USB or the computer's MQTT-to-WebSocket bridge. No external router is required. The ESP-NOW sketches below are the legacy alternative.

The replacement [node and gateway firmware](firmware/README.md) supports six digital Hall inputs on board pins D0–D5, fixed-channel ESP-NOW, acknowledged commands, USB Serial, and an actual WebSocket gateway. D6–D8 hardware-ID mode is optional and disabled until the circuit is confirmed. The guide includes board selection, wiring assumptions, dependencies, and connection instructions; [the review](firmware/REVIEW.md) explains the problems found in the originals.

Live Hall-only packets display unavailable electrical measurements as `--`. Firmware downloads in the console load the real source and headers from `firmware/`. Run `node scripts/hardware-protocol-smoke.mjs` for the browser protocol regression, and `scripts/check-firmware.ps1` for Arduino compilation with already-installed dependencies. Select the actual boards before uploading.

## Files

- `management-console.html` - main management console page
- `assets/css/management-console.css` - console styling
- `assets/css/console-workspace.css` - workspace presentation and responsive design
- `assets/css/theme.css` - shared light and dark colour palettes
- `assets/js/theme.js` - device theme detection and saved appearance preferences
- `assets/js/management-console.js` - console behavior
- `assets/js/management-console-i18n.js` - English and Traditional Chinese translations
- `assets/js/console-workspace.js` - telemetry charts, icons, and keyboard accessibility
- `data/telemetry-sample.json` - structured telemetry sample used by the scheduled report
- `scripts/build-daily-summary.mjs` - scheduled daily report generator
- `scripts/responsive-smoke.mjs` - browser smoke test for the console and standalone page
- `.github/workflows/daily-summary-email.yml` - GitHub Actions email/report automation
- `.github/workflows/regression-checks.yml` - automated regression checks

## Data Source

The dashboard now keeps device telemetry in one shared in-browser data model. Device tables, CSV exports, power logs, dashboard metrics, notification previews, and daily summary previews all read from the same records. In simulation mode the browser seeds stable sample readings; live Web Serial or WebSocket telemetry packets replace those readings as they arrive.

The GitHub Actions daily report reads `data/telemetry-sample.json` by default. To connect real telemetry later, generate a JSON file with the same metric fields and set `TELEMETRY_FILE` for the report script, or keep using the existing environment overrides such as `ACTIVE_MODULES`, `CURRENT_OUTPUT_KW`, and `ALERT_COUNT`.

This is still a static GitHub Pages app. Browser sessions, users, and settings are useful for a demo console, but production authentication and cross-device synchronization need a backend service.

## Connection Reliability

Live WebSocket gateway connections now retry automatically with a bounded backoff. If live telemetry stops arriving for more than 30 seconds, the base-station status changes to `STALE DATA` and affected live rows show a `STALE` status. Hardware commands are still recorded in the terminal when no live transport is connected, making simulation mode explicit.

## Daily Email Setup

Add these repository secrets before enabling the workflow:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_TO`
- `EMAIL_FROM`

Optional repository variable:

- `DASHBOARD_URL`

The workflow runs daily at 08:00 Hong Kong time and can also be started manually from the GitHub Actions tab.

## Regression Checks

Run `npm ci`, `npx playwright install chromium`, then `npm test`. The quality audit checks six viewport widths, both console languages, and both themes, captures desktop/mobile evidence, and checks WCAG A/AA rules with axe. It also tests theme persistence and all three password-protected role upgrades with isolated test accounts. Screenshots and JSON results are generated in `.artifacts/quality/`; the regression workflow saves them as an artifact. See [the quality review](docs/QUALITY.md) for the design criteria, iteration notes, and testing boundaries.

The localization sweep checks Chinese labels and tooltips after switching from English, including settings defaults, hardware states, firmware loading errors, reports, and Array Lab. Raw firmware and packet contents are compared byte-for-byte; email addresses and user-edited values must survive language changes. Run `npm run test:locale` for the focused sweep. Its evidence is saved in `.artifacts/quality/localization.json`.

Icons and fonts work without third-party requests at page load. The local Lucide bundle includes only the icons used by the console and Array Lab; run `npm run build:icons` after adding an icon to `scripts/icons-entry.js`. The generated bundle and license ship with the static site, so GitHub Pages deployment needs no build server.

GitHub Actions runs `npm test` on push, pull request, and manual dispatch. The test command checks JavaScript syntax, builds the daily summary report, then opens the static pages in Chromium to verify login bootstrapping, responsive navigation, dashboard/report metric consistency, table rendering, canvas rendering, and horizontal overflow.

On this local Windows profile, the global `npm` command may need repair if it points to a missing npm CLI. The same checks can be run directly with:

```powershell
node --check assets/js/management-console.js
node --check assets/js/management-console-i18n.js
node --check scripts/build-daily-summary.mjs
node scripts/build-daily-summary.mjs
node scripts/responsive-smoke.mjs
```

## Cross-Device Access

The sun/moon button changes appearance immediately. In System Settings, Appearance offers System Default, Light Mode, and Dark Mode. System Default follows device preference changes; an explicit choice overrides it and is saved in this browser. The login screen, console dialogs, and Array Lab share the preference, including updates between open tabs. This does not synchronize the preference between devices.

When switching guest to operator/admin or operator to admin, empty or incorrect passwords produce a persistent error inside the verification dialog. Editing the password clears the error; an unsuccessful attempt leaves the account and session unchanged.

Open the hosted `management-console.html` URL on each device. When using GitHub Pages, commit and push the updated HTML, CSS, and JavaScript together, then wait for the Pages deployment to finish.

The console adapts to phones, tablets, desktop screens, and landscape orientation. On smaller screens, the header menu opens navigation; tables scroll horizontally within their own regions, and dialogs scroll vertically. Both English and Traditional Chinese layouts are supported. The standalone `solar-system.html` page also resizes its controls and interactive diagram.

Resizing or rotating a device preserves the current canvas state. Login sessions, language preferences, and saved settings remain local to each browser; this responsive layout does not synchronize them between devices.
