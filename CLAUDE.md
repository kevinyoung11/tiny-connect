# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies
npm start         # Start server (default port 8787)
npm test          # Run all tests (Node.js built-in test runner)
node --test test/connection-config.test.js  # Run a single test file
PORT=8789 npm start                         # Start on a custom port
```

Environment variables accepted by the server: `PORT` (default `8787`), `HOST` (default `0.0.0.0`), `TERMINAL_SHELL` (default `/bin/zsh` or `powershell.exe`), `STARTUP_COMMAND` (optional shell command auto-sent on connect), `LANG`, `LC_CTYPE`.

## Architecture

This is a Node.js/Express web terminal. It serves a browser-based xterm.js UI and connects it to a shell (local or SSH) via WebSocket.

**Entry point:** `server.js` — creates the Express app, HTTP server, and `WebSocketServer` at `/terminal`. Each incoming WebSocket triggers `createTerminal(ws)`.

### Connection lifecycle

1. On WebSocket open, a 1-second fallback timer fires `createLocalTransport` if no `connect` message arrives first.
2. The client sends `{ type: "connect", config: { mode: "local" | "ssh", ... } }`.
3. `buildConnectionConfig()` (`connection-config.js`) validates and normalises the config (expands `~`, resolves `keyId` → file path, validates port range).
4. `createLocalTransport` spawns `pty_bridge.py` (a Python PTY wrapper) and talks to it over stdin/stdout with newline-delimited JSON `{ type: "input"|"resize", ... }`.
5. `createSshTransport` uses the `ssh2` `Client` to open an interactive shell, relaying data directly.
6. Both transports expose the same interface: `{ input(data), resize(cols, rows), close() }`.

### WebSocket message protocol

| Direction | Message |
|---|---|
| client → server | `{ type: "connect", config }` |
| client → server | `{ type: "input", data: string }` |
| client → server | `{ type: "resize", cols, rows }` |
| server → client | `{ type: "data", data: string }` |
| server → client | `{ type: "exit", exitCode }` |

### Module responsibilities

- **`server.js`** — HTTP + WebSocket server, transport creation, REST API for key management (`GET /api/keys`, `POST /api/keys`)
- **`connection-config.js`** — pure validation/normalisation; `buildConnectionConfig(input, { resolveKeyPath })` returns a typed config object or throws
- **`key-store.js`** — `createKeyStore(directory)` factory; stores private keys as files with `0o600` permissions; metadata in `keys.json` (never exposes key material via `listKeys()`)
- **`pty_bridge.py`** — Python process that `pty.fork()`s the shell and bridges stdin/stdout JSON messages to terminal I/O; handles `TIOCSWINSZ` for resize

### Frontend

`public/client.js` is vanilla JS (no framework). It opens a WebSocket to `/terminal`, renders xterm.js in `#terminal`, and conditionally shows SSH fields. SSH key management form is inline. No build step — xterm and its fit addon are served directly from `node_modules` via static routes.

### Testing

Tests use Node's built-in `node:test` + `node:assert/strict`. Tests for `key-store` create temp directories and clean up after themselves. No mocking library — tests call the real functions.

### Key store

SSH private keys are stored in `.keys/` (created at startup with `0o700`). The directory is `.gitignore`d. Key IDs are generated as `<slugified-name>-<4-random-hex-bytes>`.
