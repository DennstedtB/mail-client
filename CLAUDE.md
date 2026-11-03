# MailClient

A desktop mail and calendar client in the spirit of Outlook and Thunderbird. macOS first; Windows and Linux later. It started as a learning project (Bastian's first large application built with AI) and may become a daily driver, so build it with daily-driver quality in mind.

Read this file before changing anything. Keep it current when architecture, conventions or milestone status change.

## Commands

```sh
npm run dev           # start the app with hot reload (downloads Electron on first run)
npm run check         # typecheck + lint + format check + tests (must pass before every commit)
npm test              # unit tests (Vitest)
npm run build         # typecheck and build to out/
npm run package:mac   # ad-hoc signed .app in dist/ (macOS only)
npm run mailserver:up # local Stalwart test server, see docs/dev-mail-server.md
```

## Architecture

Electron with three isolated parts and one shared contract:

| Path            | Runs in                  | Responsibility                                                       |
| --------------- | ------------------------ | -------------------------------------------------------------------- |
| `src/main/`     | Node.js (main process)   | Accounts, providers, services, all network and disk I/O, credentials |
| `src/preload/`  | Sandboxed preload        | Exposes `window.api`, built from the contract. Nothing else.         |
| `src/renderer/` | Chromium, no Node access | React UI only                                                        |
| `src/shared/`   | Imported by all three    | Domain types and the IPC contract. No runtime dependencies.          |

Data flow: UI → `window.api.mail.listMessages()` → preload → `ipcRenderer.invoke('mail:listMessages')` → `registerApi` in `src/main/ipc.ts` → `MailService` → `MailProvider` for that account.

### Rules that keep the architecture intact

1. **The IPC contract is the only seam.** `src/shared/ipc-contract.ts` defines `Api`. To add a capability, add it to the interface and to `API_METHODS`; the type check fails until both match. The UI never imports from `src/main/`, and never uses `ipcRenderer` directly.
2. **Everything crossing the contract is JSON-serializable.** No `Date`, `Map`, `Buffer` or class instances; dates are ISO 8601 strings. This keeps a later backend swap (e.g. Tauri) possible.
3. **Protocols live behind providers.** `MailProvider` / `CalendarProvider` in `src/main/providers/types.ts`. Services and UI never import ImapFlow, Nodemailer, tsdav or Graph clients. Microsoft 365 (M6) is another provider, not a special case.
4. **Local-first (from M2).** The UI reads from a local SQLite cache; a sync engine fills it from the providers in the background.
5. **Multiple accounts are part of the model.** The UI shows one account in v1, but every call carries an `accountId`.

### Security baseline (do not weaken)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` for every window.
- IPC handlers reject calls from frames that are not the app's own UI. The check (`src/main/app-url.ts`) compares parsed URLs, never string prefixes, and is covered by tests.
- Strict CSP in `src/renderer/index.html`. No remote scripts, fonts or styles; bundle what is needed.
- The window can't navigate away from the app; new windows are denied, and https links open in the default browser.
- Permission requests (camera, notifications, …) are denied until a feature needs one.
- From M1: credentials only via Electron `safeStorage` (macOS Keychain). Never in plain files, logs or the renderer.
- From M2: HTML mail only in a sandboxed iframe, sanitized with DOMPurify, remote content blocked by default.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on. No `any`; prefer `unknown` and narrow.
- Prettier (no semicolons, single quotes, width 100) and ESLint decide formatting and style; run `npm run format`.
- Tests live next to the code as `*.test.ts`. New logic in `src/main` and `src/shared`, and pure helpers in the renderer, gets tests.
- Dependencies: libraries used by the main process at runtime go in `dependencies` (they are shipped in the app). Everything bundled into the renderer, and all tooling, goes in `devDependencies`.
- UI copy: English, sentence case, plain verbs. Inactive features stay visible with a tooltip naming the milestone that brings them.
- Failed loads are shown with their reason; they must never look like an empty list.
- Relative dates ("Yesterday", today's highlight) use `useToday()`, which updates at midnight.
- CI: workflows run with read-only permissions, `persist-credentials: false`, and actions pinned to commit SHAs (Dependabot updates them).
- Code review: CodeRabbit reviews every pull request (config in `.coderabbit.yaml`). Reply to each finding with what changed, or why it was skipped.

## UI design

Quiet native chrome in the system font; the message is the focus, set in Source Serif 4 (bundled, `font-serif`). One accent color, petrol, used for unread markers, selection and focus.

Tokens are CSS variables in `src/renderer/src/index.css` (light and dark) and mapped to Tailwind colors: `paper`, `surface`, `sidebar`, `ink`, `ink-muted`, `ink-faint`, `line`, `accent`, `accent-soft`, `selection`, `selection-ink`. Use these instead of raw colors. Toolbars are 52px high and act as window drag regions (`drag-region`; interactive children need `no-drag`).

## Libraries (planned per milestone)

ImapFlow (IMAP), Nodemailer (SMTP), mailparser (MIME), DOMPurify (HTML sanitizing), tsdav (CalDAV), ical.js (iCalendar and recurrence), FullCalendar (calendar views), better-sqlite3 + Drizzle (local cache), @azure/msal-node + Microsoft Graph (M6). Check the current version and maintenance status before adding any of them.

## Milestones

- [x] **M0 Scaffold:** Electron + React + TypeScript, typed IPC contract, provider interfaces, mock provider, three-pane layout, calendar placeholder, tooling, Stalwart dev server
- [ ] **M1 Account setup:** manual IMAP/SMTP configuration, connection test, credentials in the Keychain
- [ ] **M2 Reading mail:** real folders and messages, safe HTML rendering, attachments, local cache, IMAP IDLE
- [ ] **M3 Writing mail:** compose, reply / forward, attachments, send, save to Sent
- [ ] **M4 Mail actions:** read / unread, flag, move, delete, local search
- [ ] **M5 Calendar:** CalDAV, day / week / month views, create / edit / delete events, show recurring events
- [ ] **M6 Microsoft 365:** Entra app registration, MSAL sign-in, Graph mail and calendar providers
- Later: multiple accounts and unified inbox, meeting invitations, editing recurring events, contacts, notifications, full-text search, signing and auto-update, Windows / Linux

## Workflow

- One branch per step (`m1-account-setup`, …), a pull request into `main`, Bastian tests and merges.
- `npm run check` passes before every commit.
- Keep steps small; every merge leaves a runnable app.
