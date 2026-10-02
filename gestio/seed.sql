-- Solo identidades y participantes ficticios. IDs estables para pruebas locales.
-- Catálogo (secciones, roles, permisos, matriz) también vive en la migración 0012; aquí es idempotente.
INSERT OR IGNORE INTO section VALUES
('00000000-0000-4000-8000-000000000001','MANADA','Manada'),
('00000000-0000-4000-8000-000000000002','TROPA','Tropa'),
('00000000-0000-4000-8000-000000000003','ESCOLTA','Escolta'),
('00000000-0000-4000-8000-000000000004','CLAN','Clan');
INSERT OR IGNORE INTO role(code) VALUES ('GROUP_COORDINATOR'),('SECTION_COORDINATOR'),('SECTION_DELEGATE'),('TREASURY'),('SECRETARY'),('CRM_MANAGER'),('TECH_ADMIN');
INSERT OR IGNORE INTO permission(code) VALUES
('participants.profile.read'),('health.record.read'),('finance.fee.reconcile'),
('crm.contact.read'),('auth.user.suspend'),('infra.status.read');
INSERT OR IGNORE INTO role_permission VALUES
('GROUP_COORDINATOR','participants.profile.read'),('GROUP_COORDINATOR','health.record.read'),('GROUP_COORDINATOR','auth.user.suspend'),
('SECTION_COORDINATOR','participants.profile.read'),('SECTION_COORDINATOR','health.record.read'),
('SECTION_DELEGATE','participants.profile.read'),('SECRETARY','participants.profile.read'),
('TREASURY','finance.fee.reconcile'),('CRM_MANAGER','crm.contact.read'),('TECH_ADMIN','infra.status.read');
INSERT OR IGNORE INTO role_permission VALUES
('GROUP_COORDINATOR','audit.event.read'),('GROUP_COORDINATOR','auth.role.manage'),
('GROUP_COORDINATOR','auth.permission.manage'),('GROUP_COORDINATOR','health.grant.manage'),
('GROUP_COORDINATOR','auth.user.manage'),('GROUP_COORDINATOR','security.incident.manage');
-- 3.5E participant management matrix (mirrors migration 0015; kept identical for clean-install parity).
INSERT OR IGNORE INTO permission(code) VALUES
('participants.profile.manage'),('participants.contact.read'),('participants.contact.manage'),
('participants.guardian.manage'),('participants.representation.accredit'),('participants.review.manage');
INSERT OR IGNORE INTO role_permission VALUES
('GROUP_COORDINATOR','participants.profile.manage'),('GROUP_COORDINATOR','participants.contact.read'),
('GROUP_COORDINATOR','participants.contact.manage'),('GROUP_COORDINATOR','participants.guardian.manage'),
('GROUP_COORDINATOR','participants.representation.accredit'),('GROUP_COORDINATOR','participants.review.manage'),
('SECRETARY','participants.profile.manage'),('SECRETARY','participants.contact.read'),
('SECRETARY','participants.contact.manage'),('SECRETARY','participants.guardian.manage'),
('SECRETARY','participants.representation.accredit'),('SECRETARY','participants.review.manage'),
('SECTION_COORDINATOR','participants.profile.manage'),('SECTION_COORDINATOR','participants.contact.read'),
('SECTION_COORDINATOR','participants.contact.manage'),('SECTION_COORDINATOR','participants.guardian.manage'),
('SECTION_DELEGATE','participants.profile.manage'),('SECTION_DELEGATE','participants.contact.read'),
('SECTION_DELEGATE','participants.contact.manage'),('SECTION_DELEGATE','participants.guardian.manage');
INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES
('00000000-0000-4000-8000-000000000101','Coordinación general (ficticia)','ACTIVE',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000102','Coordinación Tropa (ficticia)','ACTIVE',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000103','Coordinación Escolta (ficticia)','ACTIVE',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000104','Tesorería (ficticia)','ACTIVE',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000105','Secretaría (ficticia)','ACTIVE',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000106','CRM (ficticia)','ACTIVE',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000107','Técnica (ficticia)','ACTIVE',1700000000000,1700000000000);
INSERT INTO auth_identity(id,user_id,issuer,subject,verified_email) SELECT
  '00000000-0000-4000-8000-0000000002' || printf('%02d', CAST(substr(id,-3) AS INTEGER)-100),
  id,'urn:parpallo:local-synthetic','seed-' || substr(id,-3),
  'seed-' || substr(id,-3) || '@example.test' FROM app_user;
INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,granted_by,justification) VALUES
('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000101','GROUP_COORDINATOR',NULL,1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000102','SECTION_COORDINATOR','00000000-0000-4000-8000-000000000002',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000103','SECTION_COORDINATOR','00000000-0000-4000-8000-000000000003',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000104','TREASURY',NULL,1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000105','SECRETARY',NULL,1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000306','00000000-0000-4000-8000-000000000106','CRM_MANAGER',NULL,1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000307','00000000-0000-4000-8000-000000000107','TECH_ADMIN',NULL,1700000000000,NULL,'Fixture sintético');
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification) VALUES
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000101','participants.profile.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000101','auth.user.suspend',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000102','participants.profile.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000103','participants.profile.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000405','00000000-0000-4000-8000-000000000104','finance.fee.reconcile',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000406','00000000-0000-4000-8000-000000000105','participants.profile.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000407','00000000-0000-4000-8000-000000000106','crm.contact.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000408','00000000-0000-4000-8000-000000000107','infra.status.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000409','00000000-0000-4000-8000-000000000102','health.record.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000101','audit.event.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000411','00000000-0000-4000-8000-000000000101','auth.role.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000412','00000000-0000-4000-8000-000000000101','auth.permission.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000413','00000000-0000-4000-8000-000000000101','health.grant.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000414','00000000-0000-4000-8000-000000000101','auth.user.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000415','00000000-0000-4000-8000-000000000101','security.incident.manage',1700000000000,NULL,'Fixture sintético');
-- 3.5E: individual grants so the seeded operational users actually hold the participant permissions
-- (the model requires role AND grant). SECTION_COORDINATOR grants are scoped by their role's section.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification) VALUES
('00000000-0000-4000-8000-000000000421','00000000-0000-4000-8000-000000000101','participants.profile.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000422','00000000-0000-4000-8000-000000000101','participants.contact.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000423','00000000-0000-4000-8000-000000000101','participants.contact.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000424','00000000-0000-4000-8000-000000000101','participants.guardian.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000425','00000000-0000-4000-8000-000000000101','participants.representation.accredit',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000426','00000000-0000-4000-8000-000000000101','participants.review.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000428','00000000-0000-4000-8000-000000000105','participants.profile.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000429','00000000-0000-4000-8000-000000000105','participants.contact.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000430','00000000-0000-4000-8000-000000000105','participants.contact.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000431','00000000-0000-4000-8000-000000000105','participants.guardian.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000432','00000000-0000-4000-8000-000000000105','participants.representation.accredit',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000433','00000000-0000-4000-8000-000000000105','participants.review.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000434','00000000-0000-4000-8000-000000000102','participants.profile.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000435','00000000-0000-4000-8000-000000000102','participants.contact.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000436','00000000-0000-4000-8000-000000000102','participants.contact.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000437','00000000-0000-4000-8000-000000000102','participants.guardian.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000438','00000000-0000-4000-8000-000000000103','participants.profile.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000439','00000000-0000-4000-8000-000000000103','participants.contact.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000440','00000000-0000-4000-8000-000000000103','participants.contact.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000441','00000000-0000-4000-8000-000000000103','participants.guardian.manage',1700000000000,NULL,'Fixture sintético');
INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES
('00000000-0000-4000-8000-000000000501','Participante Manada A (ficticio)','00000000-0000-4000-8000-000000000001','ACTIVE','2017-06-12'),
('00000000-0000-4000-8000-000000000502','Participante Tropa A (ficticio)','00000000-0000-4000-8000-000000000002','ACTIVE','2013-05-18'),
('00000000-0000-4000-8000-000000000503','Participante Tropa B (ficticio)','00000000-0000-4000-8000-000000000002','ACTIVE','2012-11-03'),
('00000000-0000-4000-8000-000000000504','Participante Escolta A (ficticio)','00000000-0000-4000-8000-000000000003','ACTIVE','2009-04-26'),
('00000000-0000-4000-8000-000000000505','Participante Clan A (ficticio)','00000000-0000-4000-8000-000000000004','ACTIVE','2007-08-09');
INSERT INTO health_access_grant VALUES
('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000502','activity-safety',1700000000000,4102444800000,NULL,NULL,'Fixture sintético de policy; no hay datos de salud'),
('00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000503','activity-safety',1700000000000,1700000001000,NULL,NULL,'Grant expirado sintético');

