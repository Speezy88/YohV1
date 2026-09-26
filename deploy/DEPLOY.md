# Deploying `yoh-server`

One always-on host (Spencer's Pi/home server), one systemd unit, reachable
only over the tailnet (AD-15). No staging/prod split, no containers.

The host runs two kinds of process against one SQLite file:

- the four cron one-shots (`node src/shell/ritual-cli.ts morning |
  night-prompt | night-escalate | self-check`), OS-scheduled exactly as in
  `SETUP.md`'s sample crontab. **The server does not replace or schedule
  them.** Keep the crontab as it is.
- `yoh-server` (`src/shell/server.ts`), long-running, supervised by
  systemd with `Restart=always`, bound to `127.0.0.1` only.

Both must open the **same** file: `MEMORY_DB_PATH` from the same `.env`
(default `./data/yoh-memory.db`, relative to the same working directory).
A cron one-shot's in-app notification reaches the open Web App only
through that shared file's outbox (AD-18). If the two resolve different
paths, notifications from cron silently never appear.

The only way in from another device is `tailscale serve` HTTPS on the
host's MagicDNS name. Tailnet membership is the authentication: there is
no login, cookie, or password. **Never** use `tailscale funnel`, a router
port-forward, or a public domain. Each of those exposes Yoh to the public
internet, which AD-15 forbids.

## First-time setup

1. Install Node 24.12+ on the host (`node --version`). The server runs
   TypeScript directly through Node's native type-stripping. There is no
   compile step for the server.
2. Clone the repo to `/home/spencer/yoh`. Copy `.env.example` to `.env`
   and fill it in (see `SETUP.md`). `YOH_SERVER_PORT` defaults to `8787`.
3. Install dependencies, then build:
   ```bash
   cd /home/spencer/yoh
   npm ci
   npm run build
   ```
4. Install the unit. Edit `User`, `WorkingDirectory`, `EnvironmentFile`,
   and the node path in `ExecStart` (`command -v node`) if they differ on
   this host:
   ```bash
   sudo cp deploy/yoh-server.service /etc/systemd/system/yoh-server.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now yoh-server
   ```
5. Check that it is running and bound to loopback only:
   ```bash
   systemctl status yoh-server              # active (running)
   ss -ltn | grep 8787                      # 127.0.0.1:8787 only, never 0.0.0.0 or *:8787
   curl -s http://127.0.0.1:8787/api/health # {"ok":true}
   journalctl -u yoh-server -n 20           # one JSON line per /api request, with durationMs
   ```
6. Join the host to the tailnet (`sudo tailscale up`, then
   `tailscale status`). In the Tailscale admin console, turn on
   **MagicDNS** and **HTTPS Certificates** (DNS page). `tailscale serve`
   needs both to issue the HTTPS cert.
7. Put the server on the tailnet over HTTPS:
   ```bash
   sudo tailscale serve --bg 8787
   tailscale serve status    # https://<host>.<tailnet>.ts.net -> http://127.0.0.1:8787
   tailscale funnel status   # must show no Funnel
   ```
   The `serve` config persists across reboots. If `funnel status` ever
   shows a Funnel entry, clear everything with `sudo tailscale serve reset`
   and re-run the `serve` command above.
8. From each of Spencer's devices (Mac, Windows PC), joined to the same
   tailnet, open `https://<host>.<tailnet>.ts.net/api/health`. It should
   show `{"ok":true}`.

## Every later deploy

```bash
cd /home/spencer/yoh
git pull
npm ci
npm run build
sudo systemctl restart yoh-server
```

`npm run build` runs the typecheck for now. When `web/` lands (Story 7.5),
it also builds the Vite bundle the server serves. The deploy steps stay
the same.

Confirm it came back:

```bash
systemctl status yoh-server
curl -s http://127.0.0.1:8787/api/health
```

## Rollback

```bash
cd /home/spencer/yoh
git log --oneline -5          # find the last good commit
git checkout <sha>
npm ci
npm run build
sudo systemctl restart yoh-server
```

Run `git checkout main && git pull` to return to tracking `main`.

## Troubleshooting

- **Unit keeps restarting:** run `journalctl -u yoh-server -n 50`. An
  invalid `YOH_SERVER_PORT` makes the server exit on start, and systemd
  retries every 5 s.
- **`/api/health` works on the host but not over the tailnet:** check
  `tailscale serve status` and that the device is on the tailnet
  (`tailscale status` on that device). Don't "fix" it by binding
  `0.0.0.0` or opening a port. The server must stay on loopback.
- **Live updates stall but the page loads:** watch the event stream
  directly with `curl -N https://<host>.<tailnet>.ts.net/api/events`.
  A `: keep-alive` line should arrive about every 2 s. If lines arrive in
  bursts or not at all, something between the browser and the server is
  buffering the stream (see Story 7.3's manual checklist).

## Nightly backup

`src/shell/backup-cli.ts` (Story 7.4, AD-7) copies the SQLite file with
`better-sqlite3`'s online backup API to a second, Spencer-configured
location — because the Completion Log is now irreplaceable Yoh-only data,
not something Notion holds a copy of. It is its own one-shot entry point,
separate from `ritual-cli.ts` (it isn't a ritual), OS-scheduled the same way.

Install a cron entry (e.g. `/etc/cron.d/yoh-backup`):

```
0 3 * * * spencer cd /home/spencer/yoh && /usr/bin/node src/shell/backup-cli.ts >> /var/log/yoh-backup.log 2>&1
```

Set `YOH_BACKUP_PATH` in `.env` to the real second location (another disk,
the Mac, or a USB drive) before relying on this — an unset target fails
loudly (AD-7: a Pushover alert plus an `operational` in-app notification)
rather than silently skipping the backup.

Verify it by hand once: `node src/shell/backup-cli.ts` should print
`backup-cli: backed up to <path>`, and `<path>` (named
`yoh-memory-<today>.db`) should be a valid SQLite file
(`sqlite3 <path> "PRAGMA integrity_check;"` returns `ok`).
