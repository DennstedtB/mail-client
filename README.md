# MailClient

A desktop mail and calendar client for macOS, in the spirit of Outlook and Thunderbird. Built with Electron, React and TypeScript.

**Status:** milestone M0. The app runs with sample data; real accounts arrive in M1.

## Requirements

- macOS
- Node.js 22.12 or newer (24 LTS recommended, see `.nvmrc`)
- Docker Desktop or OrbStack, for the local test mail server

## Getting started

```sh
git clone https://github.com/DennstedtB/mail-client.git
cd mail-client
npm install
npm run dev
```

The app opens with a sample mailbox. Use the arrow keys to move through the message list.

## Scripts

| Command                 | What it does                            |
| ----------------------- | --------------------------------------- |
| `npm run dev`           | Start the app with hot reload           |
| `npm run check`         | Typecheck, lint, format check and tests |
| `npm test`              | Run the unit tests                      |
| `npm run build`         | Build to `out/`                         |
| `npm run package:mac`   | Build an unsigned `.app` into `dist/`   |
| `npm run mailserver:up` | Start the local test mail server        |

## Project layout

```
src/
  main/        Electron main process: services, providers, IPC handlers
  preload/     Exposes the typed API to the UI
  renderer/    React UI
  shared/      Domain types and the IPC contract
dev/stalwart/  Local test mail server (Docker)
docs/          Developer docs
```

Architecture, conventions and the roadmap are in [CLAUDE.md](CLAUDE.md). The local mail server setup is in [docs/dev-mail-server.md](docs/dev-mail-server.md).