-- FASE 3A: fixtures de negocio exclusivamente ficticios; no son actividades del grupo.
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('GROUP_COORDINATOR','activities.read'),('GROUP_COORDINATOR','activities.manage'),
  ('GROUP_COORDINATOR','activities.general.manage'),('GROUP_COORDINATOR','activities.registration.review'),
  ('GROUP_COORDINATOR','finance.payment.verify'),('GROUP_COORDINATOR','auth.permission.authorize'),
  ('GROUP_COORDINATOR','auth.permission.provision'),('GROUP_COORDINATOR','auth.permission.ratify'),
  ('SECTION_COORDINATOR','activities.read'),('SECTION_COORDINATOR','activities.manage'),
  ('SECTION_COORDINATOR','activities.general.manage'),('SECTION_COORDINATOR','activities.registration.review'),
  ('SECTION_COORDINATOR','auth.permission.authorize'),
  ('SECTION_DELEGATE','activities.read'),('SECTION_DELEGATE','activities.registration.review'),
  ('TREASURY','finance.payment.verify'),('TECH_ADMIN','auth.permission.provision');
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification) VALUES
('00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000101','activities.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000702','00000000-0000-4000-8000-000000000101','activities.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000703','00000000-0000-4000-8000-000000000101','activities.general.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000704','00000000-0000-4000-8000-000000000101','activities.registration.review',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000705','00000000-0000-4000-8000-000000000101','finance.payment.verify',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000706','00000000-0000-4000-8000-000000000101','auth.permission.authorize',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000707','00000000-0000-4000-8000-000000000101','auth.permission.provision',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000708','00000000-0000-4000-8000-000000000101','auth.permission.ratify',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000709','00000000-0000-4000-8000-000000000102','activities.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000710','00000000-0000-4000-8000-000000000102','activities.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000711','00000000-0000-4000-8000-000000000102','activities.general.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000712','00000000-0000-4000-8000-000000000102','activities.registration.review',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000713','00000000-0000-4000-8000-000000000102','auth.permission.authorize',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000714','00000000-0000-4000-8000-000000000103','activities.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000715','00000000-0000-4000-8000-000000000103','activities.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000716','00000000-0000-4000-8000-000000000103','activities.registration.review',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000717','00000000-0000-4000-8000-000000000103','auth.permission.authorize',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000718','00000000-0000-4000-8000-000000000104','finance.payment.verify',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000719','00000000-0000-4000-8000-000000000107','auth.permission.provision',1700000000000,NULL,'Fixture sintético');
INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,expires_at,granted_by,justification) VALUES
('00000000-0000-4000-8000-000000000731','00000000-0000-4000-8000-000000000105','SECTION_DELEGATE','00000000-0000-4000-8000-000000000002',1700000000000,4102444800000,'00000000-0000-4000-8000-000000000101','Delegación ficticia');
INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,authorization_reference,granted_at,expires_at,
  ratification_status,ratified_at,ratified_by,ratification_reference)
VALUES ('00000000-0000-4000-8000-000000000741','00000000-0000-4000-8000-000000000105','activities.registration.review','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000107','DEMO-AUTH-TROPA-001',1700000000000,4102444800000,
  'RATIFIED',1700000000001,'00000000-0000-4000-8000-000000000101','DEMO-RATIFIED-TROPA-001');
