/*
 * 교사 화면 (형성평가 분석 · 정기고사 출제 가이드) — legacy/gas/AnalysisUI.html 의 스크립트를 거의 그대로 옮긴 것.
 * src/app/teacher/teacher-app.tsx 가 app.js → analysis.js 순서로 일반 <script> 로 불러와요 (두 파일은 전역 범위를 공유).
 * 바뀐 점: 서버 호출(call → POST /api/teacher), 로그인(Supabase), 학생 주소(/student), 위젯 주소(/teacher/widget),
 *          설정의 OpenAI 키 입력(→ Vercel 환경변수), 로그아웃(POST /auth/signout).
 */
/* =====================================================================
 *  형성평가 분석 · 정기고사 출제 가이드   (서버: Analysis.gs)
 *  오개념 목록은 통계 › 개념 지도의 개념 정보에서 관리 (app.js)
 * ===================================================================== */
var AN = null;    // 형성평가 분석 화면 상태
var EXM = null;   // 정기고사 출제 가이드 화면 상태

/* ---------- 공통 ---------- */
function anPct(v){ return v == null || isNaN(v) ? '-' : Math.round(v * 100) + '%'; }
function anNum(v, d){ return v == null || isNaN(v) ? '-' : Number(v).toFixed(d == null ? 2 : d); }
function anColor(rate){
  if (rate == null) return '#4a5163';
  return rate < .4 ? '#c0392b' : rate < .6 ? '#d9622b' : rate < .75 ? '#c79a1e' : rate < .9 ? '#1f8fc4' : '#1aa37a';
}
function anMeter(v, color){
  return '<span class="an-meter"><i style="width:' + Math.round(Math.max(0, Math.min(1, v || 0)) * 100) + '%;background:' + (color || anColor(v)) + '"></i></span>';
}
function anTag(text, cls){ return '<span class="an-tag ' + (cls || 'blue') + '">' + esc(text) + '</span>'; }
function anFirstSubject(){
  return (AN && AN.subject) || (EXM && EXM.subject) || activeSubjects()[0] || allSubjects()[0] || '';
}
function anSubjOptions(sel){
  return allSubjects().map(function(s){ return '<option' + (s === sel ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
}
function anClassOptions(subject, sel){
  return '<option value="">전체 반</option>' + S.classes.filter(function(c){ return c.subject === subject; }).map(function(c){
    return '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name) + (c.semesterName ? ' · ' + esc(c.semesterName) : '') + '</option>';
  }).join('');
}
function anConceptName(id){ var c = S.concepts.find(function(x){ return x.id === id; }); return c ? c.name : '?'; }
function anConceptChips(ids){ return (ids || []).map(function(id){ return '<span class="chip">' + esc(anConceptName(id)) + '</span>'; }).join(''); }
/** 막대그래프 SVG. values: 숫자 배열, labels: 아래 글자, opt.marks: [{x:0~1, label}], opt.W · opt.H · opt.fs(글자 크기) · opt.sel(강조할 막대) */
function anHist(values, labels, opt){
  opt = opt || {};
  var W = opt.W || 560, H = opt.H || 180, fs = opt.fs || 10, pad = 26, n = values.length;
  var max = Math.max.apply(null, values.concat([opt.minMax || 1e-9]));
  var bw = (W - pad * 2) / n;
  var s = '<svg class="an-hist" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
  values.forEach(function(v, i){
    var h = (H - 28 - fs * 2) * v / max, x = pad + i * bw, y = H - 12 - fs - h;
    var fill = opt.sel === i ? '#e5484d' : (opt.color || '#5b7fc7');
    // 투명한 큰 칸: 막대가 낮아도 누르기 쉽게
    s += '<rect data-bin="' + i + '" x="' + x + '" y="0" width="' + bw + '" height="' + H + '" fill="transparent"><title>' + esc(labels[i]) + ': ' + (opt.fmt ? opt.fmt(v) : v) + '</title></rect>';
    s += '<rect data-bin="' + i + '" x="' + (x + 2) + '" y="' + y + '" width="' + Math.max(1, bw - 4) + '" height="' + h + '" rx="3" fill="' + fill + '"><title>' + esc(labels[i]) + ': ' + (opt.fmt ? opt.fmt(v) : v) + '</title></rect>';
    if (opt.fmt && v > 0) s += '<text x="' + (x + bw / 2) + '" y="' + (y - 4) + '" text-anchor="middle" font-size="' + fs + '" fill="#555" pointer-events="none">' + opt.fmt(v) + '</text>';
    s += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="' + fs + '" fill="#888" pointer-events="none">' + esc(labels[i]) + '</text>';
  });
  (opt.marks || []).forEach(function(m){
    var x = pad + Math.max(0, Math.min(1, m.x)) * (W - pad * 2);
    s += '<line x1="' + x + '" x2="' + x + '" y1="12" y2="' + (H - 22) + '" stroke="#e5484d" stroke-dasharray="4 3"/>' +
      '<text x="' + (x + 3) + '" y="' + (12 + (m.dy || 0)) + '" font-size="10" fill="#e5484d">' + esc(m.label) + '</text>';
  });
  return s + '</svg>';
}
function anCopy(text){
  var ok = false;
  try {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    ok = document.execCommand('copy');
    ta.remove();
  } catch (e) {}
  if (!ok && navigator.clipboard) { navigator.clipboard.writeText(text).then(function(){ toast('복사했어요'); }, function(){ toast('복사하지 못했어요', true); }); return; }
  toast(ok ? '복사했어요. 엑셀/한글 표에 붙여넣을 수 있어요.' : '복사하지 못했어요', !ok);
}

/* =====================================================================
 *  1. 형성평가 분석
 * ===================================================================== */
function renderAnalysis(){
  var p = S.params || {};
  var subject = p.subject || anFirstSubject();
  if (!AN || AN.subject !== subject) AN = {subject:subject, classId:'', from:'', to:'', tab:p.tab || 'overview', data:null, sel:null};
  if (p.tab) AN.tab = p.tab;
  var main = $('#main');
  if (!allSubjects().length) { main.innerHTML = '<div class="page-title"><h1>형성평가 분석</h1></div><div class="empty">아직 과목이 없어요. [수업하기]에서 클래스를 먼저 만들어 주세요.</div>'; return; }
  var tabs = [['overview', '개요'], ['map', '개념 지도'], ['mis', '오개념'], ['items', '문항 · 오답'], ['students', '학생']];
  main.innerHTML = '<div class="page-title"><h1>형성평가 분석</h1><span class="grow"></span>' +
      '<button class="btn primary" id="anGoExam">정기고사 출제 가이드 →</button></div>' +
    '<div class="an-bar"><select class="inp" id="anSubj">' + anSubjOptions(AN.subject) + '</select>' +
      '<select class="inp" id="anCls">' + anClassOptions(AN.subject, AN.classId) + '</select>' +
      '<input type="date" class="inp" id="anFrom" value="' + esc(AN.from) + '"><span>~</span><input type="date" class="inp" id="anTo" value="' + esc(AN.to) + '">' +
      '<button class="btn primary" id="anRun">분석하기</button></div>' +
    '<div class="tabs an-tabs">' + tabs.map(function(t){ return '<div class="tab' + (AN.tab === t[0] ? ' on' : '') + '" data-antab="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div>' +
    '<div id="anBody"></div>';
  $('#anGoExam').onclick = function(){ if (EXM) EXM.subject = AN.subject; go('exam'); };
  $('#anSubj').onchange = function(e){ go('analysis', {subject:e.target.value}); };
  $('#anCls').onchange = function(e){ AN.classId = e.target.value; };
  $('#anFrom').onchange = function(e){ AN.from = e.target.value; };
  $('#anTo').onchange = function(e){ AN.to = e.target.value; };
  $('#anRun').onclick = anLoad;
  $$('[data-antab]').forEach(function(t){ t.onclick = function(){
    AN.tab = t.dataset.antab;
    $$('[data-antab]').forEach(function(x){ x.classList.toggle('on', x === t); });
    anRenderBody();
  }; });
  if (AN.data) anRenderBody(); else anLoad();
}
async function anLoad(){
  var d = await call('getFormativeStats', {subject:AN.subject, classId:AN.classId, from:AN.from, to:AN.to});
  if (!AN || S.view !== 'analysis') return;
  AN.data = d; AN.sel = null;
  anRenderBody();
}
function anMisName(key){
  var m = AN && AN.data && AN.data.miscons.find(function(x){ return x.key === key; });
  return m ? m.name : String(key).replace(/^t:/, '');
}
function anRenderBody(){
  var body = $('#anBody');
  if (!body) return;
  var d = AN.data;
  if (!d) { body.innerHTML = '<div class="empty">불러오는 중…</div>'; return; }
  body.innerHTML = ({overview:anOverview, map:anMapTab, mis:anMisTab, items:anItemsTab, students:anStudentsTab}[AN.tab] || anOverview)(d);
  if (AN.tab === 'map') anBindMap();
  if (AN.tab === 'items') anBindItems();
  var hz = $('#anHistZoom'), hb = $('#anHistBox');
  if (hz) hz.onclick = function(){ anHistModal(d); };
  if (hb) hb.onclick = function(){ anHistModal(d); };
  var ss = $('#anStuSort');
  if (ss) ss.onchange = function(){ AN.stuSort = ss.value; anRenderBody(); };
}

/* ---------- 개요 ---------- */
function anOverview(d){
  var o = d.overview;
  var kpi = function(v, l){ return '<div class="an-kpi"><b>' + v + '</b><span>' + l + '</span></div>'; };
  var html = '<div class="an-kpis">' + kpi(o.students + (o.roster ? ' <small style="font-size:14px;color:#888">/ ' + o.roster + '명</small>' : ''), o.roster ? '참여 학생 / 명단' : '참여 학생') + kpi(o.responses, '응답 수') + kpi(o.items, '사용한 문항') +
    kpi(anPct(o.mean), '평균 정답률' + (o.sd != null ? ' (표준편차 ' + anPct(o.sd) + ')' : '')) +
    kpi(o.items ? anPct(o.analyzedItems / o.items) : '-', '오개념이 연결된 문항') + '</div>';
  if (!o.responses) return html + '<div class="empty">이 범위에는 아직 형성평가 응답이 없어요.<br>다른 반이나 기간을 골라 보세요.</div>';
  if (o.analyzedItems < o.items) html += '<div class="an-note">선지에 오개념 목록이 연결되지 않은 문항이 ' + (o.items - o.analyzedItems) + '개 있어요. 문제은행의 편집 창에서 선지에 오개념을 연결하면 오개념 단위로 정확히 집계돼요.</div>';
  var weak = d.concepts.filter(function(c){ return c.n; }).sort(function(a, b){ return a.mastery - b.mastery; }).slice(0, 6);
  var links = d.links.filter(function(l){ return l.difficulty != null; }).sort(function(a, b){ return b.difficulty - a.difficulty; }).slice(0, 5);
  var mis = d.miscons.filter(function(m){ return m.hits; }).slice(0, 6);
  var dis = [];
  d.items.forEach(function(it){ it.choices.forEach(function(c){ if (c.flags.indexOf('매력적 오답') >= 0) dis.push({it:it, c:c}); }); });
  dis.sort(function(a, b){ return b.c.rate - a.c.rate; });
  html += '<div class="an-card an-histcard"><div class="row" style="gap:8px;align-items:center;margin-bottom:6px"><h3 style="margin:0;flex:1">학생 정답률 분포</h3>' +
      '<button class="btn" id="anHistZoom" style="flex:none" title="크게 보고, 구간을 잘게 나누고, 막대를 눌러 학생 이름을 볼 수 있어요">🔍 확대해서 보기</button></div>' +
      '<div class="an-histbox" id="anHistBox" title="눌러서 확대">' + anHist(o.hist, ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90'].map(function(x){ return x + '%'; }), {fmt:function(v){ return v + '명'; }, W:900, H:260, fs:13}) + '</div></div>' +
    '<div class="an-grid">' +
    '<div class="an-card"><h3>약한 개념</h3><table class="an-t"><tr><th>개념</th><th class="num">정답률</th><th class="num">숙달 학생</th></tr>' +
      weak.map(function(c){ return '<tr><td>' + esc(c.name) + '</td><td class="num">' + anMeter(c.rate) + anPct(c.rate) + '</td><td class="num">' + anPct(c.mastered) + '</td></tr>'; }).join('') + '</table></div>' +
    '<div class="an-card"><h3>자주 나타난 오개념</h3>' + (mis.length ? '<table class="an-t"><tr><th>오개념</th><th class="num">선택 비율</th><th class="num">학생 비율</th></tr>' +
      mis.map(function(m){ return '<tr><td>' + esc(m.name) + (m.significant ? ' ' + anTag('유의', 'red') : '') + '</td><td class="num">' + anPct(m.rate) + ' <span class="an-sub">(' + m.hits + '/' + m.expoResp + ')</span></td><td class="num">' + anPct(m.prevalence) + '</td></tr>'; }).join('') + '</table>'
      : '<div class="empty">오개념 선지를 고른 응답이 아직 없어요.</div>') + '</div>' +
    '<div class="an-card"><h3>어려워한 개념 연결</h3>' + (links.length ? '<table class="an-t"><tr><th>연결</th><th class="num">어려움</th></tr>' +
      links.map(function(l){ return '<tr><td>' + esc(l.fromName) + ' → ' + esc(l.toName) + '</td><td class="num">' + anMeter(l.difficulty, '#c0392b') + anPct(l.difficulty) + '</td></tr>'; }).join('') + '</table>'
      : '<div class="empty">연결 정보가 아직 부족해요.</div>') + '</div>' +
    '<div class="an-card"><h3>매력적 오답</h3>' + (dis.length ? '<table class="an-t"><tr><th>문항 · 선지</th><th class="num">선택률</th></tr>' +
      dis.slice(0, 6).map(function(x){ return '<tr><td><b>' + esc(x.it.title) + '</b> ' + x.c.no + '번 <span class="an-sub">' + esc(x.c.text || (x.c.image ? '(그림 보기)' : '')) + '</span>' +
        (x.c.mis.length ? '<div class="an-sub">→ ' + x.c.mis.map(anMisName).map(esc).join(', ') + '</div>' : '') + '</td><td class="num">' + anPct(x.c.rate) + '</td></tr>'; }).join('') + '</table>'
      : '<div class="empty">눈에 띄는 매력적 오답이 없어요.</div>') + '</div>' +
    '</div>';
  return html;
}

/** 정답률 분포 확대 보기: 큰 그래프 · 구간 너비(20 · 10 · 5%) · 막대를 누르면 그 구간 학생 */
function anHistModal(d){
  var rates = d.students.filter(function(s){ return s.n; });
  var st = {w:10, sel:null};
  var draw = function(bg){
    var k = Math.round(100 / st.w), vals = [], labels = [], who = [];
    for (var i = 0; i < k; i++) { vals.push(0); labels.push(i * st.w + '%'); who.push([]); }
    rates.forEach(function(s){ var i = Math.min(k - 1, Math.floor(s.rate * k + 1e-9)); vals[i]++; who[i].push(s); });
    $('#anHzChart', bg).innerHTML = anHist(vals, labels, {fmt:function(v){ return v + '명'; }, W:1000, H:440, fs:st.w < 10 ? 12 : 15, sel:st.sel});
    $$('[data-hw]', bg).forEach(function(b){ b.classList.toggle('on', Number(b.dataset.hw) === st.w); });
    var list = st.sel == null ? null : who[st.sel].slice().sort(function(a, b){ return a.rate - b.rate || a.name.localeCompare(b.name, 'ko'); });
    $('#anHzWho', bg).innerHTML = list == null ? '<span class="an-sub">막대를 누르면 그 구간의 학생이 보여요.</span>'
      : '<b>' + labels[st.sel] + ' ~ ' + Math.min(100, (st.sel + 1) * st.w) + '%</b> <span class="an-sub">' + list.length + '명</span><div class="an-hzlist">' +
        (list.length ? list.map(function(s){ return '<span class="chip">' + (d.classes.length > 1 ? esc(s.cls) + ' ' : '') + (s.no != null ? s.no + '번 ' : '') + esc(s.name) + ' <small>' + anPct(s.rate) + '</small></span>'; }).join('') : '<span class="an-sub">없음</span>') + '</div>';
    $$('[data-bin]', bg).forEach(function(r){ r.onclick = function(){ var i = Number(r.dataset.bin); st.sel = st.sel === i ? null : i; draw(bg); }; });
  };
  modal({title:'학생 정답률 분포 · ' + rates.length + '명', wide:true, body:
      '<div class="row" style="gap:6px;align-items:center;margin-bottom:8px"><span class="an-sub" style="flex:none">구간</span>' +
        [20, 10, 5].map(function(w){ return '<button type="button" class="ex-chip" data-hw="' + w + '">' + w + '%</button>'; }).join('') + '</div>' +
      '<div id="anHzChart" class="an-hzchart"></div><div id="anHzWho" style="margin-top:10px"></div>',
    onOpen:function(bg){
      $('.modal', bg).classList.add('an-hzmodal');
      $$('[data-hw]', bg).forEach(function(b){ b.onclick = function(){ st.w = Number(b.dataset.hw); st.sel = null; draw(bg); }; });
      draw(bg);
    }});
}

/* ---------- 개념 지도 ---------- */
function anLinkColor(v){ return v == null ? '#c5cad6' : v >= .6 ? '#c0392b' : v >= .4 ? '#d9622b' : v >= .25 ? '#c79a1e' : '#1aa37a'; }
/** 개념 지도를 그림 대신 목록으로: 단원별 개념 · 정답률 · 오개념 수 · 이어진 개념 */
function anMapList(d){
  var nodes = d.concepts;
  if (!nodes.length) return '<div class="empty">개념 지도가 비어 있어요. [통계 → 개념 지도]에서 먼저 만들어 주세요.</div>';
  var units = nodes.map(function(n){ return n.unit || ''; }).filter(function(u, i, a){ return a.indexOf(u) === i; })
    .sort(function(a, b){ return (!a) - (!b) || a.localeCompare(b, 'ko'); });
  var name = {}; nodes.forEach(function(n){ name[n.id] = n.name; });
  return units.map(function(u){
    var list = nodes.filter(function(n){ return (n.unit || '') === u; }).sort(function(a, b){ return a.name.localeCompare(b.name, 'ko'); });
    return '<div class="an-ul"><div class="an-uh">' + esc(u || '단원 미지정') + ' <small>' + list.length + '</small></div>' + list.map(function(n){
      var nb = d.links.filter(function(l){ return (l.from === n.id && name[l.to]) || (l.to === n.id && name[l.from]); }).map(function(l){
        var other = l.from === n.id ? l.to : l.from;
        return '<span class="an-nb" title="연결 어려움 ' + anPct(l.difficulty) + '" style="border-color:' + anLinkColor(l.difficulty) + '">' + (l.from === n.id ? '→ ' : '← ') + esc(name[other]) + '</span>';
      }).join('');
      return '<div class="an-li ' + (AN.sel === n.id ? 'on' : '') + '" data-node="' + esc(n.id) + '">' +
        '<span class="an-dot" style="background:' + anColor(n.rate) + '"></span>' +
        '<b class="an-ln">' + esc(n.name) + '</b>' +
        '<span class="an-lr">' + (n.n ? anMeter(n.rate) + anPct(n.rate) + ' <small>(' + n.n + '응답)</small>' : '<span class="an-sub">응답 없음</span>') + '</span>' +
        '<span class="an-lm">' + (n.mis.length ? '오개념 ' + n.mis.length : '') + '</span>' +
        '<span class="an-lnb">' + nb + '</span></div>';
    }).join('') + '</div>';
  }).join('');
}
/** 개념 지도 옆 칸 (고른 개념의 자세한 내용) */
function anMapSide(d){
  var sel = d.concepts.find(function(c){ return c.id === AN.sel; });
  return sel ? '<h3>' + esc(sel.name) + '</h3>' +
      '<table class="an-t"><tr><td>정답률</td><td class="num">' + anPct(sel.rate) + ' (' + sel.c + '/' + sel.n + ')</td></tr>' +
      '<tr><td>숙달 학생 (정답률 70%↑)</td><td class="num">' + anPct(sel.mastered) + ' / ' + sel.students + '명</td></tr>' +
      '<tr><td>학생 간 편차 (SD)</td><td class="num">' + anPct(sel.sd) + '</td></tr></table>' +
      '<h3 style="margin-top:14px">이 개념에서 나타난 오개념</h3>' + (sel.mis.length ? sel.mis.map(function(m){ return '<div class="an-mi">' + esc(m.name) + ' <b>' + m.count + '회</b></div>'; }).join('') : '<div class="an-sub">없음</div>') +
      '<h3 style="margin-top:14px">연결</h3>' + (d.links.filter(function(l){ return l.from === sel.id || l.to === sel.id; }).map(function(l){
        return '<div class="an-mi">' + esc(l.fromName) + ' → ' + esc(l.toName) + ' <b style="color:' + anLinkColor(l.difficulty) + '">' + anPct(l.difficulty) + '</b></div>'; }).join('') || '<div class="an-sub">없음</div>')
    : '<div class="an-sub">개념을 누르면 자세한 내용이 보여요.<br><br>· 점 색: 개념 정답률<br>· 오개념 n: 이 개념에서 나타난 오개념 수<br>· 이어진 개념 테두리 색: 연결의 어려움<br>&nbsp;&nbsp;(연결 문항 오답률, 없으면 앞 개념은 숙달했지만 뒤 개념은 못 한 학생 비율)</div>';
}
function anMapTab(d){
  var side = anMapSide(d);
  // 아래 두 표는 응답(자료)이 있는 개념 · 연결만
  var conRows = d.concepts.filter(function(c){ return c.n > 0; }).sort(function(a, b){ return a.mastery - b.mastery; });
  var linkRows = d.links.filter(function(l){ return l.itemN > 0 || l.base > 0; })
    .sort(function(a, b){ return (b.difficulty == null ? -1 : b.difficulty) - (a.difficulty == null ? -1 : a.difficulty); });
  return '<div class="an-mapwrap"><div class="an-card" style="flex:1">' +
      '<div class="legend" style="margin-bottom:8px"><span><i style="background:#c0392b"></i>40% 미만</span><span><i style="background:#d9622b"></i>40~60%</span><span><i style="background:#c79a1e"></i>60~75%</span><span><i style="background:#1f8fc4"></i>75~90%</span><span><i style="background:#1aa37a"></i>90% 이상</span><span><i style="background:#4a5163"></i>데이터 없음</span></div>' +
      '<div id="anMap" class="an-list">' + anMapList(d) + '</div></div>' +
      '<div class="an-card an-side" id="anMapSide">' + side + '</div></div>' +
    '<div class="an-grid">' +
    '<div class="an-card"><h3>개념별 숙달도</h3><p class="d">숙달 학생 = 그 개념 문항 정답률이 70% 이상인 학생 비율. 학생 간 편차가 크면 시험에서 변별력이 높은 개념이에요. 응답이 있는 개념만 보여요.</p>' +
      (conRows.length ? '<div class="an-scroll"><table class="an-t"><tr><th>개념</th><th class="num">응답</th><th class="num">정답률</th><th class="num">숙달 학생</th><th class="num">학생 간 SD</th><th>주요 오개념</th></tr>' +
      conRows.map(function(c){
        return '<tr><td>' + esc(c.name) + '</td><td class="num">' + c.n + '</td><td class="num">' + anMeter(c.rate) + anPct(c.rate) + '</td><td class="num">' + anPct(c.mastered) + '</td><td class="num">' + anPct(c.sd) + '</td><td>' + c.mis.slice(0, 2).map(function(m){ return esc(m.name); }).join(', ') + '</td></tr>';
      }).join('') + '</table></div>' : '<div class="empty">응답이 있는 개념이 없어요.</div>') + '</div>' +
    '<div class="an-card"><h3>개념 연결 난이도</h3><p class="d">연결 문항 = 두 개념을 관련지어야 풀 수 있는 문항(예전 AI 분석 결과). 단절률 = 앞 개념을 숙달한 학생 중 뒤 개념은 숙달하지 못한 비율. 계산할 자료가 있는 연결만 보여요.</p>' +
      (linkRows.length ? '<div class="an-scroll"><table class="an-t"><tr><th>연결</th><th class="num">연결 문항 정답률</th><th class="num">단절률</th><th class="num">어려움</th></tr>' +
      linkRows.map(function(l){
        return '<tr><td>' + esc(l.fromName) + ' → ' + esc(l.toName) + '</td><td class="num">' + (l.itemN ? anPct(l.itemRate) + ' <span class="an-sub">(' + l.itemN + ')</span>' : '-') + '</td><td class="num">' + (l.base ? anPct(l.breakRate) + ' <span class="an-sub">(' + l.breakN + '/' + l.base + ')</span>' : '-') + '</td><td class="num">' + (l.difficulty == null ? '-' : anMeter(l.difficulty, anLinkColor(l.difficulty)) + anPct(l.difficulty)) + '</td></tr>';
      }).join('') + '</table></div>' : '<div class="empty">아직 계산할 수 있는 연결이 없어요. 두 개념을 모두 다룬 학생이 생기면 나타나요.</div>') + '</div></div>';
}
function anBindMap(){
  // 목록 전체를 다시 그리면 스크롤이 맨 위로 가므로, 고른 줄 표시와 옆 칸만 바꿔요
  $$('[data-node]').forEach(function(g){ g.onclick = function(){
    AN.sel = AN.sel === g.dataset.node ? null : g.dataset.node;
    $$('[data-node]').forEach(function(x){ x.classList.toggle('on', x.dataset.node === AN.sel); });
    var side = $('#anMapSide');
    if (side) side.innerHTML = anMapSide(AN.data);
  }; });
}

/* ---------- 오개념 ---------- */
function anMisTab(d){
  var list = d.miscons;
  if (!list.length) return '<div class="empty">집계할 오개념이 없어요. [통계 › 개념 지도]에서 개념별 오개념을 만들고, 문제은행 편집 창에서 선지에 연결해 주세요.</div>';
  return '<div class="an-card"><h3>오개념 통계</h3><p class="d">' +
    '· <b>선택 비율</b>: 이 오개념 선지가 있던 문항의 응답 중 그 선지를 고른 비율 (문항 수가 달라도 비교할 수 있어요).<br>' +
    '· <b>오답 중 비율</b>: 이 오개념 선지가 있던 문항에서 틀린 답 가운데 그 선지를 고른 비율. <b>기대</b>는 오답을 무작위로 골랐을 때의 비율이에요.<br>' +
    '· <b>z</b>: 실제 선택이 무작위 기대보다 얼마나 많은지(이항 근사). z ≥ 1.96이고 3회 이상이면 <b>유의</b>(5% 수준)로 표시해요.<br>' +
    '· <b>학생 비율</b>: 이 오개념 선지를 볼 수 있었던 학생 중 한 번이라도 고른 학생 비율과 95% 신뢰구간(Wilson). <b>반복</b>은 2번 이상 고른 학생 수예요.</p>' +
    '<div class="an-scroll"><table class="an-t"><tr><th>오개념</th><th>관련 개념</th><th class="num">선택 비율</th><th class="num">오답 중 비율 (기대)</th><th class="num">z</th><th class="num">학생 비율 [95% CI]</th><th class="num">반복</th><th class="num">문항</th></tr>' +
    list.map(function(m){
      return '<tr><td><b>' + esc(m.name) + '</b> ' + (m.significant ? anTag('유의', 'red') : '') + (m.listed ? '' : anTag('목록에 없음', 'gray')) +
        (m.desc ? '<div class="an-sub">' + esc(m.desc) + '</div>' : '') + '</td><td>' + anConceptChips(m.concepts) + '</td>' +
        '<td class="num">' + anPct(m.rate) + ' <span class="an-sub">(' + m.hits + '/' + m.expoResp + ')</span></td><td class="num">' + anPct(m.share) + ' <span class="an-sub">(' + anPct(m.expectedShare) + ')</span></td>' +
        '<td class="num">' + anNum(m.z, 1) + '</td><td class="num">' + (m.exposed ? anPct(m.prevalence) + ' <span class="an-sub">[' + anPct(m.ci[0]) + '–' + anPct(m.ci[1]) + ']</span> <span class="an-sub">' + m.students + '/' + m.exposed + '</span>' : '<span class="an-sub">다룬 문항 없음</span>') + '</td>' +
        '<td class="num">' + m.persistent + '명</td><td class="num">' + m.items + '</td></tr>';
    }).join('') + '</table></div></div>';
}

/* ---------- 문항 · 오답 ---------- */
function anDiffLabel(p){ return p == null ? '' : p >= .8 ? anTag('쉬움', 'green') : p >= .4 ? anTag('적정', 'blue') : anTag('어려움', 'org'); }
function anDiscLabel(D){
  if (D == null) return anTag('변별도 계산 불가', 'gray');
  return D < 0 ? anTag('역변별', 'red') : D < .2 ? anTag('변별 낮음', 'org') : D < .3 ? anTag('변별 보통', 'blue') : D < .4 ? anTag('변별 양호', 'green') : anTag('변별 우수', 'green');
}
/** 문항 목록 정렬: 정답률 낮은 순 */
function anItemsSorted(d){ return d.items.slice().sort(function(a, b){ return a.p - b.p; }); }
function anItemsTab(d){
  if (!d.items.length) return '<div class="empty">응답이 있는 문항이 없어요.</div>';
  var list = anItemsSorted(d);
  if (!AN.item || !list.some(function(it){ return it.id === AN.item; })) AN.item = list[0].id;
  return '<p class="an-sub" style="margin:0 0 10px">왼쪽에서 문항을 고르면 선지별 응답과 오답이 보여요. 난이도 p = 정답률 · 변별도 D = 상위 27% 정답률 − 하위 27% 정답률 (학생 순위는 그 문항을 뺀 나머지 정답률 기준) · r = 점이연 상관. 선지 막대 오른쪽의 <b>상/하</b>는 상위·하위 집단의 선택률이에요.</p>' +
    '<div class="an-itemwrap"><div class="an-card an-itemlist"><div class="an-sub" style="margin:0 0 6px">문항 ' + list.length + '개 · 정답률 낮은 순</div>' +
      list.map(function(it){
        var bad = it.D != null && it.D < 0;
        return '<div class="an-ir' + (it.id === AN.item ? ' on' : '') + '" data-item="' + esc(it.id) + '"><span class="an-dot" style="background:' + anColor(it.p) + '"></span>' +
          '<span class="an-irt">' + esc(it.title) + '</span><span class="an-irp">' + anPct(it.p) + (bad ? ' <span class="an-tag red">역변별</span>' : '') + '</span></div>';
      }).join('') + '</div>' +
    '<div id="anItemDetail" style="min-width:0">' + anItemCard(list.find(function(it){ return it.id === AN.item; })) + '</div></div>';
}
function anBindItems(){
  $$('[data-item]').forEach(function(r){ r.onclick = function(){
    AN.item = r.dataset.item;
    $$('[data-item]').forEach(function(x){ x.classList.toggle('on', x === r); });
    var it = AN.data.items.find(function(x){ return x.id === AN.item; });
    $('#anItemDetail').innerHTML = anItemCard(it);
  }; });
}
/** 문항 하나의 자세한 카드 (선지별 응답 · 오답 · 오개념) */
function anItemCard(it){
      var rows = it.type !== 'short' ? it.choices.map(function(c){
        return '<div class="an-ch' + (c.correct ? ' right' : '') + '"><b>' + c.no + (c.correct ? ' ✓' : '') + '</b><div><div class="bar"><i style="width:' + Math.round(c.rate * 100) + '%"></i><em>' + c.count + '명 · ' + anPct(c.rate) + '</em></div>' +
          '<div class="an-sub" style="margin-top:2px">' + (c.image ? '<img class="an-chimg" src="' + esc(c.image) + '" alt="' + c.no + '번 보기 그림">' : '') + esc(c.text) + ' ' + c.flags.map(function(f){ return anTag(f, f === '매력적 오답' ? 'org' : f === '상위권 유인' ? 'red' : 'gray'); }).join('') +
          (c.mis.length ? '<br>→ ' + c.mis.map(anMisName).map(esc).join(', ') : '') + (c.note ? '<br><i>' + esc(c.note) + '</i>' : '') + '</div></div>' +
          '<div class="an-sub num">상 ' + anPct(c.upRate) + ' · 하 ' + anPct(c.loRate) + '</div></div>';
      }).join('') + '<div class="an-ch an-dunno"><b>?</b><div><div class="bar"><i style="width:' + Math.round((it.n ? (it.unknown || 0) / it.n : 0) * 100) + '%"></i><em>' + (it.unknown || 0) + '명 · ' + anPct(it.n ? (it.unknown || 0) / it.n : 0) + '</em></div>' +
          '<div class="an-sub" style="margin-top:2px">모르겠어요 (오답으로 셈 · 오개념 집계에서는 빠져요)</div></div><div></div></div>' : (it.shorts.length ? it.shorts.map(function(s){
        return '<div class="an-ch"><b>✗</b><div>' + esc(s.text) + (s.mis.length ? ' <span class="an-sub">→ ' + s.mis.map(anMisName).map(esc).join(', ') + '</span>' : '') + '</div><div class="an-sub num">' + s.count + '명</div></div>';
      }).join('') : '<div class="an-sub">오답 없음</div>');
      return '<div class="an-card"><div class="row" style="flex-wrap:wrap;gap:6px;align-items:baseline"><h3 style="flex:none;margin:0">' + esc(it.title) + '</h3>' +
        '<span style="flex:none">' + anDiffLabel(it.p) + anDiscLabel(it.D) + (it.multi ? anTag('정답 여러 개', 'blue') : '') + (it.analyzed ? '' : anTag('오개념 미연결', 'gray')) + '</span><span class="grow"></span>' +
        '<span class="an-sub" style="flex:none">p ' + anNum(it.p) + ' · D ' + anNum(it.D) + ' · r ' + anNum(it.rpb) + ' · ' + it.n + '명</span></div>' +
        '<div class="an-sub" style="margin:6px 0 8px">' + esc(it.stem) + '</div>' + anConceptChips(it.concepts) + '<div style="margin-top:8px">' + rows + '</div></div>';
}

/* ---------- 학생 (학생 목록 관리의 명단과 연동) ---------- */
function anStudentsTab(d){
  if (!d.students.length) return '<div class="empty">학생 응답이 없어요.' + (d.hasRoster ? '' : '<br>[수업하기 › 학생 목록 관리]에서 명단을 만들고 클래스에 연결하면 명단 기준으로 볼 수 있어요.') + '</div>';
  var sort = AN.stuSort || (d.hasRoster ? 'no' : 'rate');
  var list = d.students.slice();
  if (sort === 'no') list.sort(function(a, b){ return a.cls.localeCompare(b.cls, 'ko') || (a.no == null ? 999 : a.no) - (b.no == null ? 999 : b.no) || a.name.localeCompare(b.name, 'ko'); });
  var none = d.students.filter(function(s){ return !s.n; }).length;
  return '<div class="an-card"><div class="row" style="gap:8px;align-items:center"><h3 style="margin:0;flex:1">학생별 요약</h3>' +
      '<span class="an-sub" style="flex:none">정렬</span><select class="inp" id="anStuSort" style="width:auto;flex:none"><option value="no"' + (sort === 'no' ? ' selected' : '') + '>반 · 번호순</option><option value="rate"' + (sort === 'rate' ? ' selected' : '') + '>정답률 낮은 순</option></select></div>' +
    '<p class="d">' + (d.hasRoster ? '[학생 목록 관리]의 명단과 연동돼요' + (none ? ' · 아직 응답이 없는 학생 ' + none + '명도 함께 보여요' : '') + '. ' : '클래스에 학생 명단이 연결되지 않아 응답한 이름으로 모았어요. ') +
      '약한 개념 = 그 개념 정답률(평활값)이 50% 미만.</p><div class="an-scroll"><table class="an-t"><tr><th>반</th><th class="num">번호</th><th>이름</th><th class="num">정답률</th><th>약한 개념</th><th>주요 오개념</th></tr>' +
    list.map(function(s){
      return '<tr' + (s.n ? '' : ' style="color:#9aa0ac"') + '><td>' + esc(s.homeroom || s.cls) + '</td><td class="num">' + (s.no == null ? '-' : s.no) + '</td><td>' + esc(s.name) + (s.inRoster || !d.hasRoster ? '' : ' ' + anTag('명단에 없음', 'gray')) + '</td>' +
        '<td class="num">' + (s.n ? anMeter(s.rate) + anPct(s.rate) + ' <span class="an-sub">(' + s.c + '/' + s.n + ')</span>' : '응답 없음') + '</td>' +
        '<td>' + anConceptChips(s.weak.slice(0, 4)) + '</td><td>' + s.mis.map(function(m){ return esc(m.name) + ' <span class="an-sub">' + m.count + '회</span>'; }).join('<br>') + '</td></tr>';
    }).join('') + '</table></div></div>';
}

/* =====================================================================
 *  2. 정기고사 출제 가이드 — 개념의 상대적 강약 · 오개념 선택 비율로 시험 목적별 설계 추천
 *     (학생 능력 추정 · 절대 난이도 · 예상 점수 분포는 쓰지 않아요)
 * ===================================================================== */
var EXAM_PURPOSE_INFO = [
  ['criterion', '최소 성취기준 확인', '모든 학생이 핵심 개념의 기준에 도달했는지 확인해요. 범위의 개념을 빠짐없이 넣고, 상대적으로 약한 개념을 더 여러 번 묻습니다. 배점은 균등하게.'],
  ['norm', '상대평가 (변별 중심)', '학생 간 차이가 드러나게 해요. 반 전체가 잘하는 강점 개념의 비중을 줄이고, 약하거나 중간인 개념과 자주 고른 오개념(매력적 오답)에 문항을 모읍니다.'],
  ['diagnostic', '학습 결손 진단', '남아 있는 결손과 오개념을 찾아요. 상대적으로 약한 개념과 선택 비율이 높은 오개념의 비중을 크게 둡니다.']
];
function renderExam(){
  if (!EXM) EXM = {purpose:'', subject:anFirstSubject(), classId:'', n:20, total:100, step:1, scope:null, openUnits:{}, plan:null, advice:null};
  if (EXM.purpose && !EXAM_PURPOSE_INFO.some(function(p){ return p[0] === EXM.purpose; })) EXM.purpose = '';
  var main = $('#main');
  if (!allSubjects().length) { main.innerHTML = '<div class="page-title"><h1>정기고사 출제 가이드</h1></div><div class="empty">아직 과목이 없어요.</div>'; return; }
  main.innerHTML = '<div class="page-title"><h1>정기고사 출제 가이드</h1><span class="grow"></span><button class="btn" id="exGoAn">형성평가 분석 보기</button></div>' +
    '<p class="an-sub" style="margin:-6px 0 12px">형성평가에서 나온 <b>개념의 상대적 강약(순위)</b>과 <b>오개념 선택 비율</b>로, 시험 목적에 맞는 문항 구성을 추천해요.</p>' +
    '<h3 class="an-step">1. 시험 목적</h3><div class="an-purpose">' + EXAM_PURPOSE_INFO.map(function(p){
      return '<div class="an-pc' + (EXM.purpose === p[0] ? ' on' : '') + '" data-purpose="' + p[0] + '"><h4>' + p[1] + '</h4><p>' + p[2] + '</p></div>'; }).join('') + '</div>' +
    '<div id="exSet"></div><div id="exOut"></div>';
  $('#exGoAn').onclick = function(){ go('analysis', {subject:EXM.subject}); };
  $$('[data-purpose]').forEach(function(c){ c.onclick = function(){
    exReadForm();
    EXM.purpose = c.dataset.purpose; EXM.plan = null; EXM.advice = null;
    $$('[data-purpose]').forEach(function(x){ x.classList.toggle('on', x === c); });
    exSettings(); $('#exOut').innerHTML = '';
  }; });
  if (EXM.purpose) { exSettings(); if (EXM.plan) exRenderOut(); }
}
function exSettings(){
  var box = $('#exSet');
  var cons = S.concepts.filter(function(c){ return c.subject === EXM.subject && c.kind !== 'unit'; });
  if (!EXM.scope || EXM.scopeSubject !== EXM.subject) { EXM.scope = cons.map(function(c){ return c.id; }); EXM.scopeSubject = EXM.subject; }
  var units = [];
  cons.forEach(function(c){ if (units.indexOf(c.unit || '') < 0) units.push(c.unit || ''); });
  units.sort(function(a, b){ return (!a) - (!b) || a.localeCompare(b, 'ko'); });
  box.innerHTML = '<h3 class="an-step">2. 출제 조건</h3><div class="an-card"><div class="an-form">' +
      '<div><label>과목</label><select class="inp" id="exSubj">' + anSubjOptions(EXM.subject) + '</select></div>' +
      '<div><label>형성평가 자료 (반)</label><select class="inp" id="exCls">' + anClassOptions(EXM.subject, EXM.classId) + '</select></div>' +
      '<div><label>문항 수</label><input type="number" class="inp" id="exN" min="1" max="100" value="' + EXM.n + '"></div>' +
      '<div><label>총점</label><input type="number" class="inp" id="exTotal" min="1" value="' + EXM.total + '"></div>' +
      '<div><label>배점 단위</label><select class="inp" id="exStep">' + [1, 0.5, 0.1].map(function(v){ return '<option value="' + v + '"' + (Number(EXM.step) === v ? ' selected' : '') + '>' + v + '점</option>'; }).join('') + '</select></div>' +
    '</div>' +
    '<label class="f" style="margin-top:14px">출제 범위 <span class="an-sub" id="exScopeN"></span> <a href="#" id="exAll">전체 선택</a> · <a href="#" id="exNone">전체 해제</a></label>' +
    (cons.length ? '<div class="ex-units" id="exScope"></div>' : '<div class="an-sub">이 과목의 개념 지도가 비어 있어요. 개념 지도를 먼저 만들어 주세요.</div>') +
    '<div style="margin-top:16px"><button class="btn primary big" id="exRun">문항 구성 추천 받기</button></div></div>';
  $('#exSubj').onchange = function(e){ exReadForm(); EXM.subject = e.target.value; EXM.classId = ''; EXM.plan = null; exSettings(); $('#exOut').innerHTML = ''; };
  $('#exAll').onclick = function(e){ e.preventDefault(); EXM.scope = cons.map(function(c){ return c.id; }); exDrawScope(cons, units); };
  $('#exNone').onclick = function(e){ e.preventDefault(); EXM.scope = []; exDrawScope(cons, units); };
  $('#exRun').onclick = exRun;
  if (cons.length) exDrawScope(cons, units);
}
/** 출제 범위: 대단원마다 한 줄 (단원 전체 선택 체크 · 고른 개수), 단원을 누르면 그 단원의 개념만 펼쳐서 고름 */
function exDrawScope(cons, units){
  var box = $('#exScope');
  if (!box) return;
  var inScope = function(id){ return EXM.scope.indexOf(id) >= 0; };
  box.innerHTML = units.map(function(u, ui){
    var list = cons.filter(function(c){ return (c.unit || '') === u; });
    var k = list.filter(function(c){ return inScope(c.id); }).length, open = !!EXM.openUnits[u];
    return '<div class="ex-unit' + (open ? ' open' : '') + '">' +
      '<div class="ex-unit-h"><input type="checkbox" data-unit="' + ui + '"' + (k === list.length ? ' checked' : '') + ' title="이 단원 전체 선택">' +
        '<button type="button" class="ex-unit-name" data-uopen="' + ui + '"><span class="arr">▶</span>' + esc(u || '단원 미지정') + '</button>' +
        '<span class="ex-unit-n' + (k ? ' on' : '') + '">' + k + ' / ' + list.length + '</span></div>' +
      (open ? '<div class="an-cklist ex-unit-body">' + list.map(function(c){
        return '<label><input type="checkbox" data-con="' + esc(c.id) + '"' + (inScope(c.id) ? ' checked' : '') + '>' + esc(c.name) + '</label>'; }).join('') + '</div>' : '') +
      '</div>';
  }).join('');
  $$('[data-unit]', box).forEach(function(x){
    var list = cons.filter(function(c){ return (c.unit || '') === units[x.dataset.unit]; });
    var k = list.filter(function(c){ return inScope(c.id); }).length;
    x.indeterminate = k > 0 && k < list.length;
    x.onchange = function(){
      var ids = list.map(function(c){ return c.id; });
      EXM.scope = EXM.scope.filter(function(id){ return ids.indexOf(id) < 0; });
      if (x.checked) EXM.scope = EXM.scope.concat(ids);
      exDrawScope(cons, units);
    };
  });
  $$('[data-uopen]', box).forEach(function(b){ b.onclick = function(){ var u = units[b.dataset.uopen]; EXM.openUnits[u] = !EXM.openUnits[u]; exDrawScope(cons, units); }; });
  $$('[data-con]', box).forEach(function(x){ x.onchange = function(){
    EXM.scope = EXM.scope.filter(function(id){ return id !== x.dataset.con; });
    if (x.checked) EXM.scope.push(x.dataset.con);
    exDrawScope(cons, units);
  }; });
  var n = $('#exScopeN'); if (n) n.textContent = '(' + EXM.scope.length + ' / ' + cons.length + '개 개념)';
}
function exReadForm(){
  if (!$('#exN')) return;
  EXM.classId = $('#exCls').value;
  EXM.n = Number($('#exN').value) || 20; EXM.total = Number($('#exTotal').value) || 100; EXM.step = Number($('#exStep').value) || 1;
}
async function exRun(){
  exReadForm();
  if (!EXM.scope.length) { toast('출제 범위 개념을 하나 이상 골라 주세요', true); return; }
  var plan = await call('recommendExam', {subject:EXM.subject, classId:EXM.classId, purpose:EXM.purpose,
    n:EXM.n, total:EXM.total, step:EXM.step, conceptIds:EXM.scope});
  if (S.view !== 'exam') return;
  EXM.plan = plan; EXM.advice = null;
  exRenderOut();
  $('#exOut').scrollIntoView({behavior:'smooth', block:'start'});
}
var EX_TAG_CLS = {'약점':'red', '보통':'blue', '강점':'green', '자료 없음':'gray', '오개념':'org'};
function exKindTag(s){ return anTag(s.kind === 'concept' ? s.tag + ' 개념' : '오개념 확인', EX_TAG_CLS[s.tag] || 'blue'); }
function exRankBar(rank, k){
  if (!rank || !k) return '<span class="an-sub">-</span>';
  var pos = k > 1 ? (rank - 1) / (k - 1) : 0.5;   // 0 = 가장 약함, 1 = 가장 강함
  return '<span class="ex-rank" title="' + k + '개 중 약한 순 ' + rank + '위"><i style="left:' + Math.round(pos * 100) + '%"></i></span><span class="an-sub"> ' + rank + '/' + k + '</span>';
}
function exRenderOut(){
  var P = EXM.plan, out = $('#exOut');
  var dp = P.step < 1 ? 1 : 0;
  var tbl = function(rows, label){
    return '<table class="an-t"><tr><th>' + label + '</th><th class="num">문항</th><th class="num">배점</th></tr>' + rows.map(function(r){
      return '<tr><td>' + esc(r.label || r.name) + '</td><td class="num">' + anNum(r.items, Number.isInteger(r.items) ? 0 : 1) + '</td><td class="num">' + anNum(r.points, dp) + '</td></tr>'; }).join('') + '</table>';
  };
  // 간단히 보기: 오개념은 [자주 고른 것 · 상위 5개 · 전체], 개념은 [약점 · 보통 · 강점 · 전체] 중 골라서
  EXM.misView = EXM.misView || 'frequent'; EXM.conView = EXM.conView || 'weak'; EXM.conMore = !!EXM.conMore;
  var misAll = P.miscons, misFreq = misAll.filter(function(m){ return m.frequent; });
  if (EXM.misView === 'frequent' && !misFreq.length) EXM.misView = 'top';
  var misShown = EXM.misView === 'frequent' ? misFreq : EXM.misView === 'top' ? misAll.slice(0, 5) : misAll;
  var conShown = EXM.conView === 'all' ? P.concepts : P.concepts.filter(function(c){ return c.tag === ({weak:'약점', mid:'보통', strong:'강점'})[EXM.conView]; });
  var chips = function(key, cur, opts){ return '<div class="ex-chips">' + opts.map(function(o){ return '<button type="button" class="ex-chip' + (o[0] === cur ? ' on' : '') + '" data-' + key + '="' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; };
  var conRows = conShown.map(function(c){
    return '<tr><td><b>' + esc(c.name) + '</b>' + (c.unit ? ' <span class="an-sub">' + esc(c.unit) + '</span>' : '') + '</td>' +
      '<td>' + anTag(c.tag, EX_TAG_CLS[c.tag]) + '</td><td>' + exRankBar(c.rank, c.k) + '</td>' +
      '<td class="num">' + (c.n ? anPct(c.rate) + ' <span class="an-sub">(' + c.n + ')</span>' : '-') + '</td>' +
      (EXM.conMore ? '<td class="num">' + (c.misExpo ? anPct(c.misRate) : '-') + '</td>' +
      '<td>' + (c.topMis.length ? c.topMis.map(function(m){ return esc(m.name) + (m.rate != null ? ' <span class="an-sub">' + anPct(m.rate) + '</span>' : ''); }).join('<br>') : '<span class="an-sub">-</span>') + '</td>' : '') +
      '<td class="num"><b>' + anNum(c.items, Number.isInteger(c.items) ? 0 : 1) + '</b></td><td class="num">' + anNum(c.points, dp) + '</td></tr>';
  }).join('');
  // 오개념: 한 줄에 이름 · 막대 · 비율 (자세한 값은 마우스를 올리면)
  var misRows = misShown.map(function(m){
    var tip = '선택 ' + m.hits + ' / 노출 ' + m.expoResp + '회 · ' + m.k + '개 중 ' + m.rank + '위' + (m.concepts.length ? ' · ' + m.concepts.join(', ') : '');
    return '<div class="ex-mis" title="' + esc(tip) + '"><span class="ex-mis-n">' + esc(m.name) + '</span>' +
      '<span class="ex-mis-bar"><i style="width:' + Math.round((m.rate || 0) * 100) + '%"></i></span><b>' + anPct(m.rate) + '</b>' +
      (m.assigned ? anTag('권장', 'green') : '<span class="ex-mis-gap"></span>') + '</div>';
  }).join('');
  out.innerHTML = '<h3 class="an-step">3. 추천 설계 — ' + esc(P.purposeLabel) + ' · ' + P.n + '문항 · ' + P.total + '점</h3>' +
    (P.stats.responses ? '' : '<div class="an-note">이 범위에 형성평가 응답이 없어 개념을 같은 비중으로 나누는 걸 권해요. 반을 확인해 주세요.</div>') +
    '<div class="an-card ex-design"><h3>이 목적이면 이렇게 설계해 보세요</h3>' +
      '<ul class="an-advice">' + P.design.principles.map(function(t){ return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      (P.design.facts.length ? '<div class="ex-facts"><b>이번 형성평가 자료로 본 제안</b><ul class="an-advice">' + P.design.facts.map(function(t){ return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>' +
    '<div class="ex-pair">' +
      '<div class="an-card ex-pair-l"><h3>구성 요약 (권장)</h3>' + tbl(P.summary.byKind, '유형') + '</div>' +
      '<div class="an-card ex-pair-r"><div class="ex-head"><h3>오개념 선택 비율</h3>' +
        chips('mv', EXM.misView, [['frequent', '자주 고른 것 ' + misFreq.length], ['top', '상위 5개'], ['all', '전체 ' + misAll.length]]) + '</div>' +
        (misRows ? '<div class="ex-mis-list">' + misRows + '</div><div class="an-sub ex-foot">선택 비율 = 그 오개념 선지를 고른 응답 ÷ 그 선지가 있던 문항의 응답 · 줄에 마우스를 올리면 자세히</div>'
          : '<div class="empty">' + (misAll.length ? '고른 보기에 해당하는 오개념이 없어요.' : '오개념이 연결된 선지의 응답이 아직 없어요.') + '</div>') + '</div>' +
    '</div>' +
    '<div class="an-card"><div class="ex-head"><h3>개념별 상대 위치와 배분</h3>' +
      chips('cv', EXM.conView, [['weak', '약점 ' + P.concepts.filter(function(c){ return c.tag === '약점'; }).length], ['mid', '보통'], ['strong', '강점'], ['all', '전체 ' + P.concepts.length]]) +
      '<button type="button" class="ex-chip" id="exConMore">' + (EXM.conMore ? '간단히' : '자세히') + '</button></div>' +
      '<p class="d">형성평가 정답률 순으로 줄 세워 아래 1/3은 <b>약점</b>, 위 1/3은 <b>강점</b>이에요 (상대 순위). 점이 왼쪽일수록 상대적으로 약해요.</p>' +
      (conRows ? '<div class="an-scroll"><table class="an-t ex-con"><tr><th>개념</th><th></th><th>상대 위치</th><th class="num">정답률</th>' + (EXM.conMore ? '<th class="num">오개념 선택</th><th>자주 고른 오개념</th>' : '') + '<th class="num">권장 문항</th><th class="num">배점</th></tr>' + conRows + '</table></div>'
        : '<div class="empty">이 보기에 해당하는 개념이 없어요.</div>') + '</div>' +
    '<div class="an-card"><div class="row" style="gap:8px"><h3 style="margin:0;flex:1">출제 포인트 (AI)</h3><button class="btn" id="exAdvice" style="flex:none">' + (EXM.advice ? '다시 받기' : 'AI 출제 포인트 받기') + '</button></div>' +
      '<div id="exAdviceBox" style="margin-top:8px">' + exAdviceHtml() + '</div></div>' +
    '<div class="an-card"><div class="row" style="gap:8px;margin-bottom:8px"><h3 style="margin:0;flex:1">문항 구성표</h3><span class="an-sub" style="flex:none">배점 합계 <b id="exSum"></b></span>' +
      '<button class="btn" id="exCopy" style="flex:none">표 복사</button></div>' +
      '<div class="an-scroll"><table class="an-t" style="min-width:960px"><tr><th class="num">번호</th><th>유형</th><th>출제 내용</th><th>권장 난이도</th><th>근거</th><th class="num">배점</th><th>추천 문항 (문제은행)</th></tr>' +
      P.slots.map(function(s, i){
        return '<tr><td class="num">' + s.no + '</td><td>' + exKindTag(s) + '</td><td><b>' + esc(s.label) + '</b>' + (s.kind !== 'concept' && s.conceptNames.length ? '<div class="an-sub">' + s.conceptNames.map(esc).join(', ') + '</div>' : '') + '</td>' +
          '<td style="max-width:220px">' + (s.level ? '<span class="ex-lv ex-lv-' + ({'쉬움':'e', '보통':'m', '어려움':'h'})[s.level] + '">' + esc(s.level) + '</span><div class="an-sub" style="margin-top:3px">' + esc(s.levelWhy || '') + '</div>' : '-') + '</td>' +
          '<td class="an-sub" style="max-width:260px">' + esc(s.evidence) + '</td>' +
          '<td class="num"><input class="inp an-pts" type="number" step="' + P.step + '" min="0" data-pts="' + i + '" value="' + s.points + '"></td>' +
          '<td><select class="inp" data-pick="' + i + '" style="min-width:180px"><option value="">직접 출제</option>' + s.candidates.map(function(c){
            return '<option value="' + esc(c.id) + '"' + (c.id === s.pick ? ' selected' : '') + ' title="' + esc(c.why) + '">' + esc(c.title) + '</option>'; }).join('') + '</select>' +
            (s.pick ? '<div class="an-sub" data-why="' + i + '">' + esc((s.candidates.find(function(c){ return c.id === s.pick; }) || {}).why || '') + '</div>' : '') + '</td></tr>';
      }).join('') + '</table></div>' +
      '<details style="margin-top:12px"><summary class="an-sub" style="cursor:pointer">추천 방식</summary><div class="an-sub" style="line-height:1.7;margin-top:6px">' +
        '· 개념의 강약: 출제 범위 개념을 정답률(평활값 (정답+1)/(응답+2)) 순으로 줄 세운 <b>상대 순위</b>예요. 아래 1/3 약점 · 위 1/3 강점 · 나머지 보통, 응답이 없는 개념은 자료 없음.<br>' +
        '· 오개념: 선택 횟수 대신 <b>선택 비율</b>(고른 응답 ÷ 노출된 응답)로 비교해요. 비율 순위 위쪽 1/3이면서 2회 이상 고른 오개념을 "자주 고름"으로 보고 먼저 확인하길 권해요.<br>' +
        '· 권장 난이도: 개념의 상대 위치와 시험 목적에 따라 쉬움 · 보통 · 어려움 중 하나를 권해요. 실제 난이도는 선생님이 문항을 보고 정해 주세요.<br>' +
        '· 시험 목적마다 개념 가중치(약점 · 보통 · 강점), 오개념 문항 비율, 배점 가중치, 전 개념 포함 여부가 달라요. 문항 수와 배점은 최대 잔여법으로 정수(배점 단위) 배분해요.<br>' +
        '· 추천 문항: 개념(또는 오개념)이 맞는 문항 중, 약점 · 보통 개념이면 자주 고른 오개념을 오답 선지로 담은 문항을 우선하고, 형성평가에서 역변별이 나온 문항은 뒤로 미뤄요.<br>' +
        '· 학생 개인의 능력 추정, 문항의 절대 난이도, 예상 점수 분포는 쓰지 않아요.</div></details></div>';
  var sum = function(){ var t = P.slots.reduce(function(a, s){ return a + Number(s.points || 0); }, 0); $('#exSum').textContent = (Math.round(t * 100) / 100) + ' / ' + P.total + '점'; $('#exSum').style.color = Math.abs(t - P.total) > 1e-6 ? 'var(--danger)' : ''; };
  sum();
  $$('[data-pts]').forEach(function(x){ x.oninput = function(){ P.slots[Number(x.dataset.pts)].points = Number(x.value) || 0; sum(); }; });
  $$('[data-pick]').forEach(function(x){ x.onchange = function(){
    var s = P.slots[Number(x.dataset.pick)];
    s.pick = x.value;
    var w = $('[data-why="' + x.dataset.pick + '"]');
    var c = s.candidates.find(function(y){ return y.id === s.pick; });
    if (w) w.textContent = c ? c.why : '';
  }; });
  $('#exAdvice').onclick = exAdvice;
  $$('[data-mv]', out).forEach(function(b){ b.onclick = function(){ EXM.misView = b.dataset.mv; exRenderOut(); }; });
  $$('[data-cv]', out).forEach(function(b){ b.onclick = function(){ EXM.conView = b.dataset.cv; exRenderOut(); }; });
  $('#exConMore').onclick = function(){ EXM.conMore = !EXM.conMore; exRenderOut(); };
  $('#exCopy').onclick = function(){
    var title = function(id){ var q = S.questions.find(function(x){ return x.id === id; }); return q ? q.title : ''; };
    var lines = [['번호', '유형', '출제 내용', '관련 개념', '권장 난이도', '배점', '추천 문항', '근거'].join('\t')].concat(P.slots.map(function(s){
      return [s.no, s.kind === 'concept' ? s.tag + ' 개념' : '오개념 확인', s.label, s.conceptNames.join(', '), s.level || '', s.points, title(s.pick) || '직접 출제', s.evidence].join('\t');
    }));
    anCopy(lines.join('\n'));
  };
}
function exAdviceHtml(){
  var a = EXM.advice;
  if (!a) return '<div class="an-sub">개념의 상대적 강약 · 오개념 선택 비율과 위 구성표를 바탕으로 AI가 출제할 때 강조할 점을 짧게 정리해 줘요.</div>';
  return '<ul class="an-advice">' + a.points.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
    (a.cautions.length ? '<div class="an-sub"><b>주의</b></div><ul class="an-advice">' + a.cautions.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '');
}
async function exAdvice(){
  var P = EXM.plan;
  var tagged = function(tag){ return P.concepts.filter(function(c){ return c.tag === tag; }).map(function(c){ return c.name + ' (약한 순 ' + c.rank + '/' + c.k + ')'; }); };
  var brief = {
    subject:EXM.subject, purpose:P.purposeLabel, items:P.n, total:P.total,
    weakConcepts:tagged('약점'), middleConcepts:tagged('보통'), strongConcepts:tagged('강점'),
    frequentMisconceptions:P.miscons.filter(function(m){ return m.frequent; }).slice(0, 8).map(function(m){ return {name:m.name, selectRate:anPct(m.rate), concepts:m.concepts}; }),
    designPrinciples:P.design.principles,
    blueprint:P.slots.map(function(s){ return {no:s.no, type:s.kind === 'concept' ? s.tag + ' 개념' : '오개념 확인', content:s.label, concepts:s.conceptNames, points:s.points, evidence:s.evidence}; })
  };
  var a = await call('examAdvice', brief);
  if (S.view !== 'exam' || EXM.plan !== P) return;
  EXM.advice = a;
  $('#exAdviceBox').innerHTML = exAdviceHtml();
  $('#exAdvice').textContent = '다시 받기';
}
