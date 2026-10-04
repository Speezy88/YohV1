# Moving Yoh to a Raspberry Pi

Goal: Yoh's server and its four scheduled rituals run on an always-on Raspberry Pi, reached from your Mac and Windows PC over Tailscale. The Mac stops being the host.

Time: about an hour. You need the Pi (4 or 5; 4 GB+ RAM recommended), its power supply, a microSD card (32 GB+) or a USB SSD (faster, more reliable; recommended), and your Mac.

---

## 1. Flash the operating system (on your Mac)

1. Install **Raspberry Pi Imager** from raspberrypi.com/software.
2. Choose your device, then **Raspberry Pi OS Lite (64-bit)**. Lite has no desktop, which Yoh doesn't need.
3. Choose the SD card or SSD.
4. Click **Edit settings** (the gear) and set:
   - hostname: `yoh`
   - username: `spencer`, plus a password
   - Wi-Fi name and password (or use Ethernet)
   - **time zone: America/Los_Angeles**, so Yoh's "today" matches yours
   - Services: **enable SSH**, using a password or your Mac's public key
5. Write the card, put it in the Pi, and power it on. Wait about 2 minutes.
6. From your Mac's Terminal: `ssh spencer@yoh.local`

## 2. Install Node 24 and build tools (on the Pi)

```
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git build-essential python3 sqlite3
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version      # must be v24.12 or newer
```

`build-essential` and `python3` let `better-sqlite3` compile if no prebuilt ARM64 binary is available.

## 3. Join your Tailscale network (on the Pi)

```
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up          # open the printed link and sign in
tailscale status           # the Pi appears as "yoh"
```

In the Tailscale admin console (DNS page), make sure **MagicDNS** and **HTTPS Certificates** are on.

## 4. Get the code onto the Pi

**Option A: GitHub (recommended; makes updates one command).** Once the repo is on a private GitHub:
```
git clone git@github.com:<you>/YohV1.git ~/yoh
```

**Option B: copy from your Mac (no GitHub).** From the **Mac**:
```
rsync -av --exclude node_modules --exclude web/node_modules --exclude .claude \
  ~/Documents/GitHub/YohV1/ spencer@yoh.local:~/yoh/
```

Then on the Pi:
```
cd ~/yoh && npm ci && npm ci --prefix web && npm run build:web
```

## 5. Bring over your secrets and data (from the Mac)

Stop the Mac's Yoh services first, so the database isn't mid-write:
```
launchctl bootout gui/$(id -u)/com.yoh.server
launchctl bootout gui/$(id -u)/com.yoh.morning
launchctl bootout gui/$(id -u)/com.yoh.night-prompt
launchctl bootout gui/$(id -u)/com.yoh.night-escalate
launchctl bootout gui/$(id -u)/com.yoh.self-check   # retired job; only needed if it is still loaded
```
Then copy the `.env`, the database and the stored Google token file:
```
scp ~/Documents/GitHub/YohV1/.env spencer@yoh.local:~/yoh/.env
rsync -av ~/Documents/GitHub/YohV1/data/ spencer@yoh.local:~/yoh/data/
```
If `GOOGLE_TOKEN_FILE_PATH` in `.env` points outside `data/`, copy that file too and fix the path in the Pi's `.env`. Also set `YOH_BACKUP_PATH` to a folder on a USB drive plugged into the Pi, e.g. `/media/spencer/BACKUP/yoh`.

## 6. Run the server as a service (on the Pi)

Edit `deploy/yoh-server.service`:
- `User=spencer`
- `WorkingDirectory=/home/spencer/yoh`
- `EnvironmentFile=/home/spencer/yoh/.env`
- `ExecStart=/usr/bin/node src/shell/server.ts` (check the path with `command -v node`)

Then install and start it:
```
sudo cp deploy/yoh-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yoh-server
curl -s http://127.0.0.1:8787/api/health     # {"ok":true}
sudo tailscale serve --bg 8787
tailscale serve status                        # note the https://yoh.<tailnet>.ts.net address
```

