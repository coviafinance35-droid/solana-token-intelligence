import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreToken, forecastToken, SCORE_WEIGHTS } from '../src/analysis.js';

test('score weights total 100', () => assert.equal(Object.values(SCORE_WEIGHTS).reduce((a,b)=>a+b,0), 100));
test('missing essential inputs produces insufficient data', () => { const result = scoreToken({ metadata: {}, pair: {} }); assert.equal(result.score, null); assert.equal(result.interpretation, 'Insufficient data'); });
test('forecast probabilities total 100', () => { const result = forecastToken({ pair: { priceChange: { h1: 4 }, volume: { h1: 100000 }, txns: { h1: { buys: 20, sells: 10 } } } }); assert.equal(result.available, true); for (const horizon of result.horizons) assert.equal(horizon.pump + horizon.dump + horizon.sideways, 100); });
test('forecast exposes an explicit directional prediction', () => { const result = forecastToken({ pair: { priceChange: { h1: 12 }, volume: { h1: 100000 }, txns: { h1: { buys: 90, sells: 10 } } } }); assert.equal(result.prediction.horizon, '1h'); assert.ok(['pump', 'dump', 'sideways'].includes(result.prediction.direction)); assert.match(result.prediction.label, /PUMP|DUMP|SIDEWAYS/); assert.equal(result.prediction.probability, result.horizons[1].outlook.probability); });
test('unavailable forecast does not claim pump or dump', () => { const result = forecastToken({ pair: {} }); assert.equal(result.prediction.direction, 'unknown'); assert.equal(result.prediction.probability, null); });
