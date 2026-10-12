export const SCORE_WEIGHTS = {
  liquidity: 20,
  activity: 15,
  momentum: 15,
  holders: 15,
  security: 15,
  participation: 10,
  credibility: 10,
};

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const pct = (value) => n(value) ?? 0;
function outlook(pump, dump, sideways) {
  const values = [{ direction: 'pump', probability: pump }, { direction: 'dump', probability: dump }, { direction: 'sideways', probability: sideways }].sort((a, b) => b.probability - a.probability);
  const top = values[0];
  const label = top.direction === 'pump' ? 'PUMP BIAS' : top.direction === 'dump' ? 'DUMP BIAS' : 'SIDEWAYS / UNCERTAIN';
  return { direction: top.direction, label, probability: top.probability, edge: Math.max(0, top.probability - values[1].probability) };
}

export function scoreToken(token) {
  const pair = token.pair;
  const meta = token.metadata;
  const liq = n(pair?.liquidity?.usd);
  const vol = n(pair?.volume?.h24);
  const fdv = n(pair?.fdv ?? pair?.marketCap);
  const changes = pair?.priceChange || {};
  const holderCount = n(meta?.holders);
  const buy24 = n(pair?.txns?.h24?.buys);
  const sell24 = n(pair?.txns?.h24?.sells);
  const onchain = token.onchainSecurity;
  const verified = meta?.verified === true;
  const coverage = [];
  const categories = [];
  const add = (key, label, points, max, reason, source) => categories.push({ key, label, points: Math.round(clamp(points, 0, max)), max, reason, source });

  if (liq !== null) coverage.push('liquidity');
  add('liquidity', 'Liquidity & exit capacity', liq === null ? 0 : Math.min(20, 4 + Math.log10(Math.max(liq, 1)) * 3.2), 20, liq === null ? 'No liquidity value returned; scored conservatively.' : `$${Math.round(liq).toLocaleString()} liquidity reported by the selected pair.`, 'DexScreener');
  if (vol !== null) coverage.push('volume');
  add('activity', 'Volume & trading activity', vol === null ? 0 : Math.min(15, 3 + Math.log10(Math.max(vol, 1)) * 2.5), 15, vol === null ? 'No 24h volume returned.' : `$${Math.round(vol).toLocaleString()} 24h volume reported.`, 'DexScreener');
  const momentum = n(changes.h24);
  if (momentum !== null) coverage.push('momentum');
  add('momentum', 'Price momentum & trend', momentum === null ? 0 : 7.5 + clamp(momentum, -50, 50) * 0.15, 15, momentum === null ? 'No 24h price change returned.' : `${momentum >= 0 ? '+' : ''}${momentum.toFixed(2)}% over 24h.`, 'DexScreener');
  if (holderCount !== null) coverage.push('holders');
  add('holders', 'Holder distribution', holderCount === null ? 0 : Math.min(15, 4 + Math.log10(Math.max(holderCount, 1)) * 2.4), 15, holderCount === null ? 'Holder count is unavailable from the configured sources.' : `${holderCount.toLocaleString()} holders in the Solflare UTL metadata. Concentration is not inferred from this count.`, 'Solflare UTL');
  const authorityPoints = onchain?.available ? (onchain.mintAuthorityRevoked ? 7.5 : 2.5) + (onchain.freezeAuthorityRevoked ? 7.5 : 2.5) : 7.5;
  const concentrationPenalty = onchain?.available && onchain.topHolderPercent !== null && onchain.topHolderPercent > 50 ? 2.5 : onchain?.available && onchain.topHolderPercent !== null && onchain.topHolderPercent > 20 ? 1 : 0;
  const securityPoints = onchain?.available ? Math.max(0, authorityPoints - concentrationPenalty) : 0;
  if (onchain?.available) coverage.push('security');
  add('security', 'Token security & authorities', securityPoints, 15, onchain?.available ? `${onchain.mintAuthorityRevoked ? 'Mint authority revoked' : 'Mint authority active'}; ${onchain.freezeAuthorityRevoked ? 'freeze authority revoked' : 'freeze authority active'}.${onchain.topHolderPercent === null ? '' : ` Largest returned account is ${onchain.topHolderPercent}% of reported supply.`}` : 'Helius RPC security data is unavailable; scored as unknown rather than safe.', onchain?.available ? 'Helius RPC' : 'Unavailable / conservative');
  const ratio = buy24 !== null && sell24 !== null ? (buy24 + sell24 ? buy24 / (buy24 + sell24) : 0.5) : null;
  if (ratio !== null) coverage.push('buy-sell');
  add('participation', 'Buyer growth & participation', ratio === null ? 0 : 5 + clamp((ratio - 0.5) * 10, -5, 5), 10, ratio === null ? 'Buy/sell counts unavailable.' : `${buy24} buys vs ${sell24} sells in 24h (${(ratio * 100).toFixed(0)}% buys).`, 'DexScreener');
  if (verified || meta?.name || meta?.symbol) coverage.push('metadata');
  add('credibility', 'Metadata & project credibility', (verified ? 8 : 4) + (meta?.logoURI ? 1 : 0) + (meta?.name ? 1 : 0), 10, `${verified ? 'UTL verified metadata.' : 'Metadata is not marked verified.'} Claims are not treated as proof of safety.`, 'Solflare UTL');

  const raw = categories.reduce((sum, item) => sum + item.points, 0);
  const essential = ['liquidity', 'volume', 'momentum'].every((item) => coverage.includes(item));
  const score = essential ? clamp(raw, 1, 100) : null;
  return { score, categories, coverage: Math.round((coverage.length / 7) * 100), coverageFields: coverage, interpretation: score === null ? 'Insufficient data' : score >= 85 ? 'Strong measured indicators; still speculative.' : score >= 70 ? 'Relatively favorable indicators.' : score >= 50 ? 'Mixed signals; proceed cautiously.' : score >= 30 ? 'Weak indicators and elevated risk.' : 'Very high risk based on available evidence.', inputs: { liq, vol, fdv, momentum, holderCount, buy24, sell24 } };
}

