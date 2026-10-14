import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarDays,navigateDate,activityOn} from '../gestio/public/views/task-calendar-model.js';
test('API activity timestamps cover every day of a future multi-day activity in Madrid',()=>{
 const activity={starts_at:Date.parse('2026-12-31T23:30:00Z'),ends_at:Date.parse('2027-01-03T08:00:00Z')};
 assert.equal(activityOn(activity,'2026-12-31'),false,'UTC start belongs to January 1 in Madrid');
 for(const day of ['2027-01-01','2027-01-02','2027-01-03'])assert.equal(activityOn(activity,day),true);
 assert.equal(activityOn(activity,'2027-01-04'),false);
 for(const view of ['month','week','day']){
  const visible=calendarDays('2027-01-02',view).filter(day=>activityOn(activity,day));
  assert.ok(visible.includes('2027-01-02'),view+' retains the activity');
 }
});
test('calendar activity day boundaries remain correct across summer time and the clock change',()=>{
 const summer={starts_at:Date.parse('2026-07-01T22:30:00Z'),ends_at:Date.parse('2026-07-02T21:59:00Z')};
 assert.equal(activityOn(summer,'2026-07-01'),false);assert.equal(activityOn(summer,'2026-07-02'),true);
 assert.equal(activityOn(summer,'2026-07-03'),false);
 const change={starts_at:Date.parse('2026-10-24T22:30:00Z'),ends_at:Date.parse('2026-10-25T23:15:00Z')};
 assert.equal(activityOn(change,'2026-10-25'),true);assert.equal(activityOn(change,'2026-10-26'),true);
});
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
