
<img width="500" height="500" alt="Lola" src="https://github.com/user-attachments/assets/3eab8e9e-75a6-4a02-91b4-7c10c7c17ee8" />

# LoLa — Web Agent

Browser-automation agent powered by LangGraph and OpenAI. It navigates sites, handles popups, extracts content, and can be used via **CLI** or **Telegram**.

---
By Serenity - www.srnty-ai.com
## Production overview

- **Runtime:** Node.js 18+
- **Browser:** Playwright (Chromium). On servers, run in **headless** mode.
- **Modes:** Set `TELEGRAM_BOT_TOKEN` to run as a Telegram bot; otherwise runs as a CLI daemon.
- **Secrets:** All config via environment variables (e.g. `.env`); no secrets in code.

---

## Prerequisites

- **Node.js** 18 or 20 LTS
- **Playwright system deps** (for Chromium). After `npm install` run:
  ```bash
  npx playwright install chromium
  npx playwright install-deps chromium
  ```
- **OpenAI API key** (required)
- **Telegram Bot Token** (optional; only for Telegram mode)

---

## Environment variables

Copy the example env and edit:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key ([create one](https://platform.openai.com/api-keys)) |
| `TELEGRAM_BOT_TOKEN` | No | If set, app runs as Telegram bot; if unset, CLI mode |
| `HEADLESS` | No | Set to `true` for headless browser (recommended on servers) |

---

## Install and run

```bash
# Install dependencies
npm ci

# Install Playwright Chromium and system dependencies
npx playwright install chromium
npx playwright install-deps chromium

# Run (CLI or Telegram depending on TELEGRAM_BOT_TOKEN)
npm start
```

- **CLI:** Type tasks at the prompt. Commands: `/clear`, `/memory`, `/help`.
- **Telegram:** Talk to your bot; same commands: `/start`, `/clear`, `/memory`, `/help`.

---

## Production deployment

### 1. Headless browser

On servers (no display), run Chromium headless. Set in `.env`:

```env
HEADLESS=true
```

If your app reads this, ensure the browser controller uses it when launching Chromium (e.g. `headless: process.env.HEADLESS === 'true'`). Default in code is often `headless: false` for local dev.

### 2. Process manager (PM2)

Keep the process running and restart on crash:

```bash
npm install -g pm2
pm2 start "npm start" --name lola
pm2 save
pm2 startup   # enable restart on reboot
```

Logs:

```bash
pm2 logs lola
pm2 monit
```

### 3. Systemd (alternative to PM2)

Create `/etc/systemd/system/lola.service`:

```ini
[Unit]
Description=LoLa Web Agent
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/lola
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/lola/.env

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable lola
sudo systemctl start lola
sudo systemctl status lola
```

### 4. Resource limits

- **Memory:** One Chromium instance per process; expect ~300–500 MB for the browser. Size the box (or container) accordingly.
- **Concurrency:** CLI is single-user. Telegram mode serves multiple users; each user has a session (in-memory by default). For many users, consider horizontal scaling or a shared session store later.
- **Recursion limit:** The agent has an internal step limit (e.g. 60) to avoid infinite loops. Tune in code if needed.

### 5. Security

- **Secrets:** Never commit `.env`. Use your deployment’s secret manager (e.g. env vars, vault) and inject into the process.
- **Network:** Only the app and Chromium need outbound HTTPS (OpenAI, Telegram, target sites). Restrict egress if you use a firewall.
- **User input:** The agent can open arbitrary URLs and run browser tools. Validate and rate-limit user input (e.g. in the Telegram layer) to avoid abuse.
- **File system:** `browser_upload_file` uses local paths. In production, restrict or disable if users can trigger it.

### 6. Logging and monitoring

- App logs go to stdout/stderr. With PM2 or systemd, capture them there and ship to your logging pipeline.
- For alerts, monitor process health (PM2/systemd), memory usage, and OpenAI/Telegram errors (e.g. 4xx/5xx or rate limits).

### 7. Optional: Docker

Example Dockerfile (run as non-root, install Playwright deps):

```dockerfile
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npx playwright install chromium

ENV HEADLESS=true
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run (mount `.env` or pass env another way):

```bash
docker build -t lola .
docker run --env-file .env -d --name lola lola
```

---

## Project structure

```
src/
├── agent/          # LLM config, system prompt, LangGraph graph
├── browser/        # Playwright browser controller
├── integrations/   # Telegram bot
├── memory/         # In-memory conversation store
├── tools/          # Browser tools (goto, click, extract, etc.)
├── utils/          # Logger
└── main.ts         # Entry (CLI or Telegram)
```

---

## License

ISC.