## 7. Schedule the rituals (on the Pi)

`crontab -e`, then add:
```
0 7 * * *  cd /home/spencer/yoh && /usr/bin/node --env-file=.env src/shell/ritual-cli.ts morning        >> /home/spencer/yoh/logs/morning.log 2>&1
0 21 * * * cd /home/spencer/yoh && /usr/bin/node --env-file=.env src/shell/ritual-cli.ts night-prompt   >> /home/spencer/yoh/logs/night-prompt.log 2>&1
0 23 * * * cd /home/spencer/yoh && /usr/bin/node --env-file=.env src/shell/ritual-cli.ts night-escalate >> /home/spencer/yoh/logs/night-escalate.log 2>&1
17 3 * * * cd /home/spencer/yoh && /usr/bin/node --env-file=.env src/shell/backup-cli.ts                >> /home/spencer/yoh/logs/backup.log 2>&1
```
Then create the log folder: `mkdir -p ~/yoh/logs`

**Retired: disable the self-check timer.** The four-day Self-Check is gone (the Rating replaced it), so `ritual-cli.ts self-check` now exits with a usage error. On the Pi, find and disable whatever still triggers it: `systemctl list-timers | grep -i self` on `yoh`, then `sudo systemctl disable --now <that-timer>`; also delete any `self-check` line from `crontab -e`. On the Mac, run `launchctl bootout gui/$(id -u)/com.yoh.self-check` if the job is still loaded.

## 8. Point your devices at the Pi

- On the Mac and Windows PC, open `https://yoh.<tailnet>.ts.net` and install it as an app: Safari **File → Add to Dock**, or Chrome **Install app**. Remove the old `127.0.0.1` Dock app.
- Remove the Mac's now-stopped Yoh agents so they never run again:
  ```
  rm ~/Library/LaunchAgents/com.yoh.*.plist
  ```

## 9. Updating Yoh later

With GitHub:
```
cd ~/yoh && git pull && npm ci && npm ci --prefix web && npm run build:web && sudo systemctl restart yoh-server
```

Without GitHub, re-run the rsync from step 4 (never overwrite `.env` or `data/`), then the same install, build and restart.

## If something's wrong

- **Server logs:** `journalctl -u yoh-server -n 100`
- **Ritual logs:** `~/yoh/logs/*.log`
- **Wrong "today":** check the Pi's time zone with `timedatectl`, and set it with `sudo timedatectl set-timezone America/Los_Angeles`.
- **Won't load from another device:** check `tailscale serve status`, and that the device is signed in to the same tailnet.

## Importing a Claude data export into memory

Run on the Mac, from the repo. The export and the candidates file stay outside the repo.

1. Download the `projects`, `memories` and `conversations` zips named in the export manifest and unzip each into its own folder under `~/Documents/claude-export` (`projects/`, `memories/`, `conversations/`).
2. Extract candidates (prints an estimate first; over $5 it stops until you add `--yes`):

   ```bash
   node --env-file=.env src/shell/claude-export-cli.ts ~/Documents/claude-export --out ~/Documents/Yoh-previews/claude-candidates.md
   ```

   If it reports failed calls, run the same command again; finished calls are cached.
3. Edit `claude-candidates.md`: delete lines, reword, move lines between headings.
4. Dry run against the Pi, then the real import:

   ```bash
   curl -sS -X POST -H 'Content-Type: text/markdown' --data-binary @"$HOME/Documents/Yoh-previews/claude-candidates.md" 'https://yoh.<tailnet>.ts.net/api/memory/import?dryRun=1'
   curl -sS -X POST -H 'Content-Type: text/markdown' --data-binary @"$HOME/Documents/Yoh-previews/claude-candidates.md" 'https://yoh.<tailnet>.ts.net/api/memory/import'
   ```

   The reply lists what was filed, skipped as a duplicate, or rejected. If it says the always-loaded folders would pass 60, cut that many lines and send it again. Sending the same file twice is harmless.