export function forecastToken(token) {
  const pair = token.pair;
  const momentum = n(pair?.priceChange?.h1) ?? n(pair?.priceChange?.h24);
  const volume = n(pair?.volume?.h1);
  const buys = n(pair?.txns?.h1?.buys);
  const sells = n(pair?.txns?.h1?.sells);
  if (momentum === null && volume === null && buys === null) return { available: false, modelVersion: 'rule-based-v1', prediction: { direction: 'unknown', label: 'INSUFFICIENT DATA', probability: null }, reason: 'Not enough short-horizon market data returned by DexScreener.' };
  const imbalance = buys !== null && sells !== null && buys + sells ? (buys - sells) / (buys + sells) : 0;
  const signal = clamp((momentum ?? 0) / 8 + imbalance * 35 + (volume ? Math.log10(Math.max(volume, 1)) - 2 : 0), -100, 100);
  const pump = clamp(33.3 + signal * 0.32, 5, 82);
  const dump = clamp(33.3 - signal * 0.32, 5, 82);
  const sideways = Math.max(1, 100 - pump - dump);
  const horizons = ['15m', '1h', '4h'].map((horizon, index) => { const factor = [0.75, 1, 1.15][index]; const p = clamp(33.3 + signal * 0.32 * factor, 5, 82); const d = clamp(33.3 - signal * 0.32 * factor, 5, 82); const roundedPump = Math.round(p); const roundedDump = Math.round(d); const sideways = 100 - roundedPump - roundedDump; return { horizon, pump: roundedPump, dump: roundedDump, sideways, outlook: outlook(roundedPump, roundedDump, sideways) }; });
  return { available: true, modelVersion: 'rule-based-v1', generatedAt: new Date().toISOString(), threshold: '±5% movement', confidence: momentum !== null && buys !== null ? 'low' : 'very low', prediction: { ...horizons[1].outlook, horizon: '1h' }, horizons, signals: { momentum, imbalance, volume }, caveat: 'Experimental rule-based estimates, not validated predictive probabilities. “Pump” and “dump” mean a projected move of at least 5% in the stated horizon; this is not financial advice or a promise of returns.' };
}

export function buildResearch(token, question = '') {
  const score = token.score?.score;
  const pair = token.pair || {};
  const risks = [];
  if (!pair.liquidity?.usd) risks.push('Liquidity is unavailable, so exit capacity cannot be measured.');
  else if (Number(pair.liquidity.usd) < 100000) risks.push('Reported liquidity is below $100k; slippage and exit capacity deserve extra scrutiny.');
  if (token.metadata?.verified !== true) risks.push('The UTL record is not marked verified.');
  if (token.onchainSecurity?.available) {
    if (!token.onchainSecurity.mintAuthorityRevoked) risks.push('Helius reports an active mint authority; additional supply can potentially be created.');
    if (!token.onchainSecurity.freezeAuthorityRevoked) risks.push('Helius reports an active freeze authority; token transfers may be restrictable by the authority.');
    if (token.onchainSecurity.topHolderPercent !== null && token.onchainSecurity.topHolderPercent > 20) risks.push(`The largest returned token account represents ${token.onchainSecurity.topHolderPercent}% of reported supply; this is a concentration warning, not a complete holder analysis.`);
  } else risks.push('Authority configuration and holder concentration require an available Helius RPC lookup.');
  return { question, summary: score === null ? 'There is not enough live data to form a responsible score.' : `The measured score is ${score}/100: ${token.score.interpretation}`, bullish: [pair.priceChange?.h1 != null ? `1h price change is ${pair.priceChange.h1}%.` : null, pair.txns?.h24 ? `${pair.txns.h24.buys} buys and ${pair.txns.h24.sells} sells were reported over 24h.` : null, token.metadata?.verified ? 'Solflare UTL marks the token metadata as verified.' : null].filter(Boolean), bearish: risks, limitations: ['DexScreener provides pair-level market data, not proof of token safety.', 'Holder concentration, mint authority, freeze authority, and transaction history need an enabled on-chain provider.', 'Forecasts are rule-based and experimental.'], sources: [{ name: 'DexScreener', timestamp: token.marketFetchedAt }, { name: 'Solflare UTL API', timestamp: token.metadataFetchedAt }] };
}
