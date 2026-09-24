# AGENTS.md

Guidance for AI coding agents working on Spend Notch.

## What this is

A Windows desktop widget: a MacBook-style notch pinned to the top center of the primary display that shows today's combined GitHub Copilot and OpenCode spend in USD. Hovering expands it into a source-aware model breakdown with Copilot AI credits, calls and month-to-date spend.

## Stack

- Electron 44 (main process + sandboxed preload), built with Vite 8 through `vite-plugin-electron`
- React 19, TypeScript 7 (strict), Tailwind CSS 4, Motion, NumberFlow
- Node's built-in `node:sqlite` for data access. There are no native modules, so keep it that way.

## Layout

| Path | Purpose |
| --- | --- |
| `electron/main.ts` | Window, tray, IPC, display placement |
| `electron/db.ts` | Merges read-only Copilot and OpenCode usage and owns the file watcher |
| `electron/opencode.ts` | Reads OpenCode V1/V2 SQLite and legacy JSON usage |
| `electron/preload.ts` | Exposes `window.api` (`snap`, `on`, `hover`) via `contextBridge` |
| `src/App.tsx` | Notch UI, collapsed and expanded |
| `src/usage.ts` | Credit/USD math and formatting, shared with the main process |
| `src/models.ts` | Model display names and colors |
| `src/types.ts` | Types shared across processes |
| `public/` | Tray icons, copied to `dist/` |
| `build/icon.ico` | App and installer icon |

## Commands

```
npm install
npm run dev        # Vite dev server + Electron with hot reload
npm run typecheck
npm run build      # typecheck + production build into dist/ and dist-electron/
npm start          # run the production build
npm run dist       # NSIS installer in release/
```

There is no test suite. Validate changes with `npm run build`, then run the app.

## Data sources

- The app reads `%USERPROFILE%\.copilot\session-store.db` (override with `SPEND_NOTCH_DB`), table `assistant_usage_events`. The Copilot app and Copilot CLI write one row per model call.
- Copilot cost per call is `total_nano_aiu` in nano AI credits. USD = `nano / 1e9 × 0.01`; see `CREDIT_USD` in `src/usage.ts`.
- OpenCode data lives under `%USERPROFILE%\.local\share\opencode` (or `$XDG_DATA_HOME\opencode`). Support `opencode*.db` V1/V2 SQLite schemas, legacy JSON stores, and Desktop's shared local data. `OPENCODE_DB` or `SPEND_NOTCH_OPENCODE_DB` is authoritative and disables default database/legacy JSON discovery.
- OpenCode assistant messages contain a USD `cost`; aggregate per-message rows, not cumulative session totals, and deduplicate migrated V1/V2 rows by session and message ID.
- Copilot `created_at` mixes ISO (`2026-09-23T05:22:23.610Z`) and SQLite (`2026-09-23 05:22:23`) timestamps. Compare with `unixepoch(created_at)`, never as raw strings.
- "Today" starts at local midnight. "Month" starts at local midnight on the 1st.
- Open every database read-only and never write to it. Both applications own their stores and may run them in WAL mode.

## Window behavior (don't break)

- The window is transparent, frameless, non-focusable, always on top (`screen-saver` level) and click-through via `setIgnoreMouseEvents(true, { forward: true })`. The renderer calls `api.hover(true | false)` on pointer enter/leave to toggle click-through.
- Never give `html`, `body` or `#root` a background, because the window must stay transparent.
- The preload must stay CommonJS (`preload.cjs`), because the renderer is sandboxed.
- Renderer libraries are devDependencies on purpose. Vite bundles them, and electron-builder only ships `dist/` and `dist-electron/`.
- Keep `"publish": null` in the electron-builder config. Without it, a `GH_TOKEN` in the environment makes electron-builder try to publish to GitHub.

## Conventions

- Use short names for properties, methods and classes (`snap`, `rows`, `nano`, `push`).
- Don't add code comments unless the code would be unclear without them.
- Ask the maintainer before making design decisions or touching code unrelated to the task.
- Prefer Tailwind utilities. Use plain CSS only where utilities don't fit, such as the notch ears.
- The collapsed notch is 232×34 and sits over other apps' title bars, so keep it small.

## Automation

- `ci.yml` typechecks and builds on every push to `main` and on every PR.
- `dependabot-merge.yml` runs after CI succeeds on a Dependabot PR:
  - It approves and squash-merges security, minor and patch updates. Majors wait for review.
  - A successful minor update dispatches a minor release; patch, security and other approved updates dispatch a patch release.
- `release.yml` builds the NSIS installer:
  - A pushed `v*` tag publishes that version.
  - A dispatch with `bump` set to `patch`, `minor` or `major` commits the version bump as `github-actions[bot]`, tags it and publishes it.
  - A merged PR labeled `release:patch`, `release:minor` or `release:major` requests the corresponding release. The workflow checks out `main`, never PR code.
  - `bump: none` only builds the installer.
- Merges and pushes made with `GITHUB_TOKEN` don't trigger other workflows. Don't switch to GitHub's native auto-merge, or the release would never run.
- The `security` group (`applies-to: security-updates`) in `.github/dependabot.yml` is how security PRs are detected. Keep its name.

## Verifying UI

Don't screen-capture the desktop. Launch the app with `--remote-debugging-port=<port>` and connect over CDP. Then:

- `Emulation.setDefaultBackgroundColorOverride` with alpha 0 keeps captures transparent.
- `Page.captureScreenshot` grabs the window.
- `Input.dispatchMouseEvent` (`mouseMoved` over the notch) expands it.

Point `SPEND_NOTCH_DB` and `SPEND_NOTCH_OPENCODE_DB` at synthetic databases for screenshots, so no real usage data is captured.
