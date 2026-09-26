import { statement } from '../domains/audit/repository.js';
import { AppError, requirePermission } from './common.js';

export function queueStatement(db,registrationId,kind,recipient,now=Date.now()) {
  if (!recipient?.endsWith('@example.test')) throw new AppError(400,'synthetic_email_required');
  const id=crypto.randomUUID();
  return {id,statement:db.prepare(`INSERT INTO notification_outbox(id,registration_id,kind,recipient_email,status,created_at)
    VALUES(?,?,?,?,'PENDING',?)`).bind(id,registrationId,kind,recipient,now)};
}
function compose(row) {
  const price=(row.expected_amount_cents/100).toFixed(2)+' EUR';
  const shared=`Activitat: ${row.activity_name}\nEducand: ${row.submitted_name}\nPreu: ${price}\n`;
  switch(row.kind) {
    case 'RECEIVED': return {subject:'Inscripció rebuda (prova)',body:shared+'Estat: rebuda. La revisarem i contactarem si cal.'};
    case 'PENDING_PAYMENT': return {subject:'Justificant rebut (prova)',body:shared+'Estat: pagament pendent de revisió.'};
    case 'CONFIRMED': return {subject:'Inscripció confirmada (prova)',body:shared+'Estat: confirmada.'};
    case 'PAYMENT_ISSUE': return {subject:'Incidència de pagament (prova)',body:shared+'S’ha detectat un problema amb el pagament de la inscripció. Ens posarem en contacte amb tu prompte.'};
    default: throw new AppError(500,'invalid_notification');
  }
}
export async function drainFake(db,context,requestId,{failSynthetic=false}={},now=Date.now()) {
  await requirePermission(db,context,requestId,'audit.event.read',{resourceType:'notification_outbox'});
  const pending=(await db.prepare(`SELECT o.id,o.kind,o.recipient_email,r.submitted_name,r.expected_amount_cents,a.name AS activity_name
    FROM notification_outbox o JOIN activity_registration r ON r.id=o.registration_id JOIN activity a ON a.id=r.activity_id
    WHERE o.status IN ('PENDING','FAILED') AND o.attempt_count<5 ORDER BY o.created_at,o.id LIMIT 50`).all()).results;
  let sent=0,failed=0;
  for (const row of pending) {
    const ok=!failSynthetic && row.recipient_email.endsWith('@example.test');
    const event=statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:ok?'NOTIFICATION_SENT':'NOTIFICATION_FAILED',resourceType:'notification_outbox',resourceId:row.id,
      result:ok?'SUCCESS':'ERROR',reasonCode:ok?null:'FAKE_PROVIDER_FAILURE',occurredAt:now});
    if (ok) {
      const mail=compose(row);
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO notification_capture(outbox_id,recipient_email,subject,body,captured_at) VALUES(?,?,?,?,?)`)
          .bind(row.id,row.recipient_email,mail.subject,mail.body,now),
        db.prepare(`UPDATE notification_outbox SET status='SENT',attempt_count=attempt_count+1,sent_at=?,last_error_code=NULL WHERE id=?`)
          .bind(now,row.id),event]);
      sent++;
    } else {
      await db.batch([db.prepare(`UPDATE notification_outbox SET status='FAILED',attempt_count=attempt_count+1,last_error_code='FAKE_PROVIDER_FAILURE'
        WHERE id=?`).bind(row.id),event]);
      failed++;
    }
  }
  return {sent,failed};
}
