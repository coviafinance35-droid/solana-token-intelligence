const RPC_TIMEOUT_MS = 12000;

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function rpcCall(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'SolanaTokenIntelligence/1.0 Helius' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `${method}-${Date.now()}`, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Helius RPC returned ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || 'Helius RPC request failed');
  return payload.result;
}

function authorityStatus(value) {
  return value || null;
}

export async function getOnchainSecurity(mint, rpcUrl = process.env.HELIUS_RPC_URL) {
  if (!rpcUrl) return { available: false, source: 'Helius RPC', reason: 'HELIUS_RPC_URL is not configured.' };
  try {
    const [account, supply, largest] = await Promise.all([
      rpcCall(rpcUrl, 'getAccountInfo', [mint, { encoding: 'jsonParsed' }]),
      rpcCall(rpcUrl, 'getTokenSupply', [mint]),
      rpcCall(rpcUrl, 'getTokenLargestAccounts', [mint]),
    ]);
    const info = account?.value?.data?.parsed?.info || {};
    const supplyInfo = supply?.value || {};
    const rawSupply = String(supplyInfo.amount ?? info.supply ?? '0');
    const decimals = numberOrNull(supplyInfo.decimals ?? info.decimals) ?? 0;
    const accounts = (largest?.value || []).map((entry) => ({ address: entry.address || null, amount: String(entry.amount ?? ''), uiAmount: numberOrNull(entry.uiAmount), uiAmountString: entry.uiAmountString ?? null }));
    const topAmount = numberOrNull(accounts[0]?.amount);
    const totalAmount = numberOrNull(rawSupply);
    const topHolderPercent = topAmount !== null && totalAmount ? Math.round((topAmount / totalAmount) * 10000) / 100 : null;
    const mintAuthority = authorityStatus(info.mintAuthority);
    const freezeAuthority = authorityStatus(info.freezeAuthority);
    return {
      available: true,
      source: 'Helius RPC',
      fetchedAt: new Date().toISOString(),
      mintAuthority,
      freezeAuthority,
      mintAuthorityRevoked: !mintAuthority,
      freezeAuthorityRevoked: !freezeAuthority,
      authoritiesRevoked: !mintAuthority && !freezeAuthority,
      supply: rawSupply,
      decimals,
      largestAccounts: accounts.slice(0, 20),
      largestAccountsReturned: accounts.length,
      topHolderPercent,
      concentrationNote: topHolderPercent === null ? 'Top-account concentration could not be calculated.' : 'Share is for the largest account in the returned Helius sample, not a complete holder-distribution analysis.',
    };
  } catch (error) {
    return { available: false, source: 'Helius RPC', reason: 'Helius security lookup failed.', error: error.message };
  }
}

export { rpcCall };