INSERT INTO participant_contact(participant_id,notification_email,verified_at) VALUES
('00000000-0000-4000-8000-000000000501','familia501@example.test',1700000000000),
('00000000-0000-4000-8000-000000000502','familia502@example.test',1700000000000),
('00000000-0000-4000-8000-000000000503','familia503@example.test',1700000000000),
('00000000-0000-4000-8000-000000000504','familia504@example.test',1700000000000),
('00000000-0000-4000-8000-000000000505','familia505@example.test',1700000000000);
INSERT INTO activity(id,public_code,name,status,audience,location,starts_at,ends_at,registration_deadline,price_cents,currency,short_description,materials,special_notice,created_by,created_at,updated_at) VALUES
('00000000-0000-4000-8000-000000000801','DEMO-FREE-TROPA','Eixida fictícia Tropa','PUBLISHED','SECTIONS','Lloc fictici',2209075200000,2209161600000,2208988800000,0,'EUR','Activitat de prova','Motxilla fictícia','','00000000-0000-4000-8000-000000000101',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000802','DEMO-PAID-ESCOLTA','Acampada fictícia Escolta','PUBLISHED','SECTIONS','Camp fictici',2209075200000,2209161600000,2208988800000,1200,'EUR','Activitat de prova','Material fictici','','00000000-0000-4000-8000-000000000101',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000803','DEMO-GENERAL','Jornada fictícia general','PUBLISHED','GENERAL','Lloc fictici',2209075200000,2209161600000,2208988800000,0,'EUR','Activitat de prova','','','00000000-0000-4000-8000-000000000101',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000804','DEMO-DRAFT','Esborrany fictici','DRAFT','SECTIONS','Lloc fictici',2209075200000,2209161600000,2208988800000,0,'EUR','','','','00000000-0000-4000-8000-000000000101',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000805','DEMO-CLOSED','Activitat tancada fictícia','CLOSED','SECTIONS','Lloc fictici',2209075200000,2209161600000,2208988800000,0,'EUR','','','','00000000-0000-4000-8000-000000000101',1700000000000,1700000000000);
INSERT INTO activity_section(activity_id,section_id) VALUES
('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000002'),
('00000000-0000-4000-8000-000000000802','00000000-0000-4000-8000-000000000003'),
('00000000-0000-4000-8000-000000000804','00000000-0000-4000-8000-000000000002'),
('00000000-0000-4000-8000-000000000805','00000000-0000-4000-8000-000000000002');
INSERT INTO activity_transport_option(activity_id,code,price_adjustment_cents) VALUES
('00000000-0000-4000-8000-000000000802','GROUP',300),
('00000000-0000-4000-8000-000000000802','FAMILY',0);
INSERT INTO activity_registration(id,activity_id,participant_id,submitted_name,match_key,submitted_section_id,receipt_email,transport_code,expected_amount_cents,match_status,status,consent_version,participation_terms_version,participation_authorized_at,privacy_notice_version,privacy_notice_acknowledged_at,idempotency_key,payload_sha256,created_at,updated_at) VALUES
('00000000-0000-4000-8000-000000000821','00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000503','Participante Tropa B (ficticio)','participante tropa b ficticio','00000000-0000-4000-8000-000000000002','demo821@example.test',NULL,0,'CLEAR','CONFIRMED','DEPRECATED','DEMO-3A-PARTICIPATION-V1',1700000000000,'DEMO-3A-PRIVACY-NOTICE-V1',1700000000000,'seed-registration-000000000821','0000000000000000000000000000000000000000000000000000000000000000',1700000000000,1700000000000),
('00000000-0000-4000-8000-000000000822','00000000-0000-4000-8000-000000000802','00000000-0000-4000-8000-000000000504','Participante Escolta A (ficticio)','participante escolta a ficticio','00000000-0000-4000-8000-000000000003','demo822@example.test','FAMILY',1200,'CLEAR','AWAITING_PAYMENT_REVIEW','DEPRECATED','DEMO-3A-PARTICIPATION-V1',1700000000000,'DEMO-3A-PRIVACY-NOTICE-V1',1700000000000,'seed-registration-000000000822','0000000000000000000000000000000000000000000000000000000000000000',1700000000000,1700000000000);
INSERT INTO payment_evidence(id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at) VALUES
('00000000-0000-4000-8000-000000000831','00000000-0000-4000-8000-000000000822','fixture-only/no-binary','0000000000000000000000000000000000000000000000000000000000000000',20,'application/pdf','PENDING_REVIEW',1700000000000);
INSERT INTO notification_outbox(id,registration_id,kind,recipient_email,status,created_at) VALUES
('00000000-0000-4000-8000-000000000841','00000000-0000-4000-8000-000000000821','CONFIRMED','familia503@example.test','PENDING',1700000000000),
('00000000-0000-4000-8000-000000000842','00000000-0000-4000-8000-000000000822','PENDING_PAYMENT','demo822@example.test','PENDING',1700000000000);

