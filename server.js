import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreToken, forecastToken, buildResearch, SCORE_WEIGHTS } from './src/analysis.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const DB_FILE = join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT || 3000);
const UTL_BASE = process.env.UTL_API_URL || 'https://token-list-api.solana.cloud';
const DEX_BASE = 'https://api.dexscreener.com';
const SOLANA_MINT = 'So11111111111111111111111111111111111111112';
const state = { snapshots: [], watchlist: [] };

async function loadState() { await mkdir(DATA_DIR, { recursive: true }); if (existsSync(DB_FILE)) Object.assign(state, JSON.parse(await readFile(DB_FILE, 'utf8'))); }
async function saveState() { await writeFile(DB_FILE, JSON.stringify(state, null, 2)); }
async function fetchJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { Accept: 'application/json', 'User-Agent': 'SolanaTokenIntelligence/1.0', ...(options.headers || {}) }, signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json(); }
function json(res, body, status = 200) { const text = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(text); }
function inputToMint(input) { const trimmed = String(input || '').trim(); const urlMatch = trimmed.match(/(?:token\/|address\/|solana\/)[A-Za-z0-9]{32,48}/i); if (urlMatch) return urlMatch[0].split('/').pop(); if (/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(trimmed)) return trimmed; return null; }
async function getMetadata(input, mint) { if (mint) { try { const data = await fetchJson(`${UTL_BASE}/v1/mints?chainId=101`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses: [mint] }) }); return { token: data.content?.[0] || null, fetchedAt: new Date().toISOString(), source: 'Solflare UTL API' }; } catch (error) { return { token: null, error: error.message, fetchedAt: new Date().toISOString(), source: 'Solflare UTL API' }; } }
  const data = await fetchJson(`${UTL_BASE}/v1/search?query=${encodeURIComponent(input)}&start=0&limit=8&chainId=101`); return { token: data.content?.[0] || null, results: data.content || [], fetchedAt: new Date().toISOString(), source: 'Solflare UTL API' };
}
async function getMarkets(mint) { try { const data = await fetchJson(`${DEX_BASE}/latest/dex/tokens/${mint}`); const pairs = (data.pairs || []).filter((pair) => pair.chainId === 'solana').sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0)); return { pairs, pair: pairs[0] || null, fetchedAt: new Date().toISOString(), source: 'DexScreener API' }; } catch (error) { return { pairs: [], pair: null, fetchedAt: new Date().toISOString(), source: 'DexScreener API', error: error.message }; } }
async function analyze(input) { const mint = inputToMint(input); const metadata = await getMetadata(input, mint); const resolvedMint = mint || metadata.token?.address; if (!resolvedMint) return { ok: false, error: 'Enter a Solana mint address, token name/symbol, or a DexScreener token URL.', metadata }; const markets = await getMarkets(resolvedMint); const token = { mint: resolvedMint, metadata: metadata.token, pair: markets.pair, metadataFetchedAt: metadata.fetchedAt, marketFetchedAt: markets.fetchedAt, markets: markets.pairs }; token.score = scoreToken(token); token.forecast = forecastToken(token); token.research = buildResearch(token); state.snapshots.push({ mint: resolvedMint, at: new Date().toISOString(), priceUsd: markets.pair?.priceUsd ?? null, liquidityUsd: markets.pair?.liquidity?.usd ?? null, score: token.score.score, forecast: token.forecast }); state.snapshots = state.snapshots.slice(-500); await saveState(); return { ok: true, token }; }
function mime(path) { return { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' }[extname(path)] || 'application/octet-stream'; }
async function serve(req, res) { try { const url = new URL(req.url, `http://${req.headers.host}`); if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  if (url.pathname === '/api/token' && req.method === 'GET') return json(res, await analyze(url.searchParams.get('q') || SOLANA_MINT));
  if (url.pathname === '/api/health' && req.method === 'GET') { const checks = await Promise.allSettled([fetchJson(`${UTL_BASE}/v1/search?query=sol&start=0&limit=1&chainId=101`), fetchJson(`${DEX_BASE}/latest/dex/tokens/${SOLANA_MINT}`)]); return json(res, { ok: checks.every((c) => c.status === 'fulfilled'), checkedAt: new Date().toISOString(), services: { utl: checks[0].status === 'fulfilled' ? 'online' : checks[0].reason.message, dexscreener: checks[1].status === 'fulfilled' ? 'online' : checks[1].reason.message }, persistence: { snapshots: state.snapshots.length, watchlist: state.watchlist.length }, scoreWeights: SCORE_WEIGHTS }); }
  if (url.pathname === '/api/compare' && req.method === 'GET') { const mints = (url.searchParams.get('mints') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5); const results = await Promise.all(mints.map(analyze)); return json(res, { ok: true, results }); }
  if (url.pathname === '/api/watchlist' && req.method === 'GET') return json(res, { watchlist: state.watchlist });
  if (url.pathname === '/api/watchlist' && req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; const item = JSON.parse(body); if (!item.mint) return json(res, { error: 'mint is required' }, 400); const record = { mint: item.mint, label: item.label || item.mint.slice(0, 8), createdAt: new Date().toISOString() }; if (!state.watchlist.some((x) => x.mint === record.mint)) state.watchlist.push(record); await saveState(); return json(res, { watchlist: state.watchlist }, 201); }
  if (url.pathname === '/api/watchlist' && req.method === 'DELETE') { const mint = url.searchParams.get('mint'); state.watchlist = state.watchlist.filter((x) => x.mint !== mint); await saveState(); return json(res, { watchlist: state.watchlist }); }
  if (url.pathname === '/api/research' && req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; const payload = JSON.parse(body); const result = await analyze(payload.q || SOLANA_MINT); return json(res, result.ok ? { ...result, answer: buildResearch(result.token, payload.question || '') } : result); }
  let file = url.pathname === '/' ? '/public/index.html' : `/public${url.pathname}`; const path = join(ROOT, file); if (!path.startsWith(join(ROOT, 'public'))) return json(res, { error: 'not found' }, 404); const content = await readFile(path); res.writeHead(200, { 'Content-Type': `${mime(path)}; charset=utf-8` }); res.end(content);
 } catch (error) { json(res, { ok: false, error: error.message }, 500); } }
await loadState(); http.createServer(serve).listen(PORT, '0.0.0.0', () => console.log(`Solana Token Intelligence listening on http://0.0.0.0:${PORT}`));
export { inputToMint, scoreToken };
