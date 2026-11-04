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
npm run mailserver:send-test -- --password 'BOB_PASSWORD'  # test message bob → alice
```

## Architecture

Electron with three isolated parts and one shared contract:

| Path            | Runs in                  | Responsibility                                                       |
| --------------- | ------------------------ | -------------------------------------------------------------------- |
| `src/main/`     | Node.js (main process)   | Accounts, providers, services, all network and disk I/O, credentials |
| `src/preload/`  | Sandboxed preload        | Exposes `window.api`, built from the contract. Nothing else.         |
| `src/renderer/` | Chromium, no Node access | React UI only                                                        |
| `src/shared/`   | Imported by all three    | Domain types and the IPC contract. No runtime dependencies.          |

Data flow: UI → `window.api.mail.listFolders()` → preload → `ipcRenderer.invoke('mail:listFolders')` → `registerApi` in `src/main/ipc.ts` → `MailService` → `AccountService` finds the account's `MailProvider` → ImapFlow.

Main-process modules:

| Path                                   | Responsibility                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/main/accounts/account-service.ts` | Adds, lists, removes accounts; owns one provider per account; sample mailbox while none exists |
| `src/main/accounts/account-store.ts`   | Account settings in `accounts.json` (no passwords)                                             |
| `src/main/accounts/secret-store.ts`    | Passwords in `credentials.json`, encrypted with `safeStorage` (Keychain key)                   |
| `src/main/providers/imap-smtp/`        | ImapFlow / Nodemailer: connection options, connection check, readable errors, folders          |
| `src/main/providers/mock/`             | Sample mailbox                                                                                 |
| `src/main/storage/json-file.ts`        | Atomic JSON writes (0600), write queue                                                         |

Data lives in `app.getPath('userData')`, on macOS `~/Library/Application Support/MailClient`.

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
- Passwords only via `EncryptedSecretStore` (Electron `safeStorage`, async API; key in the macOS Keychain). In plain text a password exists only in the "Add account" form while the user types it, in the one `accounts.add` request that sends it to the main process, and in main-process memory. Never in files, logs or IPC responses, and the renderer never gets it back. On Linux, the weak `basic_text` backend counts as unavailable.
- No unencrypted connections: TLS or required STARTTLS only. Certificates are always verified, except a self-signed one for a loopback host when the account allows it (`isLoopbackHost`), and that rule is enforced in the main process, not just the form.
- ImapFlow and Nodemailer run with `logger: false`; nothing about accounts goes to the console.
- From M2: HTML mail only in a sandboxed iframe, sanitized with DOMPurify, remote content blocked by default.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on. No `any`; prefer `unknown` and narrow.
- Prettier (no semicolons, single quotes, width 100) and ESLint decide formatting and style; run `npm run format`.
- Tests live next to the code as `*.test.ts`. New logic in `src/main` and `src/shared`, and pure helpers in the renderer, gets tests. `live-server.test.ts` runs against the local Stalwart server only when `MAILCLIENT_LIVE_PASSWORD` is set.
- Form validation lives in `src/shared/account-validation.ts` and runs in both the UI and the main process.
- Dependencies: libraries used by the main process at runtime go in `dependencies` (they are shipped in the app). Everything bundled into the renderer, and all tooling, goes in `devDependencies`.
- UI copy: English, sentence case, plain verbs. Inactive features stay visible with a tooltip naming the milestone that brings them.
- Failed loads are shown with their reason; they must never look like an empty list.
- Relative dates ("Yesterday", today's highlight) use `useToday()`, which updates at midnight.
- CI: workflows run with read-only permissions, `persist-credentials: false`, and actions pinned to commit SHAs (Dependabot updates them).
- Code review: CodeRabbit reviews every pull request (config in `.coderabbit.yaml`). Reply to each finding with what changed, or why it was skipped.

## UI design

Quiet native chrome in the system font; the message is the focus, set in Source Serif 4 (bundled, `font-serif`). One accent color, petrol, used for unread markers, selection and focus.

Tokens are CSS variables in `src/renderer/src/index.css` (light and dark) and mapped to Tailwind colors: `paper`, `surface`, `sidebar`, `ink`, `ink-muted`, `ink-faint`, `line`, `accent`, `accent-soft`, `selection`, `selection-ink`, `danger` and `danger-contrast` (errors and destructive actions). Use these instead of raw colors. Toolbars are 52px high and act as window drag regions (`drag-region`; interactive children need `no-drag`). Dialogs use the native `<dialog>` via `components/Modal.tsx`.

## Libraries

In use: ImapFlow 2 (IMAP), Nodemailer 10 (SMTP). Planned: mailparser (MIME), DOMPurify (HTML sanitizing), tsdav (CalDAV), ical.js (iCalendar and recurrence), FullCalendar (calendar views), better-sqlite3 + Drizzle (local cache), @azure/msal-node + Microsoft Graph (M6). Check the current version and maintenance status before adding any of them.

## Milestones

- [x] **M0 Scaffold:** Electron + React + TypeScript, typed IPC contract, provider interfaces, mock provider, three-pane layout, calendar placeholder, tooling, Stalwart dev server
- [x] **M1 Account setup:** manual IMAP/SMTP configuration, connection check with readable errors, password in the Keychain, real folders with unread counts, one sidebar section per account, remove account
- [ ] **M2 Reading mail:** real messages, safe HTML rendering, attachments, local cache, IMAP IDLE
- [ ] **M3 Writing mail:** compose, reply / forward, attachments, send, save to Sent
- [ ] **M4 Mail actions:** read / unread, flag, move, delete, local search
- [ ] **M5 Calendar:** CalDAV, day / week / month views, create / edit / delete events, show recurring events
- [ ] **M6 Microsoft 365:** Entra app registration, MSAL sign-in, Graph mail and calendar providers
- Later: multiple accounts and unified inbox, meeting invitations, editing recurring events, contacts, notifications, full-text search, signing and auto-update, Windows / Linux

## Workflow

- One branch per step (`m1-account-setup`, …), a pull request into `main`, Bastian tests and merges.
- `npm run check` passes before every commit.
- Keep steps small; every merge leaves a runnable app.
