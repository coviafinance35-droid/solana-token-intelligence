import { loadStore, saveStore, acquireWorkerLease, releaseWorkerLease } from './store.js';

const PORT = Number(process.env.PORT || 3000);
const POLL_MS = Math.max(60_000, Number(process.env.ALERT_POLL_INTERVAL_MS || 60_000));
const COOLDOWN_MS = Math.max(60_000, Number(process.env.ALERT_DEFAULT_COOLDOWN_MS || 30 * 60_000));
const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.ALERT_WEBHOOK_SECRET || '';
const DRY_RUN = process.env.ALERT_DRY_RUN === 'true';
const DEX_BASE = 'https://api.dexscreener.com';

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'SolanaTokenIntelligence/1.0 alert-worker' }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function selectedPair(data) {
  return (data.pairs || []).filter((pair) => pair.chainId === 'solana').sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0] || null;
}

function checkRules(item, pair) {
  const price = Number(pair?.priceUsd);
  const change24h = Number(pair?.priceChange?.h24);
  if (!Number.isFinite(price)) return [];
  const rules = item.alerts || {};
  const events = [];
  if (Number.isFinite(Number(rules.priceAbove)) && price >= Number(rules.priceAbove)) events.push({ type: 'price_above', threshold: Number(rules.priceAbove), value: price });
  if (Number.isFinite(Number(rules.priceBelow)) && price <= Number(rules.priceBelow)) events.push({ type: 'price_below', threshold: Number(rules.priceBelow), value: price });
  if (Number.isFinite(Number(rules.change24hAbove)) && Number.isFinite(change24h) && change24h >= Number(rules.change24hAbove)) events.push({ type: 'change_24h_above', threshold: Number(rules.change24hAbove), value: change24h });
  if (Number.isFinite(Number(rules.change24hBelow)) && Number.isFinite(change24h) && change24h <= Number(rules.change24hBelow)) events.push({ type: 'change_24h_below', threshold: Number(rules.change24hBelow), value: change24h });
  return events;
}

async function deliver(event) {
  if (!WEBHOOK_URL || DRY_RUN) return { delivered: false, reason: DRY_RUN ? 'dry_run' : 'ALERT_WEBHOOK_URL is not configured' };
  const payload = JSON.stringify({ event: 'solana_token_price_alert', ...event });
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'SolanaTokenIntelligence/1.0 alert-worker' };
  if (WEBHOOK_SECRET) headers['X-Alert-Signature'] = WEBHOOK_SECRET;
  const response = await fetch(WEBHOOK_URL, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`notification webhook returned ${response.status}`);
  return { delivered: true };
}

export async function runAlertCycle() {
  const store = await loadStore();
  const now = Date.now();
  let changed = false;
  for (const item of store.watchlist.filter((entry) => entry.alerts && entry.alerts.enabled !== false)) {
    try {
      const data = await fetchJson(`${DEX_BASE}/latest/dex/tokens/${item.mint}`);
      const pair = selectedPair(data);
      const events = checkRules(item, pair);
      for (const match of events) {
        const cooldown = Math.max(60_000, Number(item.alerts.cooldownMinutes || 30) * 60_000);
        const dedupeKey = `${item.mint}:${match.type}:${match.threshold}`;
        const recent = store.alerts.find((alert) => alert.dedupeKey === dedupeKey && now - new Date(alert.createdAt).getTime() < cooldown);
        if (recent) continue;
        const event = { dedupeKey, mint: item.mint, label: item.label, rule: match.type, threshold: match.threshold, value: match.value, priceUsd: Number(pair?.priceUsd), pairAddress: pair?.pairAddress || null, dexId: pair?.dexId || null, createdAt: new Date().toISOString() };
        try { Object.assign(event, await deliver(event)); } catch (error) { event.delivered = false; event.deliveryError = error.message; }
        store.alerts.unshift(event);
        store.alerts = store.alerts.slice(0, 500);
        changed = true;
        console.log(JSON.stringify({ level: event.delivered ? 'info' : 'warn', message: 'price alert evaluated', ...event }));
      }
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'watchlist alert check failed', mint: item.mint, error: error.message }));
    }
  }
  if (changed) await saveStore(store);
  return { checkedAt: new Date().toISOString(), alertsCreated: store.alerts.filter((alert) => alert.createdAt && Date.now() - new Date(alert.createdAt).getTime() < 5_000).length, watchlistSize: store.watchlist.length };
}

if (process.argv[1]?.endsWith('alert-worker.js')) {
  if (!await acquireWorkerLease()) { console.error('Alert worker lease is already held; exiting.'); process.exit(1); }
  const stop = async (signal) => { console.log(`Alert worker stopping (${signal})`); await releaseWorkerLease(); process.exit(0); };
  process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM'));
  console.log(`Alert worker started; polling every ${POLL_MS}ms`);
  await runAlertCycle();
  setInterval(() => runAlertCycle().catch((error) => console.error(JSON.stringify({ level: 'error', message: 'alert cycle failed', error: error.message }))), POLL_MS);
}

export { checkRules };
