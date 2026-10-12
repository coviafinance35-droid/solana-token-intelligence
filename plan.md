# Permanent website deployment plan

## Scope

Publish the validated Solana Token Intelligence terminal as a managed public website. Preserve live Solflare UTL and DexScreener integrations, the responsive dashboard, scoring/forecast/research surfaces, watchlist alerts, webhook delivery, and production container assets. Do not introduce mock market data.

## Implementation approach

The managed project uses the existing dependency-light Node HTTP application and Dockerfile. The container listens on `PORT` with a default of 3000 and exposes `/api/health` as an unauthenticated readiness endpoint. The browser UI and API are served from the same origin, so browser requests remain relative and secrets stay server-side. The existing alert worker remains available as a separately deployable process for environments that run the worker alongside the API; notification delivery requires `ALERT_WEBHOOK_URL` and optional `ALERT_WEBHOOK_SECRET`.

## Project structure

- `server.js`: HTTP server, live provider normalization, API routes, persistence, health status.
- `src/analysis.js`: score, forecast, and evidence-backed research calculations.
- `src/store.js`: atomic persistent store and worker lease.
- `src/alert-worker.js`: watchlist polling, cooldown deduplication, webhook delivery, and audit history.
- `public/`: responsive terminal UI and route manifest.
- `Dockerfile` / `docker-compose.yml`: production container and optional two-process deployment.
- `upstream/`: retained Solflare UTL API and aggregator source/documentation.

## Managed deployment

Configure the server capability and container deploy contract, publish the canonical managed checkpoint, and verify the published URL plus health endpoint. Keep the public GitHub repository unchanged as the source reference; managed checkpoints are saved in the project’s managed repository unless a separate canonical-repository transfer is explicitly requested.
