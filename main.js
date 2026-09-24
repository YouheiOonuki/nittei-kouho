// ===========================
// 日程調整 候補日ジェネレーター — 画面の制御
// 計算は calc.js（純粋関数）、祝日データと出典は constants.js に置く
// ===========================
(function () {
  'use strict';

  var Calc = window.Calc;
  var K = window.Constants;

  // --- ブラウザへの保存（README「ツールを追加するとき」12） ---
  // キーは必ず "nittei-kouho_" で始める。全ツールが同じオリジンで localStorage を共有しているため
  var KEY_PREFIX = 'nittei-kouho_';
  var store = {
    get: function (name, fallback) {
      try {
        var v = localStorage.getItem(KEY_PREFIX + name);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }   // 保存できない環境（プライベートモードなど）でも動くように
    },
    set: function (name, value) {
      try { localStorage.setItem(KEY_PREFIX + name, JSON.stringify(value)); } catch (e) { /* 保存できなくても続ける */ }
    },
  };

  // --- 共有 URL（README「ツールを追加するとき」11） ---
  // 条件は "#" 以降に入れる（? クエリはサーバーとアクセス解析に届くので使わない）
  function toShareHash(state) {
    return '#s=' + encodeURIComponent(JSON.stringify(state));
  }
  function fromShareHash(hash) {
    var m = /^#s=(.+)$/.exec(hash || '');
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
  }

  // --- 状態 ---
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function defaults() {
    var t = today();
    var start = Calc.addDays(t, 7 - ((Calc.dow(t) + 6) % 7));   // 来週の月曜
    return {
      title: '', start: start, end: Calc.addDays(start, 27),
      weekdays: [false, true, true, true, true, true, false], skipHolidays: true,
      time: { kind: 'night', from: '19:00', to: '' }, count: 6, mode: 'spread',
      ng: [], added: [], removed: [],
      twoStage: false, checked: [], stage: 1, title2: '',
      kind: 'mail', dateStyle: 'slash', deadline: '',
    };
  }
  function normalize(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    Object.keys(d).forEach(function (k) { if (s[k] !== undefined && s[k] !== null) d[k] = s[k]; });
    ['ng', 'added', 'removed', 'checked'].forEach(function (k) {
      d[k] = Array.isArray(d[k]) ? d[k].filter(Calc.isDate).slice(0, 400) : [];
    });
    if (!Array.isArray(d.weekdays) || d.weekdays.length !== 7) d.weekdays = defaults().weekdays;
    d.weekdays = d.weekdays.map(Boolean);
    if (!Calc.isDate(d.start)) d.start = defaults().start;
    if (!Calc.isDate(d.end)) d.end = Calc.addDays(d.start, 27);
    if (d.deadline && !Calc.isDate(d.deadline)) d.deadline = '';
    if (!d.time || typeof d.time !== 'object') d.time = defaults().time;
    d.count = Math.max(1, Math.min(31, parseInt(d.count, 10) || 6));
    d.stage = d.stage === 2 ? 2 : 1;
    return d;
  }

  var shared = fromShareHash(location.hash);
  var state = normalize(shared || store.get('draft', null));
  var fromShare = !!shared;

  function $(id) { return document.getElementById(id); }
  function has(list, d) { return list.indexOf(d) >= 0; }
  function toggle(list, d, on) {
    var i = list.indexOf(d);
    if (on && i < 0) list.push(d);
    if (!on && i >= 0) list.splice(i, 1);
  }
  var MAX_DAYS = 366;

  // --- 候補の計算 ---
  function compute() {
    var r = { warnings: [], days: [], auto: [], final: [], stage2: [] };
    if (state.end < state.start) { r.warnings.push('期間の終わりが始まりより前になっています。'); return r; }
    if (Calc.diffDays(state.start, state.end) >= MAX_DAYS) { r.warnings.push('期間は 1 年以内にしてください。'); return r; }
    var missing = Calc.missingHolidayYears(state.start, state.end, K.HOLIDAY_YEARS);
    if (state.skipHolidays && missing.length) {
      r.warnings.push(missing.join('・') + ' 年は祝日データがありません（対応は ' + K.HOLIDAY_YEARS.from + '〜' + K.HOLIDAY_YEARS.to + ' 年）。その年の祝日は、カレンダーで NG にしてください。');
    }
    r.days = Calc.eligibleDays({ start: state.start, end: state.end, weekdays: state.weekdays, holidays: K.HOLIDAYS, skipHolidays: state.skipHolidays, ng: state.ng });
    r.auto = Calc.pick(r.days, state.count, state.mode);
    var set = {};
    r.auto.forEach(function (d) { if (!has(state.removed, d)) set[d] = true; });
    state.added.forEach(function (d) { if (has(r.days, d)) set[d] = true; });
    r.final = Object.keys(set).sort();
    if (r.days.length < state.count) {
      r.warnings.push('条件に合う日が ' + r.days.length + ' 日しかないため、候補は ' + r.days.length + ' 日です。期間を延ばすか、曜日を増やしてください。');
    }
    r.stage2 = Calc.carryOver(r.final, state.checked);
    return r;
  }

  // --- 入力欄 ---
  var dowBoxes = [];
  (function buildWeekdays() {
    var order = [1, 2, 3, 4, 5, 6, 0];
    order.forEach(function (i) {
      var lb = document.createElement('label');
      lb.className = 'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', function () { state.weekdays[i] = cb.checked; update(); });
      lb.appendChild(cb);
      lb.appendChild(document.createTextNode(Calc.DOW[i]));
      $('weekdays').appendChild(lb);
      dowBoxes[i] = cb;
    });
  })();

  function fillForm() {
    $('title').value = state.title;
    $('start').value = state.start;
    $('end').value = state.end;
    dowBoxes.forEach(function (cb, i) { cb.checked = state.weekdays[i]; });
    $('skip-hol').checked = state.skipHolidays;
    $('time-kind').value = state.time.kind;
    $('time-from').value = state.time.from || '';
    $('time-to').value = state.time.to || '';
    $('time-custom').hidden = state.time.kind !== 'custom';
    $('count').value = state.count;
    document.querySelectorAll('input[name="mode"]').forEach(function (r) { r.checked = r.value === state.mode; });
    $('two-stage').checked = state.twoStage;
    $('title2').value = state.title2;
    $('kind').value = state.kind;
    $('date-style').value = state.dateStyle;
    $('deadline').value = state.deadline;
  }

  function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
  on('title', 'input', function (e) { state.title = e.target.value; update(); });
  on('title2', 'input', function (e) { state.title2 = e.target.value; update(); });
  on('start', 'change', function (e) {
    if (!Calc.isDate(e.target.value)) return;
    // 期間の長さを保ったまま動かす
    var len = Calc.diffDays(state.start, state.end);
    state.start = e.target.value;
    if (state.end < state.start || len >= 0) { state.end = Calc.addDays(state.start, Math.max(0, len)); $('end').value = state.end; }
    update();
  });
  on('end', 'change', function (e) { if (Calc.isDate(e.target.value)) { state.end = e.target.value; update(); } });
  on('skip-hol', 'change', function (e) { state.skipHolidays = e.target.checked; update(); });
  on('time-kind', 'change', function (e) {
    state.time.kind = e.target.value;
    if (state.time.kind === 'custom' && !state.time.from) { state.time.from = '18:30'; $('time-from').value = '18:30'; }
    $('time-custom').hidden = state.time.kind !== 'custom';
    update();
  });
  on('time-from', 'input', function (e) { state.time.from = e.target.value; update(); });
  on('time-to', 'input', function (e) { state.time.to = e.target.value; update(); });
  on('count', 'input', function (e) { var n = parseInt(e.target.value, 10); if (n >= 1 && n <= 31) { state.count = n; update(); } });
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) { state.mode = r.value; update(); } });
  });
  on('two-stage', 'change', function (e) { state.twoStage = e.target.checked; if (!state.twoStage) state.stage = 1; update(); });
  on('kind', 'change', function (e) { state.kind = e.target.value; update(); });
  on('date-style', 'change', function (e) { state.dateStyle = e.target.value; update(); });
  on('deadline', 'change', function (e) { state.deadline = Calc.isDate(e.target.value) ? e.target.value : ''; update(); });
  on('reset-pick', 'click', function () { state.added = []; state.removed = []; update(); });
  on('clear-ng', 'click', function () { state.ng = []; update(); });

  // --- カレンダー ---
  var anchor = null;   // 範囲選択の始まり
  function tapMode() { return document.querySelector('input[name="tap"]:checked').value; }
  on('range', 'change', function () { anchor = null; $('range-msg').textContent = ''; });
  document.querySelectorAll('input[name="tap"]').forEach(function (r) { r.addEventListener('change', function () { anchor = null; $('range-msg').textContent = ''; }); });

  function applyTap(d, res) {
    var mode = tapMode();
    var targets = [d], turnOn;
    if ($('range').checked) {
      if (!anchor) { anchor = d; $('range-msg').textContent = Calc.formatDate(d, 'kanji') + 'から。終わりの日を押してください。'; render(res); return; }
      var a = anchor < d ? anchor : d, b = anchor < d ? d : anchor;
      targets = Calc.range(a, b);
      d = anchor;
      anchor = null;
      $('range-msg').textContent = Calc.formatDate(a, 'kanji') + '〜' + Calc.formatDate(b, 'kanji') + 'をまとめて変えました。';
    }
    if (mode === 'ng') {
      turnOn = !has(state.ng, d);
      targets.forEach(function (x) { toggle(state.ng, x, turnOn); });
    } else {
      turnOn = !has(res.final, d);
      targets.forEach(function (x) {
        if (!has(res.days, x)) return;   // 対象外の日・NG の日は候補にしない
        toggle(state.added, x, turnOn);
        toggle(state.removed, x, !turnOn);
      });
    }
    update();
  }

  function renderCalendar(res) {
    var box = $('calendar');
    box.textContent = '';
    if (!res.days.length && res.warnings.length && state.end < state.start) return;
    var first = state.start.slice(0, 7), last = state.end.slice(0, 7);
    var ym = first;
    while (ym <= last) {
      var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
      var monthStart = ym + '-01';
      var table = document.createElement('table');
      table.className = 'month';
      var cap = document.createElement('caption'); cap.textContent = y + '年' + m + '月'; table.appendChild(cap);
      var thead = document.createElement('tr');
      [1, 2, 3, 4, 5, 6, 0].forEach(function (i) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = Calc.DOW[i]; thead.appendChild(th); });
      table.appendChild(thead);
      var nextMonth = Calc.addDays(monthStart, 32).slice(0, 7) + '-01';
      var monthEnd = Calc.addDays(nextMonth, -1);
      var d = Calc.weekOf(monthStart);
      while (d <= monthEnd) {
        // 期間にかからない週は描かない
        if (Calc.addDays(d, 6) < state.start || d > state.end) { d = Calc.addDays(d, 7); continue; }
        var tr = document.createElement('tr');
        for (var i = 0; i < 7; i++) {
          var td = document.createElement('td');
          if (d.slice(0, 7) === ym) td.appendChild(dayButton(d, res));
          tr.appendChild(td);
          d = Calc.addDays(d, 1);
        }
        table.appendChild(tr);
      }
      box.appendChild(table);
      ym = nextMonth.slice(0, 7);
    }
  }
  function dayButton(d, res) {
    var inRange = d >= state.start && d <= state.end;
    var hol = K.HOLIDAYS[d];
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = +d.slice(8, 10);
    var cls = 'day', label = Calc.formatDate(d, 'kanji'), status;
    if (!inRange) { cls += ' is-out'; b.disabled = true; status = '期間外'; }
    else if (has(state.ng, d)) { cls += ' is-ng'; status = 'NG'; }
    else if (has(res.final, d)) { cls += ' is-pick'; status = '候補'; }
    else if (has(res.days, d)) { cls += ' is-ok'; status = '選べる日'; }
    else { cls += ' is-off'; status = hol && state.skipHolidays ? '祝日' : '対象外の曜日'; }
    if (hol) { cls += ' is-hol'; label += ' ' + hol; b.title = hol; }
    if (anchor === d) cls += ' is-anchor';
    var w = Calc.dow(d);
    if (w === 0 || hol) cls += ' sun'; else if (w === 6) cls += ' sat';
    b.className = cls;
    b.setAttribute('aria-label', label + '：' + status);
    if (inRange) b.addEventListener('click', function () { applyTap(d, lastRes); });
    return b;
  }

  // --- 2 段階 ---
  function renderStage1(res) {
    $('two-box').hidden = !state.twoStage;
    $('stage-tabs').hidden = !state.twoStage;
    var ul = $('stage1-list');
    ul.textContent = '';
    res.final.forEach(function (d) {
      var li = document.createElement('li');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'c-' + d; cb.checked = has(state.checked, d);
      cb.addEventListener('change', function () { toggle(state.checked, d, cb.checked); update(); });
      var lb = document.createElement('label'); lb.htmlFor = cb.id; lb.textContent = Calc.formatDate(d, state.dateStyle) + ' は回答で残った';
      li.appendChild(cb); li.appendChild(lb);
      ul.appendChild(li);
    });
    [$('tab-s1'), $('tab-s2')].forEach(function (t, i) {
      var sel = state.stage === i + 1;
      t.setAttribute('aria-selected', sel);
      t.tabIndex = sel ? 0 : -1;
    });
  }
  [$('tab-s1'), $('tab-s2')].forEach(function (t, i) {
    t.addEventListener('click', function () { state.stage = i + 1; update(); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { state.stage = state.stage === 1 ? 2 : 1; update(); $(state.stage === 1 ? 'tab-s1' : 'tab-s2').focus(); }
    });
  });

  // --- 文面 ---
  function outputDates(res) { return state.twoStage && state.stage === 2 ? res.stage2 : res.final; }
  function outputTitle() { return state.twoStage && state.stage === 2 && state.title2.trim() ? state.title2 : state.title; }
  function renderOutput(res) {
    var dates = outputDates(res);
    var text;
    if (state.twoStage && state.stage === 2 && !dates.length) text = '（1 段目の回答で残った日に、上でチェックを付けてください）';
    else if (!dates.length) text = '（候補がありません。条件を見直してください）';
    else text = Calc.buildText(state.kind, { dates: dates, dateStyle: state.dateStyle, time: state.time, title: outputTitle(), deadline: state.deadline });
    $('output').value = text;
    $('output').rows = Math.min(20, Math.max(6, text.split('\n').length + 1));
    $('copy').disabled = !dates.length;
    $('ics').disabled = !dates.length;
    $('next-links').hidden = !dates.length;
  }

  function copyText(text, okMsg) {
    var done = function () { $('copy-msg').textContent = okMsg; };
    var fallback = function () {
      var ta = $('output');
      ta.focus(); ta.select();
      $('copy-msg').textContent = '文面を選択しました。コピーしてください（長押し →「コピー」、または Ctrl+C）。';
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  on('copy', 'click', function () { copyText($('output').value, 'コピーしました。そのまま貼り付けられます。'); });
  on('share', 'click', function () {
    var url = location.href.split('#')[0] + toShareHash(state);
    history.replaceState(null, '', url);
    var msg = 'リンクをコピーしました。条件はリンクの「#」以降に入っていて、サーバーには送信されません。';
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(function () { $('file-msg').textContent = msg; }, function () { $('file-msg').textContent = 'アドレスバーのリンクをコピーしてください。'; });
    else $('file-msg').textContent = 'アドレスバーのリンクをコピーしてください。';
  });
  on('ics', 'click', function () {
    var dates = outputDates(lastRes);
    if (!dates.length) return;
    var blob = new Blob([Calc.toICS(dates, { title: outputTitle(), time: state.time })], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nittei-kouho.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $('copy-msg').textContent = '.ics を保存しました。カレンダーのアプリで開くと、候補日が仮の予定として入ります。';
  });

  // --- ファイルへの書き出し・読み込み（README「ツールを追加するとき」20。決定 D31） ---
  // 中身はこの端末の中で作り、どこにも送信しない。機種変更のときはファイルを移して読み込む
  var TOOL = 'nittei-kouho';
  on('backup-export', 'click', function () {
    var blob = new Blob([JSON.stringify(Calc.buildBackup(TOOL, { draft: state }), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = Calc.backupFileName(TOOL);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $('file-msg').textContent = 'ファイルに書き出しました。機種変更のときは、このファイルを新しい端末に移して「ファイルから読み込む」を押してください。';
  });
  on('backup-import', 'click', function () { $('backup-file').click(); });
  on('backup-file', 'change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { $('file-msg').textContent = 'ファイルが大きすぎます。このツールで書き出したファイルを選んでください。'; return; }
    file.text().then(function (text) {
      var r = Calc.parseBackup(text, TOOL, ['draft']);
      if (!r.ok) { $('file-msg').textContent = r.error; return; }
      if (!window.confirm('ファイルの内容で、今の条件（NG の日・手で調整した日を含む）を置き換えます。よろしいですか？')) return;
      state = normalize(r.data.draft); fromShare = false;
      fillForm(); update();
      $('file-msg').textContent = 'ファイルから読み込みました。';
    }, function () { $('file-msg').textContent = 'ファイルを読み取れませんでした。'; });
  });

  // --- 上端の固定バーと「くわしく入れる」の状態表示（screen.js。yorozu-plans の SCREEN.md 1.1） ---
  // 読み込み時から結果が出ているので、利用者がスクロールか入力をするまではバーを出さない（CLS を出さない）
  var bar = window.YorozuScreen.fixedBar({ bar: 'fixbar', watch: 'out-panel', jump: 'result-card', text: 'fixbar-text' });
  var barArmed = false;
  function armBar() {
    if (barArmed) return;
    barArmed = true;
    window.removeEventListener('scroll', armBar);
    document.removeEventListener('input', armBar);
    document.removeEventListener('change', armBar);
    updateBar();
  }
  window.addEventListener('scroll', armBar, { passive: true });
  document.addEventListener('input', armBar);
  document.addEventListener('change', armBar);
  function updateBar() {
    var n = lastRes ? outputDates(lastRes).length : 0;
    bar.set(barArmed && n ? '候補 ' + n + ' 日' : '');
  }
  function optText(sel) { return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : ''; }
  function updateSummaries() {
    var days = [1, 2, 3, 4, 5, 6, 0].filter(function (i) { return state.weekdays[i]; }).map(function (i) { return Calc.DOW[i]; }).join('');
    var time = state.time.kind === 'custom'
      ? (state.time.from || '') + '〜' + (state.time.to || '')
      : optText($('time-kind'));
    var fmt = [state.title.trim() || '用件なし', optText($('kind'))];
    if (state.deadline) fmt.push('期限 ' + Calc.formatDate(state.deadline, state.dateStyle));
    window.YorozuScreen.detailsSummary({
      'opt-days': (days || 'なし') + '・' + (state.skipHolidays ? '祝日を外す' : '祝日を外さない'),
      'opt-time': time,
      'opt-cal': (state.ng.length ? 'NG ' + state.ng.length + ' 日' : 'NG なし') + (state.added.length || state.removed.length ? '・手で調整した日あり' : ''),
      'opt-format': fmt.join('・'),
      'opt-mode': state.mode === 'early' ? '早い順' : 'ばらけさせる',
      'opt-two': state.twoStage ? 'する' : 'しない',
    });
  }

  // --- 全体の更新 ---
  var lastRes = null;
  function render(res) {
    renderCalendar(res);
    renderStage1(res);
    renderOutput(res);
  }
  function update() {
    if (!fromShare) store.set('draft', state);
    var res = compute();
    lastRes = res;
    $('warnings').hidden = !res.warnings.length;
    $('warnings').innerHTML = '';
    res.warnings.forEach(function (w) { var p = document.createElement('p'); p.textContent = w; $('warnings').appendChild(p); });
    $('pick-summary').textContent = '候補 ' + res.final.length + ' 日（選べる日 ' + res.days.length + ' 日のうち）' +
      (state.added.length || state.removed.length ? '。手で調整した日があります' : '');
    render(res);
    updateBar();
    updateSummaries();
  }

  // 共有リンクから開いたときは、保存中の下書きを上書きしない（操作したら下書きとして保存し直す）
  ['input', 'change', 'click'].forEach(function (ev) {
    document.addEventListener(ev, function () { fromShare = false; }, { once: true, capture: true });
  });

  // 共有リンクで来た人に、自分の日程を一から作る入口を出す
  if (fromShare) $('shared-notice').hidden = false;
  on('shared-new', 'click', function () {
    history.replaceState(null, '', location.pathname + location.search);
    fromShare = false;
    state = normalize(null);
    $('shared-notice').hidden = true;
    fillForm();
    update();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('hol-years').textContent = K.HOLIDAY_YEARS.from + '〜' + K.HOLIDAY_YEARS.to + ' 年';
  fillForm();
  update();
})();
