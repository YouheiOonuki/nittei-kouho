// 計算ロジックのテスト: node --test tests/*.test.js
// （.github/workflows/test.yml で push・PR のたびに自動実行される）
// 受け入れテストは企画書（yorozu-plans 04_日程候補.md の 5 章）の項目
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');
const K = require('../constants.js');

const WEEKDAYS = [false, true, true, true, true, true, false];   // 月〜金
const HOL = { '2026-10-12': 'スポーツの日', '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日' };
function opts(over) {
  return Object.assign({ start: '2026-10-05', end: '2026-11-01', weekdays: WEEKDAYS, holidays: HOL, skipHolidays: true, ng: [] }, over);
}

test('日付の基本', () => {
  assert.equal(C.dow('2026-10-07'), 3);                  // 水曜
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.weekOf('2026-10-11'), '2026-10-05');    // 日曜はその週の月曜に属する
  assert.equal(C.diffDays('2026-10-05', '2026-11-01'), 27);
  assert.ok(C.isDate('2028-02-29'));
  assert.ok(!C.isDate('2026-02-29'));
});

test('受け入れ: 祝日・土日・NG 日が候補に入らない', () => {
  const days = C.eligibleDays(opts({ ng: ['2026-10-07', '2026-10-20'] }));
  assert.ok(!days.includes('2026-10-12'), '祝日');
  assert.ok(!days.includes('2026-10-10') && !days.includes('2026-10-11'), '土日');
  assert.ok(!days.includes('2026-10-07') && !days.includes('2026-10-20'), 'NG 日');
  assert.equal(days.length, 20 - 1 - 2);
  const picked = C.pick(days, 6, 'spread');
  for (const d of picked) assert.ok(days.includes(d));
});

test('祝日を外さない指定なら、祝日も候補にできる', () => {
  assert.ok(C.eligibleDays(opts({ skipHolidays: false })).includes('2026-10-12'));
});

test('受け入れ: 条件に合う日が候補の数より少ないときは、ある分だけ出す', () => {
  const days = C.eligibleDays(opts({ end: '2026-10-07' }));
  assert.deepEqual(C.pick(days, 6, 'spread'), ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.equal(C.pick(days, 6, 'early').length, 3);
});

test('受け入れ: ばらけさせるモードで、4 週間・6 候補なら同じ週は 2 日まで', () => {
  const days = C.eligibleDays(opts());
  const picked = C.pick(days, 6, 'spread');
  assert.equal(picked.length, 6);
  assert.ok(C.maxPerWeek(picked) <= 2, JSON.stringify(picked));
  assert.deepEqual(picked, picked.slice().sort());
  // 4 週すべてに候補がある
  assert.equal(new Set(picked.map(C.weekOf)).size, 4);
});

test('ばらけさせる: いろいろな期間・数で、週の偏りは切り上げ（数 ÷ 週）まで、重複なし', () => {
  for (const [end, n] of [['2026-10-18', 3], ['2026-11-01', 8], ['2026-11-29', 5], ['2026-12-27', 12], ['2026-10-09', 5]]) {
    const days = C.eligibleDays(opts({ end }));
    const picked = C.pick(days, n, 'spread');
    const weeks = new Set(days.map(C.weekOf)).size;
    assert.equal(new Set(picked).size, Math.min(n, days.length), end + ' ' + n);
    assert.ok(C.maxPerWeek(picked) <= Math.ceil(n / weeks), end + ' ' + n + ' ' + JSON.stringify(picked));
  }
});

test('ばらけさせる: 週によって曜日がずれる（同じ曜日ばかりにならない）', () => {
  const picked = C.pick(C.eligibleDays(opts({ end: '2026-11-29' })), 8, 'spread');
  assert.ok(new Set(picked.map(C.dow)).size >= 3, JSON.stringify(picked));
});

test('早い順', () => {
  assert.deepEqual(C.pick(C.eligibleDays(opts()), 3, 'early'), ['2026-10-05', '2026-10-06', '2026-10-07']);
});

test('受け入れ: 2 段階モードで、1 段目でチェックした日だけが 2 段目に引き継がれる', () => {
  const s1 = ['2026-10-06', '2026-10-09', '2026-10-15', '2026-10-21'];
  assert.deepEqual(C.carryOver(s1, ['2026-10-21', '2026-10-09', '2026-10-30']), ['2026-10-09', '2026-10-21']);
  assert.deepEqual(C.carryOver(s1, []), []);
});

test('受け入れ: 対応している年の範囲外の期間は「祝日データなし」の年を返す', () => {
  assert.deepEqual(C.missingHolidayYears('2026-12-01', '2027-01-31', { from: 2025, to: 2027 }), []);
  assert.deepEqual(C.missingHolidayYears('2027-12-01', '2028-01-31', { from: 2025, to: 2027 }), [2028]);
});

test('日付と時間帯の書式', () => {
  assert.equal(C.formatDate('2026-10-07', 'slash'), '10/7（水）');
  assert.equal(C.formatDate('2026-10-07', 'kanji'), '10月7日（水）');
  assert.equal(C.formatTime({ kind: 'night' }), ' 19:00〜');
  assert.equal(C.formatTime({ kind: 'lunch' }, true), ' 12時〜');
  assert.equal(C.formatTime({ kind: 'custom', from: '18:30', to: '20:30' }), ' 18:30〜20:30');
  assert.equal(C.formatTime({ kind: 'custom', from: '18:30', to: '' }, true), ' 18時30分〜');
  assert.equal(C.formatTime({ kind: 'none' }), '');
});

test('文面: Forms 用は 1 行に 1 候補、メールは期限と断りやすい一文、LINE は絵文字なし', () => {
  const o = { dates: ['2026-10-07', '2026-10-15'], dateStyle: 'slash', time: { kind: 'night' }, title: '懇親会', deadline: '2026-10-02' };
  assert.equal(C.buildText('forms', o), '10/7（水） 19:00〜\n10/15（木） 19:00〜');
  const mail = C.buildText('mail', o);
  assert.match(mail, /懇親会の日程/);
  assert.match(mail, /・10\/7（水） 19:00〜/);
  assert.match(mail, /10\/2（金）までに/);
  assert.match(mail, /どの日も難しい場合/);
  const ln = C.buildText('line', o);
  assert.match(ln, /^懇親会の候補日です。都合のよい日を教えてください（10\/2（金）まで）。/);
  assert.match(ln, /10\/7（水） 19時〜/);
  assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(ln), '絵文字なし');
  assert.match(C.buildText('mail', Object.assign({}, o, { deadline: '', title: '' })), /打ち合わせの日程[\s\S]*お手数ですが、ご回答/);
});

