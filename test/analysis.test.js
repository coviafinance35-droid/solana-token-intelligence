import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreToken, forecastToken, SCORE_WEIGHTS } from '../src/analysis.js';

test('score weights total 100', () => assert.equal(Object.values(SCORE_WEIGHTS).reduce((a,b)=>a+b,0), 100));
test('missing essential inputs produces insufficient data', () => { const result = scoreToken({ metadata: {}, pair: {} }); assert.equal(result.score, null); assert.equal(result.interpretation, 'Insufficient data'); });
test('forecast probabilities total 100', () => { const result = forecastToken({ pair: { priceChange: { h1: 4 }, volume: { h1: 100000 }, txns: { h1: { buys: 20, sells: 10 } } } }); assert.equal(result.available, true); for (const horizon of result.horizons) assert.equal(horizon.pump + horizon.dump + horizon.sideways, 100); });
