import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarDays,navigateDate} from '../gestio/public/views/task-calendar-model.js';
test('calendar periods start Monday and traverse month boundaries without local timezone drift',()=>{
 assert.deepEqual(calendarDays('2026-10-13','week'),['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18']);
 assert.equal(calendarDays('2026-10-13','month').length,42);
 assert.equal(navigateDate('2026-12-31','month',1),'2027-01-01');
});
test('calendar is first on Inici and clears private content with the screen session',()=>{
 const html=readFileSync(new URL('../gestio/public/index.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('id="taskCalendar"')<html.indexOf('id="dashboardAttentionPanel"'));
 const source=readFileSync(new URL('../gestio/public/views/task-calendar.js',import.meta.url),'utf8');
 assert.match(source,/unload\(\).*epoch\+\+/);
 assert.match(source,/fetchAllPages\(call,'\/api\/activities'/);
 const css=readFileSync(new URL('../gestio/public/task-calendar.css',import.meta.url),'utf8');
 assert.match(css,/@media\(max-width:700px\)/);
});
