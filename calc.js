// ===========================
// 日程調整 候補日ジェネレーター — 計算ロジック（画面から切り離した純粋関数）
// 日付はすべて 'YYYY-MM-DD' の文字列で扱う（端末のタイムゾーンに左右されないように、内部は UTC で数える）
// ブラウザでは window.Calc、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  var DOW = ['日', '月', '火', '水', '木', '金', '土'];
  var DAY_MS = 86400000;

  function toTime(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromTime(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(d, n) { return fromTime(toTime(d) + n * DAY_MS); }
  function dow(d) { return new Date(toTime(d)).getUTCDay(); }
  function diffDays(a, b) { return Math.round((toTime(b) - toTime(a)) / DAY_MS); }
  function isDate(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && fromTime(toTime(d)) === d; }
  /** その日を含む週の月曜日（週は月曜はじまり） */
  function weekOf(d) { return addDays(d, -((dow(d) + 6) % 7)); }

  /** 期間内の日付の一覧（両端を含む） */
  function range(start, end) {
    var out = [];
    for (var d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }

  /**
   * 条件に合う日の一覧
   * opts = { start, end, weekdays: [日..土の 7 個の true/false], holidays: { 'YYYY-MM-DD': '名前' },
   *          skipHolidays: true, ng: ['YYYY-MM-DD', ...] }
   */
  function eligibleDays(opts) {
    var ng = {};
    (opts.ng || []).forEach(function (d) { ng[d] = true; });
    var hol = opts.holidays || {};
    return range(opts.start, opts.end).filter(function (d) {
      if (!opts.weekdays[dow(d)]) return false;
      if (opts.skipHolidays && hol[d]) return false;
      return !ng[d];
    });
  }

  /** 期間のうち祝日データが無い年（対応範囲 years = { from, to } の外） */
  function missingHolidayYears(start, end, years) {
    var out = [];
    for (var y = +start.slice(0, 4); y <= +end.slice(0, 4); y++) if (y < years.from || y > years.to) out.push(y);
    return out;
  }

  /**
   * 候補を count 個選ぶ
   * mode: 'spread'（期間全体にばらけさせ、同じ週に固まらないようにする）| 'early'（早い順）
   */
  function pick(days, count, mode) {
    count = Math.max(0, Math.min(count | 0, days.length));
    if (mode === 'early' || count === 0) return days.slice(0, count);

    // 週ごとに分ける
    var weeks = [], byWeek = {};
    days.forEach(function (d) {
      var w = weekOf(d);
      if (!byWeek[w]) { byWeek[w] = []; weeks.push(w); }
      byWeek[w].push(d);
    });
    var W = weeks.length;

    // 週ごとの個数を決める。まず均等（floor）、余りは期間全体に等間隔に配る。空きの無い週のぶんは、空きのある週へ回す
    var quota = weeks.map(function () { return 0; });
    if (count <= W) {
      for (var i = 0; i < count; i++) quota[Math.floor((i + 0.5) * W / count)] += 1;
    } else {
      var base = Math.floor(count / W), extra = count % W;
      for (var j = 0; j < W; j++) quota[j] = base;
      for (var e = 0; e < extra; e++) quota[Math.floor((e + 0.5) * W / extra)] += 1;
    }
    var over = 0;
    weeks.forEach(function (w, k) {
      var cap = byWeek[w].length;
      if (quota[k] > cap) { over += quota[k] - cap; quota[k] = cap; }
    });
    // 余った分は、いちばん少ない週（同じなら空きの多い週）から足す
    while (over > 0) {
      var best = -1;
      for (var k2 = 0; k2 < W; k2++) {
        if (quota[k2] >= byWeek[weeks[k2]].length) continue;
        if (best < 0 || quota[k2] < quota[best]) best = k2;
      }
      if (best < 0) break;
      quota[best] += 1; over -= 1;
    }

    // 週の中では等間隔に選ぶ。週ごとに開始位置をずらして、同じ曜日ばかりにならないようにする
    var out = [];
    weeks.forEach(function (w, k) {
      var list = byWeek[w], m = list.length, q = quota[k];
      if (!q) return;
      var chosen = {};
      for (var n = 0; n < q; n++) {
        var idx = (Math.floor(n * m / q) + (q < m ? k % Math.ceil(m / q) : 0)) % m;
        while (chosen[idx]) idx = (idx + 1) % m;
        chosen[idx] = true;
      }
      Object.keys(chosen).map(Number).sort(function (a, b) { return a - b; }).forEach(function (x) { out.push(list[x]); });
    });
    return out;
  }

  /** 同じ週（月曜はじまり）に入っている候補の最大数 */
  function maxPerWeek(days) {
    var c = {}, max = 0;
    days.forEach(function (d) { var w = weekOf(d); c[w] = (c[w] || 0) + 1; if (c[w] > max) max = c[w]; });
    return max;
  }

  /** 2 段階調整: 1 段目の候補のうち、チェックした日だけを 2 段目に引き継ぐ（日付順） */
  function carryOver(stage1, checked) {
    var set = {};
    (checked || []).forEach(function (d) { set[d] = true; });
    return stage1.filter(function (d) { return set[d]; }).sort();
  }

  // --- 文面 ---

  /** 日付の書式: 'slash' → 10/7（火）、'kanji' → 10月7日（火） */
  function formatDate(d, style) {
    var m = +d.slice(5, 7), day = +d.slice(8, 10), w = DOW[dow(d)];
    return style === 'kanji' ? m + '月' + day + '日（' + w + '）' : m + '/' + day + '（' + w + '）';
  }

  /** 時間帯の表示: { kind: 'none' | 'lunch' | 'night' | 'custom', from: 'HH:MM', to: 'HH:MM' } */
  function formatTime(time, short) {
    if (!time || time.kind === 'none') return '';
    var from = time.kind === 'lunch' ? '12:00' : time.kind === 'night' ? '19:00' : (time.from || '');
    var to = time.kind === 'custom' ? (time.to || '') : '';
    if (!from) return '';
    if (short) {
      var h = function (t) { var p = t.split(':'); return +p[0] + '時' + (p[1] !== '00' ? +p[1] + '分' : ''); };
      return ' ' + h(from) + '〜' + (to ? h(to) : '');
    }
    return ' ' + from + '〜' + to;
  }

  function line(d, opts, short) { return formatDate(d, opts.dateStyle) + formatTime(opts.time, short); }

  /**
   * 貼り付け用の文面
   * kind: 'forms'（1 行に 1 候補）| 'mail'（あいさつ＋候補＋回答期限）| 'line'（短い版・絵文字なし）
   * opts = { dates, dateStyle, time, title, deadline: 'YYYY-MM-DD' | '' }
   */
  function buildText(kind, opts) {
    var dates = opts.dates || [];
    var title = (opts.title || '').trim() || '打ち合わせ';
    var dl = opts.deadline ? formatDate(opts.deadline, opts.dateStyle) : '';
    if (kind === 'forms') return dates.map(function (d) { return line(d, opts, false); }).join('\n');
    if (kind === 'line') {
      return [title + 'の候補日です。都合のよい日を教えてください' + (dl ? '（' + dl + 'まで）' : '') + '。']
        .concat(dates.map(function (d) { return line(d, opts, true); }))
        .concat(['どの日も難しければ、それだけ教えてもらえれば大丈夫です。']).join('\n');
    }
    return [
      'お疲れさまです。',
      title + 'の日程を調整させてください。',
      '次の候補のうち、ご都合のよい日をすべてお知らせください。',
      '',
      '■候補日',
    ].concat(dates.map(function (d) { return '・' + line(d, opts, false); })).concat([
      '',
      (dl ? dl + 'までに' : 'お手数ですが、') + 'ご回答いただけると助かります。',
      'どの日も難しい場合は、その旨だけお知らせください。改めて候補をお送りします。',
      'よろしくお願いいたします。',
    ]).join('\n');
  }

  // --- .ics（候補日をカレンダーに仮押さえする用） ---

  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); }
  function stamp(d, hhmm) { return d.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00'; }

  /**
   * 時間帯があれば日本時間の予定（終わりの指定が無ければ 2 時間）、無ければ終日の予定
   * now は DTSTAMP 用（テストで固定できるように引数にする）
   */
  function toICS(dates, opts, now) {
    var title = (opts.title || '').trim() || '打ち合わせ';
    var t = opts.time || { kind: 'none' };
    var from = t.kind === 'lunch' ? '12:00' : t.kind === 'night' ? '19:00' : t.kind === 'custom' ? t.from : '';
    var to = t.kind === 'custom' && t.to ? t.to : '';
    var dtstamp = (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//yorozu-craft//nittei-kouho//JA', 'CALSCALE:GREGORIAN',
      'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE'];
    dates.forEach(function (d, i) {
      lines.push('BEGIN:VEVENT', 'UID:' + d.replace(/-/g, '') + '-' + i + '-' + dtstamp + '@nittei-kouho.yorozu-craft.com', 'DTSTAMP:' + dtstamp);
      if (from) {
        var endHHMM = to;
        if (!endHHMM) { var p = from.split(':'); endHHMM = String(Math.min(23, +p[0] + 2)).padStart(2, '0') + ':' + p[1]; }
        var endDay = endHHMM <= from ? addDays(d, 1) : d;   // 日付をまたぐ（例: 22:00〜1:00）
        lines.push('DTSTART;TZID=Asia/Tokyo:' + stamp(d, from), 'DTEND;TZID=Asia/Tokyo:' + stamp(endDay, endHHMM));
      } else {
        lines.push('DTSTART;VALUE=DATE:' + d.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(d, 1).replace(/-/g, ''));
      }
      lines.push('SUMMARY:' + icsEscape('【仮】' + title + '（候補日）'), 'TRANSP:TRANSPARENT', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // --- バックアップファイル（README「ツールを追加するとき」20。決定 D31） ---
  // 形式: { tool, version, exportedAt, data }。data はブラウザに保存しているものと同じ形
  var BACKUP_VERSION = 1;

  /** 書き出すファイル名: <ツール名>-backup-YYYYMMDD.json（日付は端末の時計） */
  function backupFileName(tool, date) {
    var d = date || new Date();
    return tool + '-backup-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
  }

  /** 書き出す中身 */
  function buildBackup(tool, data, date) {
    return { tool: tool, version: BACKUP_VERSION, exportedAt: (date || new Date()).toISOString(), data: data };
  }

  /**
   * 読み込んだファイルの文字列を確かめる。中身の正規化は画面側の既存の関数で行う
   * @returns {{ok: true, data: object} | {ok: false, error: string}} error は画面にそのまま出す文
   */
  function parseBackup(text, tool, requiredKeys) {
    var o;
    try { o = JSON.parse(text); } catch (e) { o = null; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.tool !== 'string') {
      return { ok: false, error: 'ファイルを読み取れませんでした。このツールの「ファイルに書き出す」で作った .json ファイルを選んでください。' };
    }
    if (o.tool !== tool) {
      return { ok: false, error: 'ほかのツール（' + o.tool.slice(0, 40) + '）のファイルです。このツールで書き出したファイルを選んでください。' };
    }
    if (o.version !== BACKUP_VERSION) {
      return { ok: false, error: typeof o.version === 'number' && o.version > BACKUP_VERSION
        ? '新しい版のツールで書き出したファイルのため読み込めません。ページを再読み込みしてから、もう一度お試しください。'
        : 'ファイルの形式が正しくないため読み込めません。' };
    }
    var data = o.data;
    var missing = !data || typeof data !== 'object' || Array.isArray(data) ||
      (requiredKeys || []).some(function (k) { return data[k] === undefined || data[k] === null; });
    if (missing) return { ok: false, error: 'ファイルの中身が足りないため読み込めません。' };
    return { ok: true, data: data };
  }

  var Calc = {
    DOW: DOW, addDays: addDays, dow: dow, diffDays: diffDays, isDate: isDate, weekOf: weekOf, range: range,
    eligibleDays: eligibleDays, missingHolidayYears: missingHolidayYears, pick: pick, maxPerWeek: maxPerWeek,
    carryOver: carryOver, formatDate: formatDate, formatTime: formatTime, buildText: buildText, toICS: toICS,
    backupFileName: backupFileName, buildBackup: buildBackup, parseBackup: parseBackup,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(this);
