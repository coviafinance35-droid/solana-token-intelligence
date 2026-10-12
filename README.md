# Solana Token Intelligence

A production-oriented Solana token research terminal that combines **Solflare Unified Token List metadata** with **DexScreener live market data**. It is intentionally evidence-first: missing on-chain data is marked unavailable instead of being guessed, forecasts are labeled experimental, and no demo/mock market payloads are shipped.

## What is working

- Search by Solana mint, name/symbol, or DexScreener URL.
- Solflare UTL API metadata lookup through `/v1/mints` and `/v1/search`.
- DexScreener pair discovery through `/latest/dex/tokens/{mint}`.
- Best-pair selection by reported USD liquidity.
- Price, FDV/market cap, liquidity, volume, buys/sells, pair age, and DEX details.
- Transparent 1–100 scoring engine with the requested weights, category explanations, coverage, and conservative missing-data treatment.
- Experimental rule-based pump/dump/sideways estimates for 15m, 1h, and 4h; probabilities sum to 100%.
- Optional Helius RPC authority and concentration lookup for mint authority, freeze authority, supply, and largest returned token accounts.
- Evidence-backed research agent endpoint; it only summarizes retrieved fields and limitations.
- Persistent snapshots and watchlist storage in `data/store.json`.
- Provider health endpoint and responsive dark terminal UI.
- Vendored copies of the requested upstream repositories in `upstream/utl-api` and `upstream/utl-aggregator`.

## Run locally

```bash
npm test
npm run check
npm start
```

Open `http://localhost:3000`. To use another port:

```bash
PORT=8080 npm start
```

No API key is required for the base market-data MVP because DexScreener and the documented public Solflare UTL instance are used server-side. To enable on-chain security checks, set `HELIUS_RPC_URL` server-side; never expose it in browser code or commit it to Git.

## Architecture

- `server.js` — dependency-light Node HTTP server, API routes, timeouts, normalization, persistence.
- `src/analysis.js` — scoring, rule-based forecast, and evidence-backed research logic.
- `src/helius.js` — optional Helius JSON-RPC adapter for authority and largest-account security signals.
- `public/` — responsive browser UI.
- `data/store.json` — local persistent snapshots/watchlist; replace with Postgres/Drizzle for multi-user deployment.
- `upstream/utl-api` — source and docs from `solflare-wallet/utl-api`, used as the contract reference for mint/search queries.
- `upstream/utl-aggregator` — source and docs from `solflare-wallet/utl-aggregator`, used as the token identity/normalization reference and retained for future provider expansion.

## API routes

- `GET /api/token?q=<mint|symbol|url>`
- `GET /api/compare?mints=<mint1>,<mint2>` (up to five in the UI contract)
- `POST /api/research` with `{ "q": "<mint or symbol>", "question": "..." }`
- `GET /api/watchlist`
- `POST /api/watchlist` with `{ "mint": "...", "label": "..." }`
- `DELETE /api/watchlist?mint=...`
- `GET /api/health`
- `POST /api/scheduled/alerts` — authenticated managed-heartbeat callback for watchlist alert evaluation.

## Automated price alerts

Watchlist entries now support four threshold types: price above, price below, 24-hour percentage change above, and 24-hour percentage change below. Each entry also has an enable switch and a cooldown in minutes. The dashboard saves these rules through `PATCH /api/watchlist?mint=...`; the rules and notification history are stored in `data/store.json`.

Run the alert processor as a separate production process:

```bash
ALERT_WEBHOOK_URL=https://your-notification-endpoint.example/alerts npm run start:worker
```

The worker polls DexScreener with provider timeouts, selects the highest-liquidity Solana pair, applies cooldown-based deduplication, records every fired or failed delivery, and sends a JSON webhook payload. If `ALERT_WEBHOOK_SECRET` is configured, it is sent as `X-Alert-Signature`. Delivery is intentionally webhook-based so it can connect to Slack, Discord, PagerDuty, email gateways, or an internal notification service without putting provider credentials in the browser. `ALERT_DRY_RUN=true` evaluates and logs alerts without sending them.

For container deployment, use the included `docker-compose.yml`. It runs the API and worker as separate restartable services, shares a durable volume for the store, uses a worker lease to prevent duplicate processors, and includes an API health check:

```bash
ALERT_WEBHOOK_URL=https://your-notification-endpoint.example/alerts docker compose up -d --build
```

The worker defaults to a 60-second poll interval and a 30-minute per-rule cooldown. Configure `ALERT_POLL_INTERVAL_MS`, `ALERT_DEFAULT_COOLDOWN_MS`, `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET`, and `ALERT_DRY_RUN` through the deployment environment. The minimum poll interval is one minute to respect provider limits. `GET /api/alerts` exposes recent audited delivery attempts and worker configuration status.

## Important limitations

Helius authority results describe current RPC state, not token safety or future behavior. `getTokenLargestAccounts` returns a largest-account sample, not a complete holder-distribution analysis; wallet activity and historical forecast accuracy still require additional data and validation. Without `HELIUS_RPC_URL`, security remains unavailable/conservative. The forecast is a rule-based estimate, not a validated trading model and not investment advice. For high-volume deployments, replace the JSON persistence adapter with PostgreSQL/Drizzle; the worker/API boundaries and alert records are already separated for that migration.

## Upstream attribution

This project incorporates and retains code/documentation from:

- https://github.com/solflare-wallet/utl-api
- https://github.com/solflare-wallet/utl-aggregator

The original upstream projects retain their original license files and attribution. This application is released under MIT for the application code.
