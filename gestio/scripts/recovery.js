import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repo=resolve(root,'..');
const wrangler=resolve(repo,'node_modules/.bin/wrangler');
const appVersion=JSON.parse(readFileSync(resolve(repo,'package.json'),'utf8')).version;
const DB_NAME='parpallo-gestio-local';
const FORMAT=1;
const MAX_SQL_BYTES=50*1024*1024; // local synthetic cap, not a D1 platform limit
const TABLES=[
  'app_user','auth_identity','app_session','section','role','permission','role_permission',
  'user_role','user_permission_grant','participant','health_access_grant','security_event',
  'audit_event','security_incident','incident_resource','incident_audit_hold','retention_policy',
  'activity','activity_section','activity_transport_option','participant_contact','delegated_permission',
  'activity_registration','payment_evidence','notification_outbox','notification_capture',
  'annual_fee_round','annual_fee_round_revision','annual_fee_family_group','annual_fee_family_member',
  'annual_fee_family_revision','annual_fee_family_revision_member','annual_fee_family_correction_gate',
  'annual_fee_obligation','annual_fee_amount_revision',
  'annual_fee_payment','annual_fee_submission_person','annual_fee_evidence','annual_fee_allocation',
  'annual_fee_allocation_revision',
  'annual_fee_installment_plan','annual_fee_installment_part','annual_fee_issue',
  'annual_fee_notification_outbox','annual_fee_notification_capture',
  'annual_fee_issue_outbox','annual_fee_issue_capture','d1_migrations',
  'participant_section_membership','guardian','participant_guardian','contact_point','consent_record',
  'auth_identity_invitation','delegated_permission_confirmation',
  'participant_representation_event','participant_review','activity_registration_section_change',
  'activity_payment_allocation',
  'finance_round','finance_position','finance_opening_balance','finance_reserve_opening','finance_round_close',
  'finance_post_close_adjustment','finance_import_batch','finance_movement','finance_movement_description',
  'finance_counterparty','finance_counterparty_revision','finance_budget','finance_budget_line','finance_budget_line_revision',
  'finance_budget_revision','finance_expense','finance_expense_line','finance_expense_revision','finance_expense_evidence',
  'finance_reimbursement','finance_card_statement','finance_overpayment','finance_income','finance_income_revision','finance_allocation',
  'finance_allocation_correction'
];
const REQUIRED_OBJECTS=[
  'index:app_session_user_active_idx','index:audit_event_request_idx','index:user_role_unrevoked_unique',
  'trigger:session_user_must_be_active','trigger:revoke_session_on_account_block',
  'trigger:role_recipient_must_be_active','trigger:permission_recipient_must_be_active',
  'trigger:health_recipient_must_be_active','index:activity_registration_member_unique',
  'index:participant_matching_idx','trigger:registration_birthdate_only_pending_insert',
  'trigger:registration_birthdate_only_pending_update',
  'index:activity_registration_pending_unique','index:delegated_permission_active_unique',
  'trigger:registration_authorizations_required_insert','trigger:registration_authorizations_immutable_update',
  'trigger:activity_status_transition','trigger:activity_terms_locked',
  'trigger:activity_registration_transition','trigger:payment_review_transition',
  'trigger:delegated_permission_transition','trigger:activity_section_locked_insert',
  'trigger:activity_section_locked_delete','trigger:activity_transport_locked_insert',
  'trigger:activity_transport_locked_delete','trigger:notification_delivery_transition',
  'index:annual_fee_one_open_round','index:annual_fee_payment_person_unique',
  'index:annual_fee_round_revision_idx','index:annual_fee_amount_revision_idx',
  'index:annual_fee_allocation_revision_idx',
  'index:annual_fee_allocation_obligation_idx','trigger:annual_fee_allocation_guard',
  'trigger:annual_fee_allocation_no_update','trigger:annual_fee_allocation_delete_guard',
  'trigger:annual_fee_payment_amount_guard','trigger:annual_fee_payment_review_guard',
  'trigger:annual_fee_payment_no_unverify_allocated','trigger:annual_fee_confirm_delivery_guard',
  'trigger:annual_fee_obligation_allocation_amount_guard',
  'trigger:annual_fee_obligation_family_insert_guard','trigger:annual_fee_obligation_family_update_guard',
  'index:annual_fee_one_active_installment_plan','index:annual_fee_plan_replaced_once',
  'trigger:annual_fee_installment_plan_insert_guard',
  'trigger:annual_fee_installment_part_insert_guard','trigger:annual_fee_installment_part_no_update',
  'trigger:annual_fee_installment_part_no_delete','trigger:annual_fee_installment_plan_activation',
  'trigger:annual_fee_installment_plan_transition','trigger:annual_fee_installment_plan_no_delete',
  'trigger:annual_fee_obligation_installment_total_update','index:annual_fee_family_revision_group_idx',
  'view:annual_fee_obligation_status',
  'view:annual_fee_payment_balance','trigger:annual_fee_payment_allocated_review_guard',
  'trigger:annual_fee_unallocated_issue_resolution_guard',
  'trigger:annual_fee_family_member_insert_guard','trigger:annual_fee_family_member_update_guard',
  'trigger:annual_fee_family_member_delete_guard','index:annual_fee_issue_outbox_pending_idx',
  'index:annual_fee_family_member_binding_unique',
  'trigger:annual_fee_family_member_binding_insert','trigger:annual_fee_family_member_binding_update',
  'trigger:annual_fee_obligation_member_update',
  'index:participant_membership_open_unique','trigger:participant_membership_on_insert',
  'trigger:participant_membership_on_transfer','trigger:participant_membership_on_status',
  'trigger:participant_membership_open_consistent','trigger:participant_membership_close_only',
  'trigger:participant_membership_no_delete','index:contact_point_participant_primary',
  'index:contact_point_guardian_primary','trigger:participant_contact_mirror_insert',
  'trigger:consent_record_no_update','trigger:consent_record_no_delete','view:participant_consent_current',
  'trigger:participant_representation_event_no_update','trigger:participant_representation_event_no_delete',
  'index:participant_guardian_current_unique','trigger:participant_guardian_episode_order',
  'trigger:participant_guardian_history_immutable','trigger:participant_guardian_no_delete',
  'trigger:registration_declared_section_immutable','trigger:registration_section_correction_guard',
  'trigger:registration_section_on_insert','trigger:registration_section_fill','trigger:registration_withdrawal_immutable',
  'trigger:registration_escalation_pending_only','trigger:payment_evidence_purge_once',
  'trigger:activity_registration_section_change_no_update','trigger:activity_registration_section_change_no_delete',
  'view:activity_payment_balance','index:notification_outbox_registration_kind_unique','index:notification_outbox_issue_attempt_unique','index:payment_evidence_registration_idx','index:activity_payment_allocation_evidence_idx','trigger:activity_payment_allocation_guard','trigger:activity_payment_allocation_no_update',
  'trigger:activity_payment_allocation_no_delete','trigger:payment_review_transition',
  'index:auth_identity_invitation_open_unique','trigger:auth_identity_invitation_recipient_active',
  'trigger:delegated_permission_confirmation_by_authoriser','trigger:delegated_permission_no_self_insert',
  'trigger:delegated_permission_ratification_governance',
  'index:finance_round_one_open','index:finance_round_one_closing','trigger:finance_round_no_overlap_insert',
  'trigger:finance_round_no_overlap_update','trigger:finance_round_transition','trigger:finance_round_closed_immutable',
  'trigger:finance_round_close_required','trigger:finance_opening_balance_guard','trigger:finance_reserve_opening_guard',
  'trigger:finance_post_close_adjustment_carry','view:finance_opening_balance_current',
  'index:finance_movement_batch_row_unique','trigger:finance_movement_immutable','trigger:finance_movement_void_guard',
  'trigger:finance_movement_void_unallocated','trigger:finance_movement_no_delete','trigger:finance_movement_description_no_delete',
  'trigger:finance_allocation_kind_enabled','trigger:finance_allocation_current_set','trigger:finance_allocation_not_above_movement',
  'trigger:finance_allocation_direction','trigger:finance_allocation_income_guard','trigger:finance_allocation_expense_guard',
  'trigger:finance_allocation_transfer_guard','trigger:finance_allocation_no_update','trigger:finance_allocation_no_delete',
  'trigger:finance_expense_insert_guard','trigger:finance_expense_update_guard','trigger:finance_expense_line_guard',
  'trigger:finance_expense_line_no_delete','trigger:finance_expense_evidence_immutable','trigger:finance_reimbursement_self_approval',
  'trigger:finance_counterparty_user_link_guard','trigger:finance_budget_transition','trigger:finance_budget_line_insert_guard',
  'trigger:finance_budget_line_update_guard','trigger:finance_budget_line_no_delete','trigger:finance_budget_line_parent_in_use',
  'trigger:finance_budget_revision_insert_guard','trigger:finance_budget_revision_transition',
  'view:finance_budget_line_amount','view:finance_allocation_current','view:finance_movement_allocation_balance','view:finance_round_economics',
  'index:finance_income_round_idx','index:finance_income_line_idx','trigger:finance_income_insert_guard',
  'trigger:finance_income_update_guard','trigger:finance_income_no_delete',
  'trigger:finance_income_revision_no_update','trigger:finance_income_revision_no_delete',
  'index:finance_allocation_income_idx','trigger:finance_allocation_income_link_guard',
  'trigger:finance_allocation_income_link_immutable',
  'index:finance_allocation_reimbursement_idx','trigger:finance_expense_recognition_evidence',
  'trigger:finance_expense_self_exception_insert_guard','trigger:finance_expense_self_exception_guard','trigger:finance_expense_reimbursement_lock',
  'trigger:finance_reimbursement_v1_insert_guard','trigger:finance_reimbursement_transition_guard',
  'trigger:finance_reimbursement_settlement_guard',
  'index:finance_expense_evidence_current_idx','index:finance_reimbursement_active_unique',
  'trigger:finance_expense_evidence_current_guard',
  'trigger:finance_expense_correction_reason','trigger:finance_expense_reimbursement_sync',
  'trigger:finance_allocation_correction_immutable','trigger:finance_allocation_correction_no_delete'
];
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new Error(code);};

