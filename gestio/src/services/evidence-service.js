import { synthetic } from '../environment-policy.js';
import { AppError } from './common.js';

const MAX_BYTES=4*1024*1024;
const formats=[
  {mime:'application/pdf',extension:'.pdf',matches:b=>b.length>=8 && String.fromCharCode(...b.slice(0,5))==='%PDF-'},
  {mime:'image/png',extension:'.png',matches:b=>b.length>=8 && [137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n)},
  {mime:'image/jpeg',extension:'.jpg',matches:b=>b.length>=4 && b[0]===255 && b[1]===216 && b[2]===255},
  {mime:'image/webp',extension:'.webp',matches:b=>b.length>=12 && String.fromCharCode(...b.slice(0,4))==='RIFF' &&
    String.fromCharCode(...b.slice(8,12))==='WEBP'}
];
export async function validateSyntheticEvidence(input) {
  const normalizedName=typeof input?.filename==='string'?input.filename.normalize('NFKC'):'';
  if (!input || typeof input!=='object' || Array.isArray(input) ||
    Object.keys(input).some(key=>!['filename','mime','dataBase64'].includes(key)) ||
    typeof input.filename!=='string' || !input.filename.length || input.filename.length>120 ||
    /[/\\\u2215\u2044\u29f8\u0000-\u001f]/u.test(normalizedName) || typeof input.mime!=='string' ||
    typeof input.dataBase64!=='string' || input.dataBase64.length>Math.ceil(MAX_BYTES*4/3)+8 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64) || input.dataBase64.length%4!==0)
    throw new AppError(400,'invalid_evidence');
  let bytes;
  try {bytes=Uint8Array.from(atob(input.dataBase64),char=>char.charCodeAt(0));}
  catch {throw new AppError(400,'invalid_evidence');}
  if (!bytes.length || bytes.length>MAX_BYTES) throw new AppError(413,'evidence_too_large');
  const detected=formats.find(format=>format.matches(bytes));
  if (!detected || detected.mime!==input.mime) throw new AppError(400,'invalid_evidence');
  const filename=input.filename.toLowerCase();
  if (!filename.endsWith(detected.extension) && !(detected.mime==='image/jpeg' && filename.endsWith('.jpeg')))
    throw new AppError(400,'invalid_evidence');
  // DATA_MODE is SYNTHETIC_ONLY: reject fixtures without a synthetic marker before storage.
  if (!synthetic.evidence(bytes)) throw new AppError(400,'synthetic_evidence_required');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {bytes,mime:detected.mime,sha256:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')};
}
export function evidenceKey() {return synthetic.evidenceKeyPrefix+crypto.randomUUID();}
export async function storeEvidence(storage,key,validated) {
  if (!storage?.put) throw new AppError(503,'evidence_storage_unavailable');
  await storage.put(key,validated.bytes,{httpMetadata:{contentType:'application/octet-stream'}});
}
export async function readEvidence(storage,key) {
  if (!storage?.get) throw new AppError(503,'evidence_storage_unavailable');
  const object=await storage.get(key);
  if (!object) throw new AppError(404,'not_found');
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream',
    'Content-Disposition':'attachment; filename="justificant.bin"','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
}
