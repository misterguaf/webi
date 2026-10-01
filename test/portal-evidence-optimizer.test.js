// 3.5F: receipt photo optimisation in the portal (pure parts). The browser codec path is exercised
// manually; here we pin the policy: images from ~1.5 MB, longest side 2000 px, JPEG 0.82, PDFs never.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../portal/public/evidence-optimizer.js';

const E = globalThis.ParpalloEvidence;
const file = (type, size, name = 'foto.png') => ({ type, size, name });

test('policy: confirmed parameters', () => {
  assert.deepEqual({ ...E.POLICY }, { maxSide: 2000, quality: 0.82, thresholdBytes: 1.5 * 1024 * 1024 });
});
test('only large images are optimised; PDFs and small images are untouched', async () => {
  assert.equal(E.shouldOptimize(file('application/pdf', 4e6, 'a.pdf')), false);
  assert.equal(E.shouldOptimize(file('image/jpeg', 200_000)), false);
  assert.equal(E.shouldOptimize(file('image/jpeg', 2_000_000)), true);
  assert.equal(E.shouldOptimize(file('image/heic', 2_000_000)), false);
  const pdf = file('application/pdf', 4e6, 'a.pdf');
  assert.equal(await E.optimize(pdf), pdf);
  const big = file('image/jpeg', 3e6);
  assert.equal(await E.optimize(big), big, 'without a browser codec the original is kept (never rejects)');
});
test('downscale keeps the aspect ratio and never upscales', () => {
  assert.deepEqual(E.targetSize(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(E.targetSize(3000, 6000), { width: 1000, height: 2000 });
  assert.deepEqual(E.targetSize(1200, 900), { width: 1200, height: 900 });
  assert.equal(E.jpegName('rebut banc.PNG'), 'rebut banc.jpg');
  assert.equal(E.jpegName(''), 'comprovant.jpg');
});
