# Spend Notch

[![ci](https://img.shields.io/github/actions/workflow/status/anjulalk/spendnotch/ci.yml?branch=main&label=ci&labelColor=44403a&style=flat-square)](https://github.com/anjulalk/spendnotch/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/anjulalk/spendnotch?label=release&labelColor=44403a&color=5f5a51&style=flat-square)](https://github.com/anjulalk/spendnotch/releases/latest)
[![platform](https://img.shields.io/badge/platform-windows-5f5a51?labelColor=44403a&style=flat-square)](https://github.com/anjulalk/spendnotch/releases/latest)
[![license](https://img.shields.io/badge/license-MIT-c1603c?labelColor=44403a&style=flat-square)](LICENSE)

A MacBook-style notch for Windows that shows what your local AI coding agents have cost you **today**, in US dollars.

<p align="center">
  <img src="docs/collapsed.png" width="520" alt="Collapsed notch showing today's AI coding spend">
  <br><br>
  <img src="docs/expanded.png" width="520" alt="Expanded notch with a source-aware model breakdown and month-to-date spend">
  <br>
  <sub>Screenshots use synthetic demo data.</sub>
</p>

- Sits at the top center of your primary screen, always on top and click-through.
- Hover to expand it: source-aware model breakdown, Copilot AI credits, calls and month-to-date spend.
- Tracks the Copilot app/CLI and local OpenCode V1, V2 and Desktop sessions.
- Updates live as you use Copilot or OpenCode. The green dot pulses while requests are flowing.
- Lives in the tray: show/hide, start with Windows, quit.

## Install

Download `SpendNotch-Setup-<version>.exe` from the [latest release](https://github.com/anjulalk/spendnotch/releases/latest) and run it. The installer isn't code-signed, so Windows SmartScreen may ask you to confirm (**More info → Run anyway**).

## How it measures

Spend Notch combines usage from the local GitHub Copilot and OpenCode clients. Every store is opened read-only. If one source is temporarily unavailable, valid data remains visible with a **Partial data** warning.

### GitHub Copilot

Copilot bills in AI credits: **1 AI credit = $0.01 USD**, priced per token for each model. The Copilot app and CLI record each call in `%USERPROFILE%\.copilot\session-store.db` with its cost in nano AI credits (`total_nano_aiu`):

```
USD = total_nano_aiu / 1e9 × 0.01
```

Only Copilot app and Copilot CLI usage is counted. Usage from VS Code, github.com, cloud agent or code review isn't in the local store.

### OpenCode

Spend Notch reads `%USERPROFILE%\.local\share\opencode` and supports:

- OpenCode V1 and V2 SQLite stores (`opencode*.db`), including migrated records stored in both schema families.
- Legacy V1 JSON session stores.
- OpenCode Desktop's local usage, which uses the same OpenCode data directory as its sidecar.

Assistant-message cost is already stored in USD, so daily and monthly totals use those per-message values. V2 title and compaction usage events are included once. Duplicate V1/V2 projections are counted once by session and message ID. Models without known OpenCode pricing can report a zero cost while still contributing to the call count.

- **Today** starts at local midnight. **Month to date** starts at local midnight on the 1st.
- Set `SPEND_NOTCH_DB` to use a different Copilot store.
- Set `SPEND_NOTCH_OPENCODE_DB`, or OpenCode's own `OPENCODE_DB`, to use a different OpenCode database. An explicit database override is authoritative and disables default database/legacy JSON discovery.
- OpenCode usage is local-only. A Desktop instance connected to a remote OpenCode server is not visible in Spend Notch.

## Develop

```
npm install
npm run dev     # Vite + Electron with hot reload
npm run build   # typecheck + production build
npm start       # run the production build
npm run dist    # Windows installer in release/
```

Stack: Electron 44, Vite 8, React 19, TypeScript 7, Tailwind CSS 4, Motion and NumberFlow. It uses Node's built-in `node:sqlite`, so there are no native modules. See [AGENTS.md](AGENTS.md) for architecture notes and conventions.

## Release

GitHub Actions builds releases on Windows and publishes them with the installer attached.

- **Pull request:** merge a PR labeled `release:patch`, `release:minor` or `release:major`. The release workflow bumps `main`, tags it, builds the installer and publishes the GitHub release.
- **Manual:** dispatch `release.yml` with a `bump` of `patch`, `minor` or `major`, or push a matching `v*` tag:

  ```
  git tag v0.2.0
  git push origin v0.2.0
  ```

- **Dependabot:** a merged security or Electron update automatically dispatches a patch release.

The release notes come from `.github/release-notes.md`, followed by the generated changelog.

## Dependency updates

Dependabot checks npm weekly and GitHub Actions monthly. It opens security updates as soon as an advisory lands. Once CI passes, security, minor and patch updates are approved and merged automatically. Major updates wait for review.

## License

[MIT](LICENSE)
