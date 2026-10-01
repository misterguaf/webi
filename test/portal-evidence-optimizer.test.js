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

// 3.5F closure: a large synthetic photo keeps its synthetic provenance through optimisation (a fresh
// JPEG comment, no original metadata) and is accepted end to end by Gestió's synthetic-only intake.
// The codec is injected (Node has no canvas); it returns a re-encoded JPEG with no metadata at all,
// like a browser canvas does.
import { fixture } from './helpers/gestio-sqlite.js';
import { submitRegistration } from '../gestio/src/services/registration-service.js';
import { validateSyntheticEvidence } from '../gestio/src/services/evidence-service.js';

const segment = (marker, text) => { const body = Buffer.from(text, 'latin1'); const head = Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]); return Buffer.concat([head, body]); };
function largePhoto({ synthetic }) {
  return new File([Buffer.concat([Buffer.from([0xff, 0xd8]),
    segment(0xe1, 'Exif\0\0GPSLatitude 39.47 GPSLongitude -0.37 Model PhoneDemo'),
    synthetic ? segment(0xfe, 'synthetic camera photo for local tests') : Buffer.alloc(0),
    Buffer.alloc(2_200_000, 0x55), Buffer.from([0xff, 0xd9])])], synthetic ? 'foto-rebut.jpeg' : 'foto-real.jpeg', { type: 'image/jpeg' });
}
const canvasCodec = {
  decode: async () => ({ width: 4000, height: 3000 }),
  encode: async size => { assert.deepEqual(size, { width: 2000, height: 1500 }); return new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 4, 1, 2]), Buffer.alloc(40_000, 0x33), Buffer.from([0xff, 0xd9])], { type: 'image/jpeg' }); }
};
const encodeArg = codec => ({ ...codec, encode: (bitmap, size) => codec.encode(size) });
const firstKiB = async file => Buffer.from(await file.slice(0, 1024).arrayBuffer()).toString('latin1');

test('large synthetic photo → optimised (no EXIF) → provenance kept → accepted by synthetic-only intake', async () => {
  const original = largePhoto({ synthetic: true });
  const optimised = await E.optimize(original, undefined, encodeArg(canvasCodec));
  assert.notEqual(optimised, original);
  assert.equal(optimised.type, 'image/jpeg');
  assert.equal(optimised.name, 'foto-rebut.jpg');
  assert.ok(optimised.size < 50_000);
  const head = await firstKiB(optimised);
  assert.match(head, /synthetic/, 'provenance declared again in the first KiB');
  assert.doesNotMatch(head, /Exif|GPSLatitude|PhoneDemo/, 'no original metadata survives');
  const bytes = Buffer.from(await optimised.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xfe], 'SOI then the comment segment');
  const evidence = { filename: optimised.name, mime: optimised.type, dataBase64: bytes.toString('base64') };
  assert.equal((await validateSyntheticEvidence(evidence)).mime, 'image/jpeg');
  // End to end through the registration intake on a paid activity (synthetic-only data mode).
  const f = fixture();
  try {
    const stored = new Map();
    const storage = { async put(key, value) { stored.set(key, value); }, async delete(key) { stored.delete(key); } };
    const result = await submitRegistration(f.db, storage, { publicCode: 'DEMO-PAID-ESCOLTA', participantName: 'Persona Optimitzada (ficticia)',
      birthDate: '2009-04-26', submittedByName: 'Tutor fictici', sectionCode: 'ESCOLTA', transportCode: 'FAMILY', receiptEmail: 'optim@example.test',
      idempotencyKey: 'evidence-test-00000001', participationTermsVersion: 'DEMO-3A-PARTICIPATION-V1', privacyNoticeVersion: 'DEMO-3A-PRIVACY-NOTICE-V1',
      evidence }, crypto.randomUUID());
    assert.deepEqual(result, { ok: true });
    const row = f.sql.prepare("SELECT e.detected_mime,e.size_bytes FROM payment_evidence e JOIN activity_registration r ON r.id=e.registration_id WHERE r.receipt_email='optim@example.test'").get();
    assert.deepEqual([row.detected_mime, row.size_bytes], ['image/jpeg', bytes.length]);
    assert.equal(stored.size, 1);
  } finally { f.close(); }
});

test('synthetic-only is not weakened: a non-synthetic photo gets no provenance comment and is still refused', async () => {
  const optimised = await E.optimize(largePhoto({ synthetic: false }), undefined, encodeArg(canvasCodec));
  assert.doesNotMatch(await firstKiB(optimised), /synthetic/);
  const bytes = Buffer.from(await optimised.arrayBuffer());
  await assert.rejects(validateSyntheticEvidence({ filename: optimised.name, mime: 'image/jpeg', dataBase64: bytes.toString('base64') }),
    /synthetic_evidence_required/);
});
