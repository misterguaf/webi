/* DEPRECATED — candidate for removal after portal/ has completed its rollout.
 * The definitive family interface is portal/public/ with portal/worker.js.
 */
import { publicActivities } from '../gestio/src/services/activity-service.js';
import { submitRegistration } from '../gestio/src/services/registration-service.js';
import { AppError } from '../gestio/src/services/common.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'}});
const local=url=>['localhost','127.0.0.1'].includes(url.hostname);
async function bodyJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new AppError(415,'invalid_content_type');
  const max=6*1024*1024;
  if (Number(request.headers.get('Content-Length')||0)>max) throw new AppError(413,'body_too_large');
  const reader=request.body?.getReader();
  if (!reader) throw new AppError(400,'invalid_request');
  let size=0;const chunks=[];
  for(;;) {
    const {value,done}=await reader.read();if(done) break;
    size+=value.byteLength;
    if(size>max) {await reader.cancel();throw new AppError(413,'body_too_large');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
  try {const body=JSON.parse(new TextDecoder().decode(bytes));if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error('shape');return body;}
  catch {throw new AppError(400,'invalid_request');}
}
export default {
  async fetch(request,env) {
    const requestId=crypto.randomUUID();
    try {
      const url=new URL(request.url);
      if (env.APP_ENV!=='development' || !local(url) || !env.DB) throw new AppError(503,'local_synthetic_only');
      if (url.pathname==='/api/activities' && request.method==='GET') return json({activities:await publicActivities(env.DB)});
      if (url.pathname==='/api/registrations' && request.method==='POST') {
        if (request.headers.get('Origin')!==url.origin) throw new AppError(403,'invalid_origin');
        await submitRegistration(env.DB,env.EVIDENCE_STORAGE,await bodyJson(request),requestId);
        return json({ok:true,message:'Inscripció rebuda. Rebràs una comunicació de prova.'},202);
      }
      if (url.pathname.startsWith('/api/')) throw new AppError(404,'not_found');
      const response=await env.ASSETS.fetch(request);
      const headers=new Headers(response.headers);
      headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
      headers.set('X-Content-Type-Options','nosniff');
      headers.set('Cache-Control','no-store');
      return new Response(response.body,{status:response.status,headers});
    } catch(error) {
      if (!(error instanceof AppError)) console.error('family activity request failure',{requestId,name:error?.name});
      return json({error:error instanceof AppError?error.code:'internal_error'},error instanceof AppError?error.status:500);
    }
  }
};
