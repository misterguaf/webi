-- Personal tasks are owner-only. Named recipients do not imply section visibility.
INSERT INTO permission(code) VALUES ('tasks.section.read'),('tasks.section.manage'),('tasks.group.read'),('tasks.group.manage');
INSERT INTO role_permission(role_code,permission_code) VALUES
('GROUP_COORDINATOR','tasks.section.read'),('GROUP_COORDINATOR','tasks.section.manage'),
('GROUP_COORDINATOR','tasks.group.read'),('GROUP_COORDINATOR','tasks.group.manage'),
('SECTION_COORDINATOR','tasks.section.read'),('SECTION_COORDINATOR','tasks.section.manage'),('SECTION_COORDINATOR','tasks.group.read'),
('SECTION_DELEGATE','tasks.section.read'),('SECTION_DELEGATE','tasks.section.manage'),('SECTION_DELEGATE','tasks.group.read'),
('TREASURY','tasks.group.read'),('SECRETARY','tasks.group.read');
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,expires_at,granted_by,justification,source_role_id,section_id)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
ur.user_id,rp.permission_code,ur.valid_from,ur.expires_at,NULL,
'Task calendar capability for current role',ur.id,ur.section_id
FROM user_role ur JOIN role_permission rp ON rp.role_code=ur.role_code
WHERE rp.permission_code LIKE 'tasks.%' AND ur.revoked_at IS NULL
AND NOT (ur.role_code='SECTION_DELEGATE' AND rp.permission_code='tasks.section.manage');
CREATE TABLE task (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 description TEXT CHECK(description IS NULL OR length(description)<=2000),
 visibility TEXT NOT NULL CHECK(visibility IN ('PERSONAL','NAMED','SECTION','GROUP')),
 section_id TEXT REFERENCES section(id) ON DELETE RESTRICT,
 due_date TEXT CHECK(due_date IS NULL OR (date(due_date)=due_date AND length(due_date)=10)),
 due_time TEXT CHECK(due_time IS NULL OR (length(due_time)=5 AND due_time GLOB '[0-2][0-9]:[0-5][0-9]' AND due_time<'24:00')),
 recurrence TEXT CHECK(recurrence IS NULL OR recurrence IN ('DAILY','WEEKLY','MONTHLY')),
 recurrence_day INTEGER CHECK(recurrence_day IS NULL OR recurrence_day BETWEEN 1 AND 31),
 previous_id TEXT UNIQUE REFERENCES task(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED')),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 completed_at INTEGER,completed_by TEXT REFERENCES app_user(id) ON DELETE RESTRICT,
 archived_at INTEGER,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 UNIQUE(owner_id,request_key),
 CHECK((visibility='SECTION')=(section_id IS NOT NULL)),
 CHECK(due_time IS NULL OR due_date IS NOT NULL),
 CHECK(recurrence IS NULL OR due_date IS NOT NULL),
 CHECK((status='COMPLETED')=(completed_at IS NOT NULL AND completed_by IS NOT NULL))
);
CREATE TABLE task_member(
 task_id TEXT NOT NULL REFERENCES task(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
 responsible INTEGER NOT NULL DEFAULT 1 CHECK(responsible IN (0,1)),
 PRIMARY KEY(task_id,user_id)
);
CREATE INDEX task_due_idx ON task(archived_at,status,due_date,id);
CREATE INDEX task_owner_idx ON task(owner_id,archived_at);
CREATE INDEX task_member_user_idx ON task_member(user_id,task_id);
CREATE TRIGGER task_immutable_identity BEFORE UPDATE ON task
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.created_at IS NOT OLD.created_at
 OR NEW.previous_id IS NOT OLD.previous_id OR NEW.request_key IS NOT OLD.request_key
 OR NEW.version!=OLD.version+1
BEGIN SELECT RAISE(ABORT,'invalid_task_revision'); END;
CREATE TRIGGER task_no_delete BEFORE DELETE ON task
BEGIN SELECT RAISE(ABORT,'task_immutable'); END;
