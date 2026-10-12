import test from 'node:test';
import assert from 'node:assert/strict';
import { getOnchainSecurity } from '../src/helius.js';

test('Helius security adapter normalizes authorities and top-account concentration', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    const result = {
      getAccountInfo: { value: { data: { parsed: { info: { mintAuthority: null, freezeAuthority: 'FreezeAuthority111' } } } } },
      getTokenSupply: { value: { amount: '1000', decimals: 2 } },
      getTokenLargestAccounts: { value: [{ address: 'Largest111', amount: '250', uiAmount: 2.5, uiAmountString: '2.5' }] },
    }[method];
    return { ok: true, json: async () => ({ result }) };
  };
  try {
    const result = await getOnchainSecurity('Mint111', 'https://helius.test/rpc');
    assert.equal(result.available, true);
    assert.equal(result.mintAuthorityRevoked, true);
    assert.equal(result.freezeAuthorityRevoked, false);
    assert.equal(result.topHolderPercent, 25);
    assert.equal(result.largestAccountsReturned, 1);
  } finally { global.fetch = originalFetch; }
});

test('Helius security adapter is honest when no endpoint is configured', async () => {
  const result = await getOnchainSecurity('Mint111', '');
  assert.equal(result.available, false);
  assert.match(result.reason, /not configured/i);
});
