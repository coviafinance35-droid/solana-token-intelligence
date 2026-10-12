import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRules } from '../src/alert-worker.js';

test('price and percentage alert rules match the selected pair', () => {
  const events = checkRules({ alerts: { priceAbove: 100, priceBelow: 120, change24hAbove: 4, change24hBelow: -20 } }, { priceUsd: '110', priceChange: { h24: '5' } });
  assert.deepEqual(events.map((event) => event.type), ['price_above', 'price_below', 'change_24h_above']);
});

test('missing market data does not create false alerts', () => {
  assert.deepEqual(checkRules({ alerts: { priceAbove: 1, change24hAbove: 1 } }, {}), []);
});