test('.ics: 時間帯あり（日本時間・2 時間）と終日、CRLF、特殊文字のエスケープ', () => {
  const now = new Date(Date.UTC(2026, 8, 23, 12, 0, 0));
  const a = C.toICS(['2026-10-07'], { title: '会議, 定例; A', time: { kind: 'night' } }, now);
  assert.match(a, /^BEGIN:VCALENDAR\r\n/);
  assert.match(a, /DTSTART;TZID=Asia\/Tokyo:20261007T190000\r\nDTEND;TZID=Asia\/Tokyo:20261007T210000/);
  assert.match(a, /SUMMARY:【仮】会議\\, 定例\\; A（候補日）/);
  assert.match(a, /DTSTAMP:20260923T120000Z/);
  assert.ok(a.endsWith('END:VCALENDAR\r\n'));
  const b = C.toICS(['2026-12-31'], { title: '', time: { kind: 'none' } }, now);
  assert.match(b, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  const c = C.toICS(['2026-10-07'], { time: { kind: 'custom', from: '22:00', to: '01:00' } }, now);
  assert.match(c, /DTEND;TZID=Asia\/Tokyo:20261008T010000/);
});

test('constants: 祝日データの形・対応年・出典と確認日', () => {
  assert.match(K.CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(K.SOURCE.url, /^https:\/\//);
  const years = new Set();
  for (const [d, name] of Object.entries(K.HOLIDAYS)) {
    assert.ok(C.isDate(d), d);
    assert.ok(name.length > 0, d);
    years.add(+d.slice(0, 4));
  }
  for (let y = K.HOLIDAY_YEARS.from; y <= K.HOLIDAY_YEARS.to; y++) assert.ok(years.has(y), '祝日データに ' + y + ' 年がある');
  // どの年にも元日がある
  for (let y = K.HOLIDAY_YEARS.from; y <= K.HOLIDAY_YEARS.to; y++) assert.equal(K.HOLIDAYS[y + '-01-01'], '元日');
});
