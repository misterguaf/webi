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
  'activity_registration','payment_evidence','notification_outbox','notification_capture','d1_migrations'
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
  'trigger:activity_transport_locked_delete','trigger:notification_delivery_transition'
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
function checkFixtures(database) {
  const users=sqliteQuery(database,'SELECT id,display_name FROM app_user ORDER BY id');
  const people=sqliteQuery(database,'SELECT id,display_name FROM participant ORDER BY id');
  const identities=sqliteQuery(database,'SELECT issuer,verified_email FROM auth_identity');
  if (users.length!==7 || people.length<5 || identities.length!==7) fail('SYNTHETIC_FIXTURE_REQUIRED');
  if (users.some((row,index)=>row.id!=='00000000-0000-4000-8000-'+String(101+index).padStart(12,'0') ||
      !row.display_name.includes('(fictici')) ||
      people.some((row,index)=>!row.display_name.includes('(ficticio)') ||
        (index<5 && row.id!=='00000000-0000-4000-8000-'+String(501+index).padStart(12,'0'))) ||
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
      "(SELECT count(*) FROM delegated_permission WHERE authorization_reference NOT LIKE 'DEMO-%') AS external_delegation")[0];
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
    "(SELECT count(*) FROM delegated_permission WHERE ratification_status='REVOKED' AND revoked_at IS NULL) AS bad_revocation")[0];
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
