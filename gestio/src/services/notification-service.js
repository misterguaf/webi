import { synthetic } from '../environment-policy.js';
import { statement } from '../domains/audit/repository.js';
import { AppError, requirePermission } from './common.js';

// evidenceId: the payment attempt a PAYMENT_ISSUE notice is about (at most one notice per attempt).
export function queueStatement(db,registrationId,kind,recipient,now=Date.now(),evidenceId=null) {
  if (!synthetic.email(recipient)) throw new AppError(400,'synthetic_email_required');
  const id=crypto.randomUUID();
  return {id,statement:db.prepare(`INSERT INTO notification_outbox(id,registration_id,kind,recipient_email,status,created_at,evidence_id)
    VALUES(?,?,?,?,'PENDING',?,?)`).bind(id,registrationId,kind,recipient,now,kind==='PAYMENT_ISSUE'?evidenceId:null)};
}
function compose(row) {
  const price=(row.expected_amount_cents/100).toFixed(2)+' EUR';
  const shared=`Activitat: ${row.activity_name}\nEducand: ${row.submitted_name}\nPreu: ${price}\n`;
  switch(row.kind) {
    case 'RECEIVED': return {subject:'Inscripció rebuda (prova)',body:shared+'Estat: rebuda. La revisarem i contactarem si cal.'};
    case 'PENDING_PAYMENT': return {subject:'Justificant rebut (prova)',body:shared+'Estat: pagament pendent de revisió.'};
    case 'CONFIRMED': return {subject:'Inscripció confirmada (prova)',body:shared+'Estat: confirmada.'};
    // 3.5F (REGISTRATIONS.md §13.3): neutral texts; nothing internal, no promise of an in-app flow.
    case 'PAYMENT_ISSUE': return {subject:'Incidència de pagament (prova)',body:shared+'Hem detectat un problema amb el justificant de pagament d’aquesta inscripció. Posa’t en contacte amb el grup per a resoldre-ho.'};
    case 'REJECTED': return {subject:'Sol·licitud no acceptada (prova)',body:shared+'No hem pogut acceptar aquesta sol·licitud d’inscripció. Si tens cap dubte, posa’t en contacte amb el grup.'};
    case 'WITHDRAWN': return {subject:'Retirada registrada (prova)',body:shared+'Hem registrat la retirada d’aquesta inscripció.'};
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
    const ok=!failSynthetic && synthetic.email(row.recipient_email);
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
  const fees=(await db.prepare(`SELECT n.id,n.kind,n.recipient_email FROM annual_fee_notification_outbox n
    WHERE n.status IN ('PENDING','FAILED') AND n.attempt_count<5 AND
      (n.kind!='FEE_PAYMENT_CONFIRMED' OR (
        NOT EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=n.payment_id AND i.status='OPEN') AND
        NOT EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_issue i ON i.obligation_id=a.obligation_id
          WHERE a.payment_id=n.payment_id AND i.status='OPEN') AND
        EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_obligation_status o ON o.id=a.obligation_id
          WHERE a.payment_id=n.payment_id AND o.status='PAID')))
    ORDER BY n.created_at,n.id LIMIT 50`).all()).results;
  for (const row of fees) {
    const ok=!failSynthetic && synthetic.email(row.recipient_email);
    const event=statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:ok?'NOTIFICATION_SENT':'NOTIFICATION_FAILED',resourceType:'annual_fee_notification_outbox',resourceId:row.id,
      result:ok?'SUCCESS':'ERROR',reasonCode:ok?null:'FAKE_PROVIDER_FAILURE',occurredAt:now});
    if (ok) {
      const content=row.kind==='FEE_SUBMISSION_RECEIVED'
        ?{subject:'Quota anual rebuda (prova)',body:'Hem rebut el justificant. El pagament encara no està verificat.'}
        :row.kind==='FEE_PAYMENT_CONFIRMED'
          ?{subject:'Quota anual confirmada (prova)',body:'La quota anual assignada ha quedat confirmada.'}
          :{subject:'Incidència de quota anual (prova)',
            body:'Hi ha hagut un problema amb el pagament i el grup es posarà en contacte amb vosaltres tan prompte com siga possible.\n'+
              'Ha habido un problema con el pago y el grupo se pondrá en contacto con vosotros lo antes posible.'};
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO annual_fee_notification_capture(outbox_id,recipient_email,subject,body,captured_at)
          VALUES(?,?,?,?,?)`).bind(row.id,row.recipient_email,content.subject,content.body,now),
        db.prepare(`UPDATE annual_fee_notification_outbox SET status='SENT',attempt_count=attempt_count+1,
          sent_at=?,last_error_code=NULL WHERE id=?`).bind(now,row.id),event]);
      sent++;
    } else {
      await db.batch([db.prepare(`UPDATE annual_fee_notification_outbox SET status='FAILED',
        attempt_count=attempt_count+1,last_error_code='FAKE_PROVIDER_FAILURE' WHERE id=?`).bind(row.id),event]);
      failed++;
    }
  }
  const issueNotices=(await db.prepare(`SELECT id,recipient_email FROM annual_fee_issue_outbox
    WHERE status IN ('PENDING','FAILED') AND attempt_count<5 ORDER BY created_at,id LIMIT 50`).all()).results;
  for (const row of issueNotices) {
    const ok=!failSynthetic && synthetic.email(row.recipient_email);
    const event=statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:ok?'NOTIFICATION_SENT':'NOTIFICATION_FAILED',resourceType:'annual_fee_issue_outbox',resourceId:row.id,
      result:ok?'SUCCESS':'ERROR',reasonCode:ok?null:'FAKE_PROVIDER_FAILURE',occurredAt:now});
    if (ok) {
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO annual_fee_issue_capture
          (outbox_id,recipient_email,subject,body,captured_at) VALUES(?,?,?,?,?)`)
          .bind(row.id,row.recipient_email,'Incidència de quota anual (prova)',
            'Hi ha hagut un problema amb el pagament i el grup es posarà en contacte amb vosaltres tan prompte com siga possible.\n'+
            'Ha habido un problema con el pago y el grupo se pondrá en contacto con vosotros tan pronto como sea posible.',now),
        db.prepare(`UPDATE annual_fee_issue_outbox SET status='SENT',attempt_count=attempt_count+1,
          sent_at=?,last_error_code=NULL WHERE id=?`).bind(now,row.id),event]);
      sent++;
    } else {
      await db.batch([db.prepare(`UPDATE annual_fee_issue_outbox SET status='FAILED',
        attempt_count=attempt_count+1,last_error_code='FAKE_PROVIDER_FAILURE' WHERE id=?`).bind(row.id),event]);
      failed++;
    }
  }
  return {sent,failed};
}