function run(command,args,options={}) {
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000,
    env:{...process.env,WRANGLER_SEND_METRICS:'false'},...options});
  if (result.error || result.status!==0) fail('LOCAL_COMMAND_FAILED');
  return result.stdout??'';
}
function argumentPath(value) {
  if (typeof value!=='string' || !isAbsolute(value) || resolve(value)!==value || value==='/') fail('ABSOLUTE_PATH_REQUIRED');
  return value;
}
function missing(path) {
  try { lstatSync(path); return false; } catch(error) {if(error.code==='ENOENT') return true;throw error;}
}
function newTarget(path) {
  argumentPath(path);
  if (!missing(path)) fail('TARGET_EXISTS');
  const parent=dirname(path);
  if (!statSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) fail('INVALID_PARENT');
}
function assertUnversionedOutput(path,kind) {
  const rel=relative(repo,path);
  if (rel.startsWith('..') || isAbsolute(rel)) return;
  const allowed=kind==='backup'?'gestio/.local-backups/':'gestio/.local-restores/';
  if (!rel.startsWith(allowed)) fail('UNSAFE_REPOSITORY_OUTPUT');
}
function configInfo(path) {
  const config=argumentPath(path);
  const body=readFileSync(config,'utf8');
  if (!/^name\s*=\s*"parpallo-gestio-local"\s*$/m.test(body) ||
      !/^APP_ENV\s*=\s*"development"\s*$/m.test(body) ||
      !/^DEV_IDENTITY_PROVIDER\s*=\s*"enabled"\s*$/m.test(body) ||
      !/^database_id\s*=\s*"00000000-0000-0000-0000-000000000001"\s*$/m.test(body) ||
      process.env.APP_ENV==='production') fail('SYNTHETIC_CONFIG_REQUIRED');
  const folder=dirname(config);
  const names=readdirSync(join(folder,'migrations')).filter(name=>/^\d{4}_[a-z0-9_-]+\.sql$/.test(name)).sort();
  if (!names.length) fail('MIGRATIONS_MISSING');
  const migrationHash=sha(names.map(name=>name+'\n'+readFileSync(join(folder,'migrations',name),'utf8')).join('\n'));
  return {path:config,folder,names,migrationHash};
}
function sqliteQuery(database,sql) {
  const output=run('sqlite3',['-json',database,sql]);
  try {return output.trim()?JSON.parse(output):[];} catch {fail('SQLITE_QUERY_INVALID');}
}
// Seed people must be present and every person/identity must be visibly synthetic. Users and
// identities provisioned locally through the identity API are allowed if they are synthetic too.
function checkFixtures(database) {
  const users=sqliteQuery(database,'SELECT id,display_name FROM app_user ORDER BY id');
  const people=sqliteQuery(database,'SELECT id,display_name FROM participant ORDER BY id');
  const identities=sqliteQuery(database,'SELECT issuer,verified_email FROM auth_identity');
  const seedUsers=Array.from({length:7},(_,index)=>'00000000-0000-4000-8000-'+String(101+index).padStart(12,'0'));
  const seedPeople=Array.from({length:5},(_,index)=>'00000000-0000-4000-8000-'+String(501+index).padStart(12,'0'));
  if (users.length<7 || people.length<5 || identities.length<7 ||
      seedUsers.some(id=>!users.some(row=>row.id===id)) || seedPeople.some(id=>!people.some(row=>row.id===id))) fail('SYNTHETIC_FIXTURE_REQUIRED');
  if (users.some(row=>!/\(fict[ií]ci[ao]?\)/i.test(row.display_name)) ||
      people.some(row=>!row.display_name.includes('(ficticio)')) ||
      identities.some(row=>row.issuer!=='urn:parpallo:local-synthetic' ||
        !row.verified_email?.endsWith('@example.test'))) fail('SYNTHETIC_FIXTURE_REQUIRED');
}
function checkSecurityInvariants(database) {
  const row=sqliteQuery(database,"SELECT "+
    "(SELECT count(*) FROM app_session s JOIN app_user u ON u.id=s.user_id WHERE u.status!='ACTIVE' AND s.revoked_at IS NULL) AS blocked_sessions,"+
    "(SELECT count(*) FROM user_role r JOIN user_permission_grant g ON g.user_id=r.user_id WHERE r.user_id='00000000-0000-4000-8000-000000000102' AND r.role_code='SECTION_COORDINATOR' AND r.section_id='00000000-0000-4000-8000-000000000002' AND r.revoked_at IS NULL AND g.permission_code='participants.profile.read' AND g.revoked_at IS NULL) AS troop_grants,"+
    "(SELECT count(*) FROM user_permission_grant WHERE user_id='00000000-0000-4000-8000-000000000107' AND permission_code='participants.profile.read' AND revoked_at IS NULL) AS tech_profile_grants,"+
    "(SELECT count(*) FROM incident_audit_hold WHERE released_at IS NULL) AS active_holds,"+
    "(SELECT count(*) FROM incident_audit_hold WHERE released_at IS NULL AND audit_event_id IN (SELECT id FROM audit_event)) AS linked_holds,"+
    "(SELECT count(*) FROM retention_policy WHERE enabled!=0) AS enabled_retention,"+
    "(SELECT count(*) FROM health_access_grant WHERE id='00000000-0000-4000-8000-000000000602' AND expires_at<1700000002000) AS expired_fixture")[0];
  if (!row || row.blocked_sessions!==0 || row.troop_grants!==1 || row.tech_profile_grants!==0 ||
      row.active_holds!==row.linked_holds || row.enabled_retention!==0 || row.expired_fixture!==1) fail('AUTH_INVARIANT_FAILED');
}
function inspectSql(sqlPath,info) {
  const bytes=readFileSync(sqlPath);
  if (!bytes.length || bytes.length>MAX_SQL_BYTES) fail('INVALID_BACKUP_SIZE');
  const sql=bytes.toString('utf8');
  if (/(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN|ACCESS_CLIENT_SECRET|PRIVATE_KEY|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gestio_session=)/i.test(sql) ||
      /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(sql)) fail('SECRET_PATTERN_DETECTED');
  const scratch=mkdtempSync(join(tmpdir(),'parpallo-verify-'));
  try {
    chmodSync(scratch,0o700);
    const database=join(scratch,'verify.sqlite');
    run('sqlite3',['-bail',database],{input:bytes});
    const integrity=sqliteQuery(database,'PRAGMA integrity_check');
    if (integrity.length!==1 || integrity[0].integrity_check!=='ok' ||
        sqliteQuery(database,'PRAGMA foreign_key_check').length) fail('DATABASE_INTEGRITY_FAILED');
    const migrations=sqliteQuery(database,'SELECT name FROM d1_migrations ORDER BY id').map(row=>row.name);
    if (JSON.stringify(migrations)!==JSON.stringify(info.names)) fail('SCHEMA_VERSION_MISMATCH');
    const tables=sqliteQuery(database,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name").map(row=>row.name);
    if (JSON.stringify(tables)!==JSON.stringify([...TABLES].sort())) fail('SCHEMA_TABLE_MISMATCH');
    const schema=sqliteQuery(database,"SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY type,name");
    const objects=schema.map(row=>row.type+':'+row.name);
    if (REQUIRED_OBJECTS.some(name=>!objects.includes(name))) fail('SCHEMA_OBJECT_MISSING');
    const counts=Object.fromEntries(TABLES.map(name=>[name,sqliteQuery(database,'SELECT count(*) AS n FROM '+name)[0].n]));
    checkFixtures(database);
    checkSecurityInvariants(database);
    const syntheticBusiness=sqliteQuery(database,"SELECT "+
      "(SELECT count(*) FROM notification_outbox WHERE recipient_email NOT LIKE '%@%.test') AS external_mail,"+
      "(SELECT count(*) FROM participant_contact WHERE notification_email NOT LIKE '%@%.test') AS external_contact,"+
      "(SELECT count(*) FROM payment_evidence WHERE object_key NOT LIKE 'synthetic/%' AND object_key!='fixture-only/no-binary') AS external_object,"+
      "(SELECT count(*) FROM delegated_permission WHERE authorization_reference NOT LIKE 'DEMO-%') AS external_delegation,"+
      "(SELECT count(*) FROM annual_fee_payment WHERE receipt_email NOT LIKE '%@example.test') AS external_fee_mail,"+
      "(SELECT count(*) FROM annual_fee_evidence WHERE object_key NOT LIKE 'synthetic/%') AS external_fee_object,"+
      "(SELECT count(*) FROM annual_fee_notification_outbox WHERE recipient_email NOT LIKE '%@example.test') AS external_fee_notice,"+
      "(SELECT count(*) FROM contact_point WHERE kind='EMAIL' AND value NOT LIKE '%@example.test') AS external_contact_point,"+
      "(SELECT count(*) FROM guardian WHERE display_name NOT LIKE '%(fictici%') AS external_guardian,"+
      "(SELECT count(*) FROM auth_identity_invitation WHERE email NOT LIKE '%@example.test') AS external_invitation,"+
      "(SELECT count(*) FROM finance_counterparty WHERE display_name NOT LIKE '%(fict%') AS external_counterparty,"+
      "(SELECT count(*) FROM finance_expense WHERE supplier_label IS NOT NULL AND supplier_label NOT LIKE '%(fict%') AS external_supplier,"+
      "(SELECT count(*) FROM finance_expense_evidence WHERE object_key NOT LIKE 'synthetic/%') AS external_expense_object,"+
      "(SELECT count(*) FROM finance_import_batch WHERE source_object_key IS NOT NULL AND source_object_key NOT LIKE 'synthetic/%') AS external_import_object")[0];
    if (Object.values(syntheticBusiness).some(value=>value!==0)) fail('SYNTHETIC_BUSINESS_REQUIRED');
    const sessionColumns=sqliteQuery(database,'PRAGMA table_info(app_session)').map(row=>row.name);
    if (sessionColumns.includes('token') || !sessionColumns.includes('token_hash')) fail('PLAINTEXT_SESSION_SCHEMA');
    return {sqlBytes:bytes.length,sqlSha256:sha(bytes),schemaSha256:sha(JSON.stringify(schema)),
      schemaObjects:objects,schemaVersion:migrations.length,migrations,tableCounts:counts};
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
function assertBackupFiles(folder) {
  argumentPath(folder);
  if (!statSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) fail('INVALID_BACKUP');
  for (const name of ['manifest.json','dump.sql']) {
    const item=join(folder,name);
    if (!statSync(item).isFile() || lstatSync(item).isSymbolicLink()) fail('INVALID_BACKUP');
  }
}
export function verifyBackup(backupPath,configPath=resolve(root,'wrangler.toml')) {
  const info=configInfo(configPath);
  assertBackupFiles(backupPath);
  let manifest;
  try {manifest=JSON.parse(readFileSync(join(backupPath,'manifest.json'),'utf8'));} catch {fail('INVALID_MANIFEST');}
  if (!manifest || manifest.format_version!==FORMAT || manifest.environment!=='local-development' ||
      manifest.synthetic!==true || manifest.database_name!==DB_NAME ||
      manifest.application_version!==appVersion || manifest.migration_sha256!==info.migrationHash ||
      !/^[0-9a-f-]{36}$/i.test(manifest.backup_id??'')) fail('INCOMPATIBLE_BACKUP');
  const snapshot=inspectSql(join(backupPath,'dump.sql'),info);
  for (const [key,snapshotKey] of Object.entries({sql_bytes:'sqlBytes',sql_sha256:'sqlSha256',
    schema_sha256:'schemaSha256',schema_version:'schemaVersion'})) {
    if (manifest[key]!==snapshot[snapshotKey]) fail('BACKUP_INTEGRITY_FAILED');
  }
  if (JSON.stringify(manifest.schema_objects)!==JSON.stringify(snapshot.schemaObjects) ||
      JSON.stringify(manifest.migrations)!==JSON.stringify(snapshot.migrations) ||
      JSON.stringify(manifest.table_counts)!==JSON.stringify(snapshot.tableCounts)) fail('BACKUP_INTEGRITY_FAILED');
  return {manifest,info};
}
export function createBackup(outputPath,configPath=resolve(root,'wrangler.toml')) {
  const info=configInfo(configPath);
  newTarget(outputPath);
  assertUnversionedOutput(outputPath,'backup');
  if (!existsSync(join(info.folder,'.wrangler','state'))) fail('LOCAL_D1_STATE_MISSING');
  const temp=mkdtempSync(join(dirname(outputPath),'.parpallo-backup-partial-'));
  try {
    chmodSync(temp,0o700);
    run(wrangler,['d1','export',DB_NAME,'--local','--config',info.path,'--output',join(temp,'dump.sql'),'--skip-confirmation'],
      {cwd:info.folder});
    // D1 imports the dump with FK checks active. The generated family FK needs its parent unique
    // index before the first populated obligation row, while Wrangler exports indexes last.
    const dumpPath=join(temp,'dump.sql');
    const dump=readFileSync(dumpPath,'utf8');
    const bindingIndex='CREATE UNIQUE INDEX annual_fee_family_member_binding_unique ON annual_fee_family_member(binding_key);\n';
    if (!dump.includes(bindingIndex)) fail('SCHEMA_OBJECT_MISSING');
    const ordered=dump.replace(bindingIndex,'');
    const memberTable=ordered.indexOf('CREATE TABLE annual_fee_family_member');
    const memberEnd=memberTable<0?-1:ordered.indexOf(';\n',memberTable);
    if (memberEnd<0) fail('SCHEMA_OBJECT_MISSING');
    let fixed=ordered.slice(0,memberEnd+2)+bindingIndex+ordered.slice(memberEnd+2);
    // 3.5G.2A: finance_allocation gained a FK to finance_income (migration 0029), but Wrangler exports tables
    // in creation order. The income tables and their rows move before finance_allocation.
    const incomeStart=fixed.indexOf('CREATE TABLE finance_income');
    const allocationStart=fixed.indexOf('CREATE TABLE finance_allocation');
    if (incomeStart>=0) {
      if (allocationStart<0) fail('SCHEMA_OBJECT_MISSING');
      let incomeEnd=fixed.indexOf('CREATE TABLE ',incomeStart+1);
      while (incomeEnd>=0 && fixed.startsWith('CREATE TABLE finance_income',incomeEnd)) incomeEnd=fixed.indexOf('CREATE TABLE ',incomeEnd+1);
      if (incomeEnd<0) { const rest=fixed.slice(incomeStart).search(/\nCREATE (UNIQUE )?INDEX|\nCREATE TRIGGER|\nCREATE VIEW/); incomeEnd=rest<0?-1:incomeStart+rest+1; }
      if (incomeStart>allocationStart && incomeEnd>incomeStart) {
        const block=fixed.slice(incomeStart,incomeEnd);
        fixed=fixed.slice(0,allocationStart)+block+fixed.slice(allocationStart,incomeStart)+fixed.slice(incomeEnd);
      }
    }
    writeFileSync(dumpPath,fixed,{mode:0o600});
    chmodSync(join(temp,'dump.sql'),0o600);
    const snapshot=inspectSql(join(temp,'dump.sql'),info);
    const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'});
    const manifest={
      format_version:FORMAT,backup_id:randomUUID(),created_at:new Date().toISOString(),
      environment:'local-development',synthetic:true,database_name:DB_NAME,
      application_version:appVersion,commit:commit.status===0?commit.stdout.trim():null,
      migration_sha256:info.migrationHash,schema_version:snapshot.schemaVersion,
      migrations:snapshot.migrations,schema_sha256:snapshot.schemaSha256,schema_objects:snapshot.schemaObjects,
      sql_bytes:snapshot.sqlBytes,sql_sha256:snapshot.sqlSha256,table_counts:snapshot.tableCounts
    };
    writeFileSync(join(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
    verifyBackup(temp,info.path);
    renameSync(temp,outputPath);
    return manifest;
  } catch(error) {rmSync(temp,{recursive:true,force:true});throw error;}
}

function d1Query(info,state,sql) {
  const raw=run(wrangler,['d1','execute',DB_NAME,'--local','--persist-to',state,'--config',info.path,'--command',sql,'--json'],
    {cwd:info.folder});
  let parsed;
  try {parsed=JSON.parse(raw);} catch {fail('D1_VERIFY_FAILED');}
  if (!Array.isArray(parsed) || parsed.length!==1 || parsed[0].success!==true) fail('D1_VERIFY_FAILED');
  return parsed[0].results;
}
function verifyRestoredState(info,state,manifest) {
  const integrity=d1Query(info,state,'PRAGMA quick_check');
  if (integrity.length!==1 || integrity[0].quick_check!=='ok' ||
      d1Query(info,state,'PRAGMA foreign_key_check').length) fail('D1_INTEGRITY_FAILED');
  const migrations=d1Query(info,state,'SELECT name FROM d1_migrations ORDER BY id').map(row=>row.name);
  if (JSON.stringify(migrations)!==JSON.stringify(manifest.migrations)) fail('D1_SCHEMA_MISMATCH');
  const schema=d1Query(info,state,"SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY type,name");
  const tables=schema.filter(row=>row.type==='table').map(row=>row.name).sort();
  if (JSON.stringify(tables)!==JSON.stringify([...TABLES].sort())) fail('D1_SCHEMA_MISMATCH');
  if (JSON.stringify(schema.map(row=>row.type+':'+row.name))!==JSON.stringify(manifest.schema_objects)) fail('D1_SCHEMA_MISMATCH');
  const counts=d1Query(info,state,'SELECT '+TABLES.map(name=>'(SELECT count(*) FROM '+name+') AS '+name).join(','))[0];
  if (JSON.stringify(counts)!==JSON.stringify(manifest.table_counts)) fail('D1_COUNT_MISMATCH');
  const invariant=d1Query(info,state,"SELECT "+
    "(SELECT count(*) FROM app_session s JOIN app_user u ON u.id=s.user_id WHERE u.status!='ACTIVE' AND s.revoked_at IS NULL) AS blocked_sessions,"+
    "(SELECT count(*) FROM user_role r JOIN user_permission_grant g ON g.user_id=r.user_id WHERE r.user_id='00000000-0000-4000-8000-000000000102' AND r.role_code='SECTION_COORDINATOR' AND r.section_id='00000000-0000-4000-8000-000000000002' AND r.revoked_at IS NULL AND g.permission_code='participants.profile.read' AND g.revoked_at IS NULL) AS troop_grants,"+
    "(SELECT count(*) FROM user_permission_grant WHERE user_id='00000000-0000-4000-8000-000000000107' AND permission_code='participants.profile.read' AND revoked_at IS NULL) AS tech_profile_grants,"+
    "(SELECT count(*) FROM incident_audit_hold WHERE released_at IS NULL) AS active_holds,"+
    "(SELECT count(*) FROM incident_audit_hold WHERE released_at IS NULL AND audit_event_id IN (SELECT id FROM audit_event)) AS linked_holds")[0];
  if (!invariant || invariant.blocked_sessions!==0 || invariant.troop_grants!==1 ||
      invariant.tech_profile_grants!==0 || invariant.active_holds!==invariant.linked_holds) fail('D1_AUTH_INVARIANT_FAILED');
  const business=d1Query(info,state,"SELECT "+
    "(SELECT count(*) FROM activity_registration r LEFT JOIN activity a ON a.id=r.activity_id WHERE a.id IS NULL) AS orphan_registration,"+
    "(SELECT count(*) FROM payment_evidence e LEFT JOIN activity_registration r ON r.id=e.registration_id WHERE r.id IS NULL) AS orphan_evidence,"+
    "(SELECT count(*) FROM notification_outbox o LEFT JOIN activity_registration r ON r.id=o.registration_id WHERE r.id IS NULL) AS orphan_outbox,"+
    "(SELECT count(*) FROM delegated_permission WHERE ratification_status='REVOKED' AND revoked_at IS NULL) AS bad_revocation,"+
    "(SELECT count(*) FROM annual_fee_allocation a JOIN annual_fee_payment p ON p.id=a.payment_id JOIN annual_fee_obligation o ON o.id=a.obligation_id WHERE p.round_id!=o.round_id) AS cross_round_fee,"+
    "(SELECT count(*) FROM annual_fee_payment p WHERE (SELECT COALESCE(SUM(a.amount_cents),0) FROM annual_fee_allocation a WHERE a.payment_id=p.id)>COALESCE(p.verified_amount_cents,0)) AS overallocated_fee,"+
    "(SELECT count(*) FROM annual_fee_obligation WHERE amount_due_cents<1) AS bad_fee_due,"+
    "(SELECT count(*) FROM annual_fee_installment_plan p JOIN annual_fee_obligation o ON o.id=p.obligation_id WHERE p.status='ACTIVE' AND ((SELECT count(*) FROM annual_fee_installment_part i WHERE i.plan_id=p.id)<2 OR (SELECT count(*) FROM annual_fee_installment_part i WHERE i.plan_id=p.id)!=(SELECT max(ordinal) FROM annual_fee_installment_part i WHERE i.plan_id=p.id) OR (SELECT sum(planned_cents) FROM annual_fee_installment_part i WHERE i.plan_id=p.id)!=o.amount_due_cents)) AS bad_fee_installment,"+
    "(SELECT count(*) FROM annual_fee_obligation o WHERE o.discount_cents!=CASE WHEN o.sibling_ordinal>=3 THEN CAST(o.base_cents/2 AS INTEGER) ELSE 0 END OR NOT EXISTS(SELECT 1 FROM annual_fee_family_member m WHERE m.round_id=o.round_id AND m.participant_id=o.participant_id AND m.group_id=o.family_group_id AND m.sibling_ordinal=o.sibling_ordinal) AND o.family_group_id IS NOT NULL OR o.family_group_id IS NULL AND (o.sibling_ordinal!=1 OR EXISTS(SELECT 1 FROM annual_fee_family_member m WHERE m.round_id=o.round_id AND m.participant_id=o.participant_id))) AS bad_fee_family,"+
    "(SELECT count(*) FROM annual_fee_family_correction_gate) AS open_family_gate,"+
    "(SELECT count(*) FROM participant p WHERE p.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM participant_section_membership m WHERE m.participant_id=p.id AND m.ended_at IS NULL AND m.section_id=p.current_section_id)) AS membership_projection_gap,"+
    "(SELECT count(*) FROM participant_section_membership m JOIN participant p ON p.id=m.participant_id WHERE m.ended_at IS NULL AND (p.status!='ACTIVE' OR m.section_id!=p.current_section_id)) AS membership_projection_mismatch,"+
    "(SELECT count(*) FROM annual_fee_allocation a JOIN annual_fee_payment p ON p.id=a.payment_id WHERE p.review_status!='VERIFIED' OR p.reviewed_by IS NULL OR p.reviewed_at IS NULL) AS unreviewed_fee_allocation,"+
    "(SELECT count(*) FROM annual_fee_payment_balance b WHERE b.unallocated_cents>0 AND b.review_status='VERIFIED' AND NOT EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=b.id AND i.code='ALLOCATION_UNCLEAR' AND i.status='OPEN')) AS unexplained_fee_balance,"+
    // 3.5G.1 financial foundation invariants (TREASURY.md §4).
    "(SELECT count(*) FROM finance_movement_allocation_balance WHERE unallocated_cents<0) AS overallocated_movement,"+
    "(SELECT count(*) FROM finance_allocation a JOIN finance_movement m ON m.id=a.movement_id WHERE a.set_version>m.allocation_version) AS future_allocation_set,"+
    "(SELECT count(*) FROM finance_allocation_current a JOIN finance_movement m ON m.id=a.movement_id JOIN finance_movement p ON p.id=a.paired_movement_id WHERE a.kind='INTERNAL_TRANSFER' AND (p.position_id=m.position_id OR p.amount_cents!=-m.amount_cents OR a.amount_cents!=abs(m.amount_cents) OR EXISTS(SELECT 1 FROM finance_allocation_current b WHERE b.movement_id=p.id AND b.kind='INTERNAL_TRANSFER' AND b.paired_movement_id!=m.id))) AS bad_internal_transfer,"+
    "(SELECT count(*) FROM finance_expense e WHERE e.status='RECOGNISED' AND COALESCE((SELECT sum(l.amount_cents) FROM finance_expense_line l WHERE l.expense_id=e.id AND l.lines_version=e.lines_version),0)!=e.total_cents) AS unbalanced_expense,"+
    "(SELECT count(*) FROM finance_expense e WHERE COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.expense_id=e.id AND a.kind='EXPENSE_SETTLEMENT'),0)>CASE WHEN e.status='RECOGNISED' THEN e.total_cents ELSE 0 END) AS oversettled_expense,"+
    "(SELECT count(*) FROM finance_budget_line c JOIN finance_budget_line p ON p.id=c.parent_id WHERE p.round_id!=c.round_id OR p.nature!=c.nature OR p.planned_cents IS NOT NULL) AS bad_budget_tree,"+
    "(SELECT count(*) FROM (SELECT round_id,position_id FROM finance_opening_balance GROUP BY round_id,position_id HAVING count(*)!=max(revision))) AS gapped_opening_balance,"+
    "(SELECT count(*) FROM finance_round r WHERE r.status='CLOSED' AND NOT EXISTS(SELECT 1 FROM finance_round_close c WHERE c.round_id=r.id)) AS closed_without_snapshot,"+
    "(SELECT count(*) FROM finance_round WHERE status='OPEN')>1 AS several_open_rounds")[0];
  if (Object.values(business).some(value=>value!==0)) fail('D1_BUSINESS_INVARIANT_FAILED');
}
export function restoreBackup(backupPath,destination,configPath=resolve(root,'wrangler.toml')) {
  const {manifest,info}=verifyBackup(backupPath,configPath);
  newTarget(destination);
  assertUnversionedOutput(destination,'restore');
  if (destination===resolve(info.folder,'.wrangler','state') || destination.startsWith(resolve(backupPath)+'/')) fail('UNSAFE_RESTORE_TARGET');
  const temp=mkdtempSync(join(dirname(destination),'.parpallo-restore-partial-'));
  try {
    chmodSync(temp,0o700);
    run(wrangler,['d1','execute',DB_NAME,'--local','--persist-to',temp,'--config',info.path,
      '--file',join(backupPath,'dump.sql'),'--yes'],{cwd:info.folder,stdio:'ignore'});
    verifyRestoredState(info,temp,manifest);
    renameSync(temp,destination);
    return manifest;
  } catch(error) {rmSync(temp,{recursive:true,force:true});throw error;}
}
function parseOptions(items) {
  const values={};
  if(items.length%2) fail('INVALID_ARGUMENTS');
  for(let i=0;i<items.length;i+=2) {
    const key=items[i];
    if (!['--output','--backup','--dest-state','--config'].includes(key) || !items[i+1] || key in values) fail('INVALID_ARGUMENTS');
    values[key]=items[i+1];
  }
  return values;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const action=process.argv[2],options=parseOptions(process.argv.slice(3));
    const config=options['--config']??resolve(root,'wrangler.toml');
    if(action==='backup' && options['--output'] && !options['--backup'] && !options['--dest-state']) {
      const manifest=createBackup(options['--output'],config);
      process.stdout.write('BACKUP_CREATED '+manifest.backup_id+'\n');
    } else if(action==='verify' && options['--backup'] && !options['--output'] && !options['--dest-state']) {
      const {manifest}=verifyBackup(options['--backup'],config);
      process.stdout.write('BACKUP_VERIFIED '+manifest.backup_id+'\n');
    } else if(action==='restore' && options['--backup'] && options['--dest-state'] && !options['--output']) {
      process.stdout.write('RESTORE_STARTED\n');
      const manifest=restoreBackup(options['--backup'],options['--dest-state'],config);
      process.stdout.write('RESTORE_SUCCEEDED '+manifest.backup_id+'\n');
    } else fail('INVALID_ARGUMENTS');
  } catch(error) {
    if (process.argv[2]==='restore') process.stderr.write('RESTORE_FAILED\n');
    process.stderr.write('RECOVERY_FAILED '+(/^[A-Z_]+$/.test(error.message)?error.message:'UNEXPECTED_ERROR')+'\n');
    process.exitCode=1;
  }
}
