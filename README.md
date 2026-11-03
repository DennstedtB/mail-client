# MailClient

A desktop mail and calendar client for macOS, in the spirit of Outlook and Thunderbird. Built with Electron, React and TypeScript.

**Status:** milestone M0. The app runs with sample data; real accounts arrive in M1.

## Requirements

- macOS 13 Ventura or newer (required by Electron 45)
- Node.js 22.12 or newer (24 LTS recommended, see `.nvmrc`)
- Docker Desktop or OrbStack, for the local test mail server

## Getting started

```sh
git clone https://github.com/DennstedtB/mail-client.git
cd mail-client
npm install
npm run dev
```

The first start downloads Electron for your Mac (about 100 MB, once). The app opens with a sample mailbox. Use the arrow keys to move through the message list.

## Install the app on your Mac

To use the app like any other Mac app, without Terminal:

```sh
npm run package:mac
```

This builds `dist/mac-arm64/MailClient.app` (on an Intel Mac: `dist/mac/`). Drag it into Applications and start it from there.

The app has an ad-hoc signature, which is enough on the Mac that built it. Sharing it with other Macs needs a Developer ID signature and notarization, which come with a later milestone.

To update after new changes: `git pull`, `npm install`, `npm run package:mac`, then replace the app in Applications.

## Scripts

| Command                 | What it does                            |
| ----------------------- | --------------------------------------- |
| `npm run dev`           | Start the app with hot reload           |
| `npm run check`         | Typecheck, lint, format check and tests |
| `npm test`              | Run the unit tests                      |
| `npm run build`         | Build to `out/`                         |
| `npm run package:mac`   | Build the `.app` into `dist/`           |
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