-- FASE 3B: only synthetic round instructions and explicit internal permissions.
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
('GROUP_COORDINATOR','finance.fee.read'),('GROUP_COORDINATOR','finance.fee.manage'),
('GROUP_COORDINATOR','finance.fee.payment.review'),('GROUP_COORDINATOR','finance.fee.installment.authorize'),
('GROUP_COORDINATOR','finance.fee.config.manage'),
('TREASURY','finance.fee.read'),('TREASURY','finance.fee.manage'),
('TREASURY','finance.fee.payment.review'),('TREASURY','finance.fee.installment.authorize'),
('TREASURY','finance.fee.config.manage');
-- 3.5G.1A: SECTION_DELEGATE carries no financial permission; financial delegations need no role ceiling.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification) VALUES
('00000000-0000-4000-8000-000000000720','00000000-0000-4000-8000-000000000101','finance.fee.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000721','00000000-0000-4000-8000-000000000101','finance.fee.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000722','00000000-0000-4000-8000-000000000101','finance.fee.payment.review',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000723','00000000-0000-4000-8000-000000000101','finance.fee.installment.authorize',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000724','00000000-0000-4000-8000-000000000101','finance.fee.config.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000725','00000000-0000-4000-8000-000000000104','finance.fee.read',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000726','00000000-0000-4000-8000-000000000104','finance.fee.manage',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000727','00000000-0000-4000-8000-000000000104','finance.fee.payment.review',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000728','00000000-0000-4000-8000-000000000104','finance.fee.installment.authorize',1700000000000,NULL,'Fixture sintético'),
('00000000-0000-4000-8000-000000000729','00000000-0000-4000-8000-000000000104','finance.fee.config.manage',1700000000000,NULL,'Fixture sintético');
INSERT INTO annual_fee_round(id,code,is_open,base_cents,deadline_at,account_holder,iban,concept_template,created_by,updated_by,created_at,updated_at)
VALUES('00000000-0000-4000-8000-000000000901','2026/2027',1,10000,NULL,'Titular fictici de prova',
  'ES0000000000000000000000','Cuota Anual {Nombre educando}',
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000101',1700000000000,1700000000000);

-- Historical 3B migration tests also load this seed before 0010 exists.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT id,user_id,'finance.fee.status.read',1700000000000,NULL,'Fixture sintético' FROM
  (SELECT '00000000-0000-4000-8000-000000000730' AS id,'00000000-0000-4000-8000-000000000102' AS user_id
   UNION ALL SELECT '00000000-0000-4000-8000-000000000731','00000000-0000-4000-8000-000000000103')
WHERE EXISTS(SELECT 1 FROM permission WHERE code='finance.fee.status.read');
INSERT OR IGNORE INTO role_permission(role_code,permission_code)
SELECT 'SECTION_COORDINATOR','finance.fee.status.read'
WHERE EXISTS(SELECT 1 FROM permission WHERE code='finance.fee.status.read');

-- FASE 3.5F: submitter contact on demand (activities.registration.contact.read) for the operational
-- reviewers. Conditional so older migration sets that load this seed stay compatible. User 105 keeps
-- its role as the Tropa delegate fixture; Secretaria's global registration review (0018 matrix) needs
-- individual grants that tests and the demo add explicitly.
INSERT OR IGNORE INTO role_permission(role_code,permission_code)
SELECT role_code,'activities.registration.contact.read' FROM
  (SELECT 'GROUP_COORDINATOR' AS role_code UNION ALL SELECT 'SECRETARY' UNION ALL SELECT 'SECTION_COORDINATOR' UNION ALL SELECT 'SECTION_DELEGATE')
WHERE EXISTS(SELECT 1 FROM permission WHERE code='activities.registration.contact.read');
INSERT OR IGNORE INTO role_permission(role_code,permission_code)
SELECT 'SECRETARY',code FROM (SELECT 'activities.read' AS code UNION ALL SELECT 'activities.registration.review')
WHERE EXISTS(SELECT 1 FROM permission WHERE code='activities.registration.contact.read');
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT id,user_id,'activities.registration.contact.read',1700000000000,NULL,'Fixture sintético' FROM
  (SELECT '00000000-0000-4000-8000-000000000451' AS id,'00000000-0000-4000-8000-000000000101' AS user_id
   UNION ALL SELECT '00000000-0000-4000-8000-000000000452','00000000-0000-4000-8000-000000000102'
   UNION ALL SELECT '00000000-0000-4000-8000-000000000453','00000000-0000-4000-8000-000000000103')
WHERE EXISTS(SELECT 1 FROM permission WHERE code='activities.registration.contact.read');

-- FASE 3.5G.1A: fee submitter contact on demand (finance.fee.contact.read) for the synthetic
-- general coordinator and treasurer. Conditional so older migration sets loading this seed still work.
INSERT OR IGNORE INTO role_permission(role_code,permission_code)
SELECT role_code,'finance.fee.contact.read' FROM (SELECT 'GROUP_COORDINATOR' AS role_code UNION ALL SELECT 'TREASURY')
WHERE EXISTS(SELECT 1 FROM permission WHERE code='finance.fee.contact.read');
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT id,user_id,'finance.fee.contact.read',1700000000000,NULL,'Fixture sintético' FROM
  (SELECT '00000000-0000-4000-8000-000000000461' AS id,'00000000-0000-4000-8000-000000000101' AS user_id
   UNION ALL SELECT '00000000-0000-4000-8000-000000000462','00000000-0000-4000-8000-000000000104')
WHERE EXISTS(SELECT 1 FROM permission WHERE code='finance.fee.contact.read');

-- FASE 3.5G.1: financial foundation grants for the synthetic treasurer (104) and general coordinator (101),
-- mirroring migration 0027 (no import for 101; nobody gets the bank-description reveal by default).
-- VALUES rather than UNION ALL: D1 limits compound SELECTs to five terms.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT column1,column2,column3,1700000000000,NULL,'Fixture sintético' FROM (VALUES
  ('00000000-0000-4000-8000-000000000471','00000000-0000-4000-8000-000000000104','finance.treasury.read'),
  ('00000000-0000-4000-8000-000000000472','00000000-0000-4000-8000-000000000104','finance.round.manage'),
  ('00000000-0000-4000-8000-000000000473','00000000-0000-4000-8000-000000000104','finance.position.manage'),
  ('00000000-0000-4000-8000-000000000474','00000000-0000-4000-8000-000000000104','finance.movement.read'),
  ('00000000-0000-4000-8000-000000000475','00000000-0000-4000-8000-000000000104','finance.movement.import'),
  ('00000000-0000-4000-8000-000000000476','00000000-0000-4000-8000-000000000104','finance.movement.classify'),
  ('00000000-0000-4000-8000-000000000477','00000000-0000-4000-8000-000000000104','finance.expense.read'),
  ('00000000-0000-4000-8000-000000000478','00000000-0000-4000-8000-000000000104','finance.expense.manage'),
  ('00000000-0000-4000-8000-000000000479','00000000-0000-4000-8000-000000000104','finance.budget.read'),
  ('00000000-0000-4000-8000-000000000480','00000000-0000-4000-8000-000000000104','finance.budget.propose'),
  ('00000000-0000-4000-8000-000000000481','00000000-0000-4000-8000-000000000101','finance.treasury.read'),
  ('00000000-0000-4000-8000-000000000482','00000000-0000-4000-8000-000000000101','finance.round.manage'),
  ('00000000-0000-4000-8000-000000000483','00000000-0000-4000-8000-000000000101','finance.position.manage'),
  ('00000000-0000-4000-8000-000000000484','00000000-0000-4000-8000-000000000101','finance.movement.read'),
  ('00000000-0000-4000-8000-000000000485','00000000-0000-4000-8000-000000000101','finance.movement.classify'),
  ('00000000-0000-4000-8000-000000000486','00000000-0000-4000-8000-000000000101','finance.expense.read'),
  ('00000000-0000-4000-8000-000000000487','00000000-0000-4000-8000-000000000101','finance.expense.manage'),
  ('00000000-0000-4000-8000-000000000488','00000000-0000-4000-8000-000000000101','finance.budget.read'),
  ('00000000-0000-4000-8000-000000000489','00000000-0000-4000-8000-000000000101','finance.budget.propose'),
  ('00000000-0000-4000-8000-000000000490','00000000-0000-4000-8000-000000000101','finance.budget.approve'))
WHERE EXISTS(SELECT 1 FROM permission WHERE code='finance.treasury.read');

-- FASE 3.5G.2A (ingressos): general incomes, mirroring migration 0029.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT column1,column2,column3,1700000000000,NULL,'Fixture sintético' FROM (VALUES
  ('00000000-0000-4000-8000-000000000491','00000000-0000-4000-8000-000000000104','finance.income.read'),
  ('00000000-0000-4000-8000-000000000492','00000000-0000-4000-8000-000000000104','finance.income.manage'),
  ('00000000-0000-4000-8000-000000000493','00000000-0000-4000-8000-000000000101','finance.income.read'),
  ('00000000-0000-4000-8000-000000000494','00000000-0000-4000-8000-000000000101','finance.income.manage'))
WHERE EXISTS(SELECT 1 FROM permission WHERE code='finance.income.read');
