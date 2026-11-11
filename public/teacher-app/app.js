/*
 * 교사 화면 (문제은행 · 수업하기 · 개념지도 · 설정) — legacy/gas/Index.html 의 스크립트를 거의 그대로 옮긴 것.
 * src/app/teacher/teacher-app.tsx 가 app.js → analysis.js 순서로 일반 <script> 로 불러와요 (두 파일은 전역 범위를 공유).
 * 바뀐 점: 서버 호출(call → POST /api/teacher), 로그인(Supabase), 학생 주소(/student), 위젯 주소(/teacher/widget),
 *          설정의 OpenAI 키 입력(→ Vercel 환경변수), 로그아웃(POST /auth/signout).
 * 추가: 브라우저 뒤로 가기(화면 · 폴더 · 편집 창), 학생 목록 관리, 선지별 오개념 여러 개, 개념 지도 확대 · 이동 · 자동 배치.
 */
const APP_URL_TPL = location.origin;
/* ===================== 기본 ===================== */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const DAYS = ['일','월','화','수','목','금','토'];
const CIRC = ['①','②','③','④','⑤','⑥','⑦','⑧'];
const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch(e){} },
  del(k){ try { localStorage.removeItem(k); } catch(e){} }
};
const S = {
  view:'bank', params:{}, folders:[], questions:[], classes:[], semesters:[], holidays:[], concepts:[], settings:{}, today:'', appUrl:'',
  cwd:'', search:'', sel:{f:new Set(), q:new Set()}, ed:null, miscons:[], chat:[], chatLog:null, aiOn:true, aiImg:false, mkSubject:'',
  classTab:'active', homerooms:[]
};

let busyN = 0;
function busy(d){ busyN = Math.max(0, busyN + d); $('#busy').classList.toggle('on', busyN > 0); }
/** 교사 기능 호출: POST /api/teacher { fn, args } (기존 GAS 호출 방식 대체) */
async function call(fn, ...args){
  busy(1);
  try {
    let res;
    try {
      res = await fetch('/api/teacher', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({fn, args}), cache:'no-store'});
    } catch (e) { throw new Error('인터넷 연결을 확인해 주세요.'); }
    if (res.status === 401) { location.href = '/login?next=/teacher'; throw new Error('AUTH: 다시 로그인해 주세요.'); }
    const j = await res.json().catch(() => null);
    if (!j || !j.ok) throw new Error((j && j.error) || ('서버 오류 (' + res.status + ')'));
    return j.data;
  } catch (e) {
    const m = (e && e.message) || String(e);
    if (m.indexOf('AUTH') < 0) toast(m.replace(/^Error:\s*/, ''), true);
    throw e;
  } finally { busy(-1); }
}
function toast(msg, err){
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => t.remove(), err ? 4200 : 2600);
}
function modal({title, body, buttons, wide, onOpen}){
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><div class="modal-h">${esc(title || '')}</div><div class="modal-b">${body || ''}</div><div class="modal-f"></div></div>`;
  const f = $('.modal-f', bg);
  const close = () => bg.remove();
  (buttons || [{label:'닫기'}]).forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || (b.primary ? 'primary' : ''));
    el.textContent = b.label;
    el.onclick = async () => {
      if (bg.dataset.busy) return;
      if (b.onClick) {
        bg.dataset.busy = 1; $$('.modal-f button', bg).forEach(x => x.disabled = true);
        let r;
        try { r = await b.onClick(bg); } catch(e){ r = false; }
        delete bg.dataset.busy; $$('.modal-f button', bg).forEach(x => x.disabled = false);
        if (r === false) return;
      }
      close();
    };
    f.appendChild(el);
  });
  bg.addEventListener('mousedown', e => { if (e.target === bg) bg.dataset.down = 1; });
  bg.addEventListener('click', e => { if (e.target === bg && bg.dataset.down) close(); });
  $('#modalRoot').appendChild(bg);
  // Enter = 주요 버튼(확인 · 닫기 · 저장 …). 맨 위 창일 때만, 여러 줄 입력 · 자기 Enter 동작이 있는 칸 · 버튼에 포커스가 있을 땐 그대로
  const onKey = e => {
    if (!bg.isConnected) return document.removeEventListener('keydown', onKey);
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
    if ($('#modalRoot').lastElementChild !== bg || bg.dataset.busy) return;
    const t = e.target;
    if (t && bg.contains(t) && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable || (t.matches && t.matches('input,select') && t.onkeydown))) return;
    const btns = $$('.modal-f button', bg), main = btns.filter(x => x.classList.contains('primary')).pop() || (btns.length === 1 ? btns[0] : null);
    if (!main || main.disabled) return;
    e.preventDefault(); main.click();
  };
  setTimeout(() => { if (bg.isConnected) document.addEventListener('keydown', onKey); }, 0);   // 창을 연 그 Enter 로 바로 수락되지 않게
  // 뒤쪽 화면(편집 창 등)에 있던 포커스는 풀어서, Enter 가 뒤쪽 칸이나 버튼으로 가지 않게
  if (document.activeElement && document.activeElement !== document.body && !bg.contains(document.activeElement)) document.activeElement.blur();
  if (onOpen) onOpen(bg);
  const first = $('input,textarea,select', $('.modal-b', bg));
  if (first) setTimeout(() => first.focus(), 30);
  return {el: bg, close};
}
function confirmBox(msg, okLabel, danger){
  return new Promise(res => {
    modal({title:'확인', body:`<div class="modal-msg">${esc(msg)}</div>`, buttons:[
      {label:'취소', onClick:() => res(false)},
      {label:okLabel || '확인', cls: danger ? 'primary start' : 'primary', onClick:() => res(true)}
    ]});
  });
}
function promptBox(title, value, placeholder){
  return new Promise(res => {
    let done = false;
    const m = modal({title, body:`<input class="inp" id="pbIn" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}">`, buttons:[
      {label:'취소', onClick:() => { done = true; res(null); }},
      {label:'확인', primary:true, onClick:(bg) => { done = true; res($('#pbIn', bg).value.trim()); }}
    ]});
    $('#pbIn', m.el).addEventListener('keydown', e => { if (e.key === 'Enter') { done = true; res(e.target.value.trim()); m.close(); } });
  });
}
function fmtDate(ds){ if (!ds) return ''; const d = new Date(ds + 'T00:00:00'); return `${d.getMonth()+1}/${d.getDate()}(${DAYS[d.getDay()]})`; }
function pctStr(r){ return r == null ? '-' : Math.round(r * 100) + '%'; }
function appUrl(){ return S.appUrl || APP_URL_TPL || ''; }
function studentUrl(){ return appUrl() + '/student'; }

/* ===================== 아이콘 ===================== */
const IC = {
  bank:'<svg viewBox="0 0 24 24"><path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5M8 13h8M8 17h5"/></svg>',
  class:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4M10 8l4 2-4 2z"/></svg>',
  stats:'<svg viewBox="0 0 24 24"><circle cx="6" cy="17" r="2.2"/><circle cx="12" cy="7" r="2.2"/><circle cx="18" cy="15" r="2.2"/><path d="M7.4 15.3l3.3-6.4M13.8 8.4l3 5"/></svg>',
  exam:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 3v2h6V3M8.5 11l2 2 4-4M8.5 17h7"/></svg>',
  student:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M10 18h4"/></svg>',
  settings:'<svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  folder:'<svg viewBox="0 0 24 24"><path d="M2 6.5A1.5 1.5 0 013.5 5H9l2 2.2h9.5A1.5 1.5 0 0122 8.7v9.8a1.5 1.5 0 01-1.5 1.5h-17A1.5 1.5 0 012 18.5z" fill="#ffc94d" stroke="#e0a520" stroke-width="1"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
  play:'<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>',
  info:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#555" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5v.5"/></svg>'
};
const SUBJ_ICON = {
  math:'<svg viewBox="0 0 120 100"><path d="M18 18v66h78z"/><path d="M8 22v62M4 26l4-6 4 6M4 80l4 6 4-6" stroke-dasharray="5 5"/><path d="M22 92h70" stroke-dasharray="5 5"/><path d="M30 10l70 66" stroke-dasharray="5 5"/><path d="M18 70a14 14 0 0114 14" stroke-dasharray="2 3"/></svg>',
  phys:'<svg viewBox="0 0 120 100"><ellipse cx="60" cy="50" rx="44" ry="16"/><ellipse cx="60" cy="50" rx="44" ry="16" transform="rotate(60 60 50)"/><ellipse cx="60" cy="50" rx="44" ry="16" transform="rotate(-60 60 50)"/><circle cx="60" cy="50" r="6" fill="#fff"/></svg>',
  chem:'<svg viewBox="0 0 120 100"><path d="M48 10h24M52 10v28L28 86h64L68 38V10"/><path d="M36 70h48"/><circle cx="56" cy="78" r="3"/><circle cx="68" cy="74" r="2"/></svg>',
  bio:'<svg viewBox="0 0 120 100"><path d="M40 10c40 20 0 60 40 80M80 10c-40 20 0 60-40 80"/><path d="M46 22h28M44 38h32M44 62h32M46 78h28"/></svg>',
  earth:'<svg viewBox="0 0 120 100"><circle cx="60" cy="50" r="38"/><path d="M22 50h76M60 12c-16 20-16 56 0 76M60 12c16 20 16 56 0 76"/></svg>',
  book:'<svg viewBox="0 0 120 100"><path d="M60 20c-14-8-30-8-44-4v66c14-4 30-4 44 4 14-8 30-8 44-4V16c-14-4-30-4-44 4zM60 20v66"/></svg>'
};
/** 로고: 매너티 얼굴 (public/brand/manatee-face.png) */
const MANATEE = `<img src="/brand/manatee-face.png" alt="manatee" draggable="false">`;
function subjStyle(s){
  s = s || '';
  const T = [['수학','#0a8ff0','math'],['물리','#3d5afe','phys'],['전자기','#3d5afe','phys'],['양자','#3d5afe','phys'],['화학','#00a37a','chem'],['생명','#2e9d4a','bio'],['생물','#2e9d4a','bio'],
    ['지구','#0b7fa8','earth'],['과학','#5a4fcf','phys'],['에너지','#3d5afe','phys'],['영어','#e8710a','book'],['국어','#d93a5e','book']];
  const hit = T.find(t => s.indexOf(t[0]) >= 0);
  return hit ? {color:hit[1], icon:SUBJ_ICON[hit[2]]} : {color:'#0a8ff0', icon:SUBJ_ICON.book};
}
function subjTitle(s, base){
  s = String(s || '');
  const n = s.replace(/\s/g, '').length;
  const size = n <= 3 ? base : n <= 5 ? Math.round(base * .82) : n <= 7 ? Math.round(base * .68) : Math.round(base * .58);
  let html = esc(s);
  if (n >= 8 && s.trim().indexOf(' ') > 0) {
    const w = s.trim().split(/\s+/), half = s.length / 2;
    let a = '', b = '';
    w.forEach(x => { if (!b && (!a || (a + ' ' + x).length <= half + 2)) a = (a + ' ' + x).trim(); else b = (b + ' ' + x).trim(); });
    html = esc(a) + (b ? '<br>' + esc(b) : '');
  }
  return '<span class="cc-subj" style="font-size:' + size + 'px">' + html + '</span>';
}

/* ===================== 문제 렌더링 ===================== */
function imgTag(url){
  if (!url) return '';
  return `<img src="${esc(url)}" onerror="if(!this.dataset.r){this.dataset.r=1;this.src=this.src.replace('drive.google.com/thumbnail?id=','lh3.googleusercontent.com/d/').replace(/&sz=.*/,'');}">`;
}
/** 객관식 정답 번호 목록 ('1|3' → ['1','3']) */
function ansList(q){ return String((q && q.answer) || '').split('|').map(x => x.trim()).filter(Boolean); }
function isAns(q, i){ return ansList(q).includes(String(i + 1)); }
function conceptName(id){ const c = S.concepts.find(x => x.id === id); return c ? c.name : null; }
function renderQ(q, opt){
  opt = opt || {};
  let h = `<div class="qv">`;
  if (q.title && !opt.noTitle) h += `<div class="qv-title">${esc(q.title)}</div>`;
  h += `<div class="qv-stem">${esc(q.stem || '(문항 내용 없음)')}</div>`;
  h += imgTag(q.imageUrl);
  if (q.type === 'mc') {
    (q.choices || []).forEach((c, i) => {
      const ans = opt.answer && isAns(q, i);
      const ci = (q.choiceImages || [])[i];
      h += `<div class="qv-ch ${ans ? 'ans' : ''} ${ci ? 'pic' : ''}"><span class="qv-n">${CIRC[i] || (i+1)+'.'}</span>${ci ? imgTag(ci) : ''}${c ? `<span>${esc(c)}</span>` : ''}</div>`;
      const mn = opt.mis && !ans ? choiceMisNames(q, i) : [];
      if (mn.length) h += `<div class="qv-mis">오개념: ${mn.map(esc).join(' · ')}</div>`;
    });
  }
  if (opt.answer) {
    const a = q.type === 'mc' ? (q.answer ? ansList(q).map(x => CIRC[Number(x) - 1] || x).join(', ') + (ansList(q).length > 1 ? ' (모두 골라야 정답)' : '') : '미지정') : (q.answer || '미지정').split('|').join(' / ');
    h += `<div class="qv-ans">정답: ${esc(a)}</div>`;
  }
  if (opt.concepts) {
    const names = (q.conceptIds || []).map(conceptName).filter(Boolean);
    const nn = q.newConcepts || [];
    if (names.length || nn.length) h += `<div class="qv-con">${names.map(n => `<span class="chip">${esc(n)}</span>`).join('')}${nn.map(n => `<span class="chip new">+ ${esc(n)}</span>`).join('')}</div>`;
  }
  return h + '</div>';
}

/* ===================== 로그인 ===================== */

async function loadAll(){
  const b = await call('bootstrap');
  Object.assign(S, b);
  if (S.chatLog === null) {
    S.chatLog = [{who:'ai', text:'안녕하세요! 어떤 문제를 만들어 드릴까요?\n예) "중2 과학, 역학적 에너지 보존 개념을 확인하는 5지선다 문제 하나 만들어줘"'}];
    if (!S.settings.hasKey) S.chatLog.push({who:'sys', text:'OpenAI API 키가 아직 없어요. Vercel 환경변수 OPENAI_API_KEY 를 설정하면 AI 기능을 쓸 수 있어요.'});
  }
  updateSubjList();
}
/** 과목 순서: 이 순서대로, 목록에 없는 과목은 뒤에 가나다순 */
const SUBJECT_ORDER = ['중학 과학1', '중학 과학2', '중학 과학3', '통합과학', '물리학', '역학과 에너지', '전자기와 양자'];
function subjSort(a, b){
  const i = SUBJECT_ORDER.indexOf(a), j = SUBJECT_ORDER.indexOf(b);
  return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b, 'ko');
}
function allSubjects(){
  const set = new Set();
  S.classes.forEach(c => c.subject && set.add(c.subject));
  S.concepts.forEach(c => c.subject && set.add(c.subject));
  S.questions.forEach(q => q.subject && set.add(q.subject));
  return Array.from(set).sort(subjSort);
}
function activeSubjects(){
  const set = new Set();
  S.classes.filter(c => c.status !== 'ended').forEach(c => c.subject && set.add(c.subject));
  return Array.from(set).sort(subjSort);
}
/** 개념 지도 과목 = 교사가 만든 클래스의 과목 + 개념 지도가 있는 과목 */
function mapSubjects(){
  const set = new Set();
  S.classes.forEach(c => c.subject && set.add(c.subject));
  S.concepts.forEach(c => c.subject && set.add(c.subject));
  return Array.from(set).sort(subjSort);
}
function updateSubjList(){ $('#subjList').innerHTML = allSubjects().map(s => `<option value="${esc(s)}">`).join(''); }

/* ===================== 내비게이션 ===================== */
const NAV = [
  {key:'bank', label:'문제은행', icon:IC.bank, title:'문제은행', direct:true, sub:() => [
    {label:'문제 만들기', desc:'폴더 관리 · AI 문제 제작', go:() => go('bank')}
  ]},
  {key:'classes', label:'수업하기', icon:IC.class, title:'수업하기', sub:() => {
    const act = S.classes.filter(c => c.status !== 'ended');
    return [
      {label:'클래스 전체보기', desc:'운영 중 · 종료된 클래스', go:() => go('classes', {tab:'active'})},
      {label:'학생 목록 관리', desc:'학교 · 학년 · 반 · 학생 명단', go:() => go('roster')},
      {sep:true},
      {head:'운영 중인 클래스', point:true},
      ...(act.length ? act.map(c => ({label:c.name, desc:`${c.semesterName} · ${c.subject}`, go:() => go('classLessons', {classId:c.id})})) : [{empty:'아직 클래스가 없어요'}])
    ];
  }},
  {key:'stats', label:'통계', icon:IC.stats, title:'통계', sub:() => {
    const subs = mapSubjects();
    return [
      {head:'개념 지도', point:true},
      ...(subs.length ? subs.map(s => ({label:s, plain:true, go:() => go('stats', {subject:s})})) : [{empty:'클래스를 만들면 과목이 여기에 나타나요'}]),
      {sep:true},
      {label:'형성평가 분석', desc:'오개념 · 개념 연결 · 오답 통계', go:() => go('analysis')}
    ];
  }},
  {key:'exam', label:'정기고사 출제 가이드', icon:IC.exam, title:'정기고사 출제 가이드', direct:true, sub:() => [
    {label:'정기고사 출제 가이드', desc:'시험 목적별 문항 구성 추천', go:() => go('exam')}
  ]}
];
const NAV_BOTTOM = [
  {key:'student', label:'학생화면', icon:IC.student, action:() => window.open(studentUrl(), '_blank')},
  {key:'settings', label:'설정', icon:IC.settings, action:() => go('settings')}
];
// flyPin: 메뉴를 클릭해 하위 메뉴를 고정해 둔 상태 (마우스가 벗어나도 닫히지 않음)
let flyTimer = null, flyKey = null, flyPin = false;
function renderNav(){
  const nav = $('#nav');
  const item = n => `<div class="nav-item ${navActive(n.key) ? 'active' : ''}" data-key="${n.key}">${n.icon}<span>${n.label}</span></div>`;
  nav.innerHTML = `<div class="logo" title="처음 화면으로"><div class="logo-mark">${MANATEE}</div><small>manatee</small></div>` +
    NAV.map(item).join('') + '<div class="nav-spacer"></div>' + NAV_BOTTOM.map(item).join('') + '<div style="height:12px"></div>';
  $$('.nav-item', nav).forEach(el => {
    const key = el.dataset.key;
    const n = NAV.find(x => x.key === key);
    // 고정된 동안에는 마우스를 올리거나 벗어나도 그대로 둠
    // 하위 메뉴가 하나뿐인 메뉴(문제은행 · 정기고사 출제 가이드)는 펼치지 않고 클릭하면 바로 이동
    el.addEventListener('mouseenter', () => { if (flyPin) return; if (n && !n.direct) openFly(n, el); else closeFly(0); });
    el.addEventListener('mouseleave', () => { if (!flyPin) closeFly(250); });
  });
}
// 바 클릭: 고정된 하위 메뉴가 있으면 (어디를 누르든) 접고, 없으면 누른 메뉴로 이동하면서 하위 메뉴를 고정
$('#nav').addEventListener('click', e => {
  if (flyPin) return closeFly(0);
  if (e.target.closest('.logo')) { closeFly(0); return go('home'); }
  const el = e.target.closest('.nav-item');
  if (!el) return;
  const key = el.dataset.key;
  const n = NAV.find(x => x.key === key);
  if (!n) { NAV_BOTTOM.find(x => x.key === key).action(); return closeFly(0); }
  if (n.direct) { closeFly(0); return n.sub()[0].go(); }
  if (key === 'stats') go('stats', {});
  else n.sub().find(s => s.go).go();
  const cur = $(`.nav-item[data-key="${key}"]`);
  if (cur) { openFly(n, cur); flyPin = true; }
});
// 고정된 하위 메뉴 밖(바 · 메뉴 제외) 아무 곳이나 누르면 접기
document.addEventListener('click', e => {
  if (flyPin && !e.target.closest('#flyout, #nav')) closeFly(0);
});
function navActive(k){
  if (k === 'bank') return S.view === 'bank';
  if (k === 'classes') return ['classes', 'classLessons', 'lesson', 'roster'].includes(S.view);
  if (k === 'stats') return ['stats', 'analysis'].includes(S.view);
  return S.view === k;
}
function openFly(n, el){
  clearTimeout(flyTimer);
  flyKey = n.key;
  $$('.nav-item').forEach(x => x.classList.toggle('hover', x === el));
  const f = $('#flyout');
  f.innerHTML = `<h2>${esc(n.title)}</h2>` + n.sub().map((s, i) => {
    if (s.sep) return '<div class="fly-sep"></div>';
    if (s.head) return `<div class="fly-head${s.point ? ' point' : ''}">${esc(s.head)}</div>`;
    if (s.empty) return `<div class="fly-empty">${esc(s.empty)}</div>`;
    return `<a class="fly-link${s.plain ? ' plain' : ''}" data-i="${i}">${esc(s.label)}</a>${s.desc ? `<div class="fly-desc">${esc(s.desc)}</div>` : ''}`;
  }).join('');
  const subs = n.sub();
  $$('.fly-link', f).forEach(a => a.onclick = () => subs[a.dataset.i].go());
  f.classList.add('open');
}
function closeFly(ms){
  clearTimeout(flyTimer);
  flyPin = false;
  flyTimer = setTimeout(() => { $('#flyout').classList.remove('open'); $$('.nav-item').forEach(x => x.classList.remove('hover')); flyKey = null; }, ms);
}
$('#flyout').addEventListener('mouseenter', () => clearTimeout(flyTimer));
$('#flyout').addEventListener('mouseleave', () => { if (!flyPin) closeFly(200); });

function go(view, params, opt){
  S.view = view; S.params = params || {};
  if (view !== 'stats') stopStats();
  if (!(opt && opt.pop)) histPush({view, params:S.params, cwd:S.cwd, ed:false});
  $$('.nav-item').forEach(x => x.classList.toggle('active', navActive(x.dataset.key)));
  const main = $('#main');
  main.innerHTML = '';
  ({home:renderHome, bank:renderBank, classes:renderClasses, classLessons:renderClassLessons, lesson:renderLesson, roster:renderRoster,
    stats:renderStats, exam:() => renderExam(), analysis:() => renderAnalysis(), settings:renderSettings}[view] || renderBank)();
  window.scrollTo(0, 0);
}

/* ---------- 브라우저 뒤로 가기 / 앞으로 가기 (화면 · 문제은행 폴더 · 문제 편집 창) ---------- */
function histKey(st){ return st ? JSON.stringify([st.view, st.params || {}, st.view === 'bank' ? st.cwd || '' : '', !!st.ed]) : ''; }
function histPush(st){
  try {
    if (histKey(history.state) === histKey(st)) history.replaceState(st, '');   // 같은 화면 다시 그리기는 기록하지 않음
    else history.pushState(st, '', '#' + st.view);
  } catch(e){}
}
window.addEventListener('popstate', e => {
  const st = e.state;
  if (!st || !st.view) return;
  closeFly(0);
  $$('.modal-bg').forEach(m => m.remove());
  // 편집 창이 열려 있으면 먼저 접기 (내용은 그대로 · 아래 줄의 '접어 둔 편집 창'에서 다시 열기)
  if (S.ed && !S.ed.min && !st.ed) { S.ed.min = true; drawEd(); }
  if (st.view === 'bank' && S.view === 'bank') {
    if ((st.cwd || '') !== S.cwd) { S.cwd = st.cwd || ''; S.sel.f.clear(); S.sel.q.clear(); S.search = ''; renderExplorer(); }
    if (st.ed && S.ed && S.ed.min) { S.ed.min = false; drawEd(); }
    return;
  }
  if (st.view === 'bank') S.cwd = st.cwd || '';
  go(st.view, st.params || {}, {pop:true});
});
function openFolder(id){
  S.cwd = id || ''; S.sel.f.clear(); S.sel.q.clear(); S.search = '';
  histPush({view:'bank', params:{}, cwd:S.cwd, ed:false});
  renderExplorer();
}
/** 편집 창 접기: 편집 창을 열 때 쌓은 기록이 있으면 뒤로 가기로 (그러면 기록도 깔끔) */
function minimizeEditor(){
  if (!S.ed) return;
  if (history.state && history.state.ed) return history.back();
  S.ed.min = true; drawEd();
}

/* =====================================================================
 *  0. 대문 (로고를 누르면 여기로)
 * ===================================================================== */
/** 대문 [튜토리얼 영상 보기] 영상 — public/video/ 아래 파일 경로, 또는 유튜브 주소(youtu.be/… · watch?v=…)로 바꿔도 돼요.
 *  파일을 못 불러오면 '준비 중' 안내가 나와요. */
const TUTORIAL_VIDEO = '/video/manatee-tutorial.mp4';
function openTutorial(){
  const yt = TUTORIAL_VIDEO.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  const player = yt
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0" title="튜토리얼 영상" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`
    : `<video src="${esc(TUTORIAL_VIDEO)}" controls autoplay playsinline></video>`;
  const m = modal({title:'튜토리얼 영상', wide:true, body:`<div class="tut-video">${player}</div>`});
  $('.modal', m.el).classList.add('tut');   // 창을 닫으면 영상 요소째 사라져서 재생도 멈춰요
  const v = $('.tut-video video', m.el);
  if (v) v.onerror = () => { v.parentElement.innerHTML = '<div class="tut-empty">튜토리얼 영상을 준비하고 있어요.<br>조금만 기다려 주세요!</div>'; };
}
async function renderHome(){
  const main = $('#main');
  const cards = [
    ['bank', IC.bank, '문제은행', '폴더로 문제를 관리하고, AI 챗봇과 함께 문제를 만들어요.', () => go('bank')],
    ['classes', IC.class, '수업하기', '클래스와 수업 차시를 만들고, 수업 위젯으로 실시간 형성평가를 해요.', () => go('classes', {tab:'active'})],
    ['stats', IC.stats, '통계', '개념 지도와 형성평가 분석으로 약한 개념과 오개념을 확인해요.', () => go('stats', {})],
    ['exam', IC.exam, '정기고사 출제 가이드', '형성평가 결과를 바탕으로 시험 문항 구성을 추천받아요.', () => go('exam')]
  ];
  const act = S.classes.filter(c => c.status !== 'ended');
  main.innerHTML = `<div class="home">
    <div class="home-hero"><div class="home-logo">${MANATEE}</div>
      <div class="home-hero-txt"><h1>manatee</h1><p>개념 지도와 오개념으로 수업을 설계하고, 형성평가로 학생의 생각을 확인하는 수업 도구</p></div>
      <button class="home-tut" id="homeTut" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>튜토리얼 영상 보기</button></div>
    <div class="home-cards">${cards.map((c, i) => `<button class="home-card" data-hc="${i}">${c[1]}<b>${esc(c[2])}</b><span>${esc(c[3])}</span></button>`).join('')}</div>
    <div class="home-row">
      <div class="home-box"><h3>오늘 · 다가오는 수업</h3><div id="homeUp" class="an-sub">불러오는 중…</div></div>
      <div class="home-box"><h3>한눈에 보기</h3><div class="home-kpis">
        <div><b>${S.questions.length}</b><span>문제</span></div>
        <div><b>${act.length}</b><span>운영 중 클래스</span></div>
        <div><b>${conceptNodes().length}</b><span>개념</span></div>
        <div><b>${S.miscons.length}</b><span>오개념</span></div></div></div>
    </div>
    <footer class="home-foot"><nav><a href="/terms" target="_blank">이용약관</a><span>·</span><a href="/privacy" target="_blank"><b>개인정보처리방침</b></a></nav>
      <p>manatee · 서울대학교 물리교육과 박근형 · 양지운 · 차혁찬 · 최연서</p><p>SNU TEIC AIED Challenge 출품작 · © 2026</p></footer></div>`;
  $$('[data-hc]', main).forEach(b => b.onclick = () => cards[b.dataset.hc][4]());
  $('#homeTut', main).onclick = openTutorial;
  let list = [];
  try { list = await call('upcoming'); } catch(e){}
  const box = $('#homeUp');
  if (!box || S.view !== 'home') return;
  box.innerHTML = list.length ? list.slice(0, 6).map(l => `<div class="home-up" data-l="${l.id}"><span class="pill">${esc(l.subject || '')}</span>
      <span class="t"><b>${esc(l.className)}</b> · ${l.no}차시 <small>${l.date === S.today ? '오늘' : fmtDate(l.date)} ${esc(l.time)}</small></span>
      <button class="btn" data-open="${l.id}">문제 구성</button><button class="btn start" data-start="${l.id}">${IC.play} 수업시작</button></div>`).join('')
    : '다가오는 수업 차시가 없어요. [수업하기]에서 클래스를 만들어 보세요.';
  $$('[data-open]', box).forEach(b => b.onclick = () => go('lesson', {lessonId:b.dataset.open}));
  $$('[data-start]', box).forEach(b => b.onclick = () => startClass(b.dataset.start));
}

/* =====================================================================
 *  1. 문제은행
 * ===================================================================== */
function renderBank(){
  $('#main').innerHTML = `<div class="bank">
    <section class="explorer" id="explorer"><div id="exMain"></div>
      <div id="taskbar"><span class="tb-label">최소화된 문제</span></div></section>
    <section class="maker" id="maker"></section></div>`;
  bindExplorer();
  renderExplorer();
  renderMaker();
  drawEd();   // 열려 있던 편집 창 다시 붙이기 (없으면 아래 안내줄만)
}
function folderPath(id){
  const out = [];
  let cur = S.folders.find(f => f.id === id);
  let guard = 0;
  while (cur && guard++ < 50) { out.unshift(cur); cur = S.folders.find(f => f.id === cur.parentId); }
  return out;
}
function folderName(id){ if (!id) return '내 문제은행'; const f = S.folders.find(x => x.id === id); return f ? f.name : '내 문제은행'; }
function countIn(fid){
  return {q:S.questions.filter(q => (q.folderId || '') === fid).length, f:S.folders.filter(f => (f.parentId || '') === fid).length};
}
/** 폴더와 그 안의 모든 하위 폴더에 든 문제 수 */
function countDeep(fid){
  const ids = new Set([fid]);
  for (let grew = true; grew;) { grew = false; S.folders.forEach(f => { if (ids.has(f.parentId || '') && !ids.has(f.id)) { ids.add(f.id); grew = true; } }); }
  return S.questions.filter(q => ids.has(q.folderId || '')).length;
}
/** 문제에 연결된 개념 이름 (문제 목록의 개념 키워드) */
function qConceptNames(q){ return (q.conceptIds || []).map(conceptName).filter(Boolean); }
function renderExplorer(){
  if (S.cwd && !S.folders.find(f => f.id === S.cwd)) S.cwd = '';
  const crumbs = [{id:'', name:'내 문제은행'}].concat(folderPath(S.cwd));
  const kw = S.search.trim().toLowerCase();
  const folders = kw ? [] : S.folders.filter(f => (f.parentId || '') === S.cwd).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const qs = (kw ? S.questions.filter(q => (q.title + ' ' + q.stem + ' ' + q.subject + ' ' + qConceptNames(q).join(' ')).toLowerCase().includes(kw))
    : S.questions.filter(q => (q.folderId || '') === S.cwd)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const nSel = S.sel.f.size + S.sel.q.size;
  $('#exMain').innerHTML = `
    <div class="ex-head">
      ${S.cwd && !kw ? `<button class="btn ex-up" data-act="up" title="상위 폴더로 (Backspace)">‹ 상위 폴더</button>` : ''}
      <div class="crumbs">${crumbs.map(c => `<span class="crumb" data-open="${c.id}" data-drop-folder="${c.id}">${esc(c.name)}</span>`).join('<span class="sep">›</span>')}</div>
      <input class="search" id="exSearch" placeholder="문제 검색" value="${esc(S.search)}">
    </div>
    <div class="ex-tools">
      <button class="btn primary" data-act="newFolder">+ 새 폴더</button>
      <span class="div"></span>
      <button class="btn" data-act="rename" ${S.sel.f.size === 1 && S.sel.q.size === 0 ? '' : 'disabled'}>이름 변경</button>
      <button class="btn" data-act="move" ${nSel ? '' : 'disabled'}>이동</button>
      <button class="btn" data-act="copy" ${nSel ? '' : 'disabled'}>복제</button>
      <button class="btn danger" data-act="del" ${nSel ? '' : 'disabled'}>삭제</button>
      <span class="selinfo">${nSel ? nSel + '개 선택됨 · ' : ''}체크 칸을 누른 채 끌면 여러 문제를 한 번에 골라요 · 문제를 폴더로 끌어 옮길 수 있어요</span>
    </div>
    <div class="ex-body">
      ${kw ? `<div class="sec-title">'${esc(S.search)}' 검색 결과</div>` : `<div class="sec-title">폴더</div>
      <div class="fgrid">${folders.length ? folders.map(f => { const c = countIn(f.id); return `
        <div class="fcard ${S.sel.f.has(f.id) ? 'sel' : ''}" draggable="true" data-fid="${f.id}" data-drop-folder="${f.id}">
          <input type="checkbox" class="ck" data-ckf="${f.id}" ${S.sel.f.has(f.id) ? 'checked' : ''}>
          ${IC.folder}<div style="min-width:0"><div class="fname">${esc(f.name)}</div><div class="fmeta">문제 ${countDeep(f.id)}</div></div>
        </div>`; }).join('') : '<div style="color:#9aa0ac;font-size:13px">폴더가 없어요. [+ 새 폴더]로 만들어 보세요.</div>'}</div>`}
      <div class="sec-title">문제 <small>${qs.length}</small></div>
      ${qs.length ? `<div class="qlist">${qs.map(q => `
        <div class="qrow ${S.sel.q.has(q.id) ? 'sel' : ''}" draggable="true" data-qid="${q.id}">
          <input type="checkbox" data-ckq="${q.id}" ${S.sel.q.has(q.id) ? 'checked' : ''}>
          <span class="qtype ${q.type}">${q.type === 'mc' ? '객관식' : '단답형'}</span>
          <span class="qtitle">${esc(q.title)}${kw ? ` <span class="qpath">· ${esc(folderName(q.folderId))}</span>` : ''}</span>
          <span class="qkw" title="${esc(qConceptNames(q).join(', '))}">${qConceptNames(q).map(n => `<i>${esc(n)}</i>`).join('')}</span>
        </div>`).join('')}</div>` : '<div class="empty">이 폴더에 문제가 없어요.<br>오른쪽 [문제 만들기]로 문제를 만들고, 편집 창에서 폴더를 골라 저장하세요.</div>'}
    </div>`;
}
function bindExplorer(){
  const ex = $('#exMain');
  // 체크 칸을 누른 채 위아래로 끌면 지나간 문제 · 폴더를 모두 같은 상태로 (켜기 또는 끄기)
  let paint = null;
  const ckOf = el => el && el.closest && (el.closest('.qrow') || el.closest('.fcard'));
  const setCk = row => {
    const i = row && $('input[type=checkbox]', row);
    if (!i || paint.seen.has(i)) return;
    paint.seen.add(i); i.checked = paint.on;
    const set = i.dataset.ckq ? S.sel.q : S.sel.f, id = i.dataset.ckq || i.dataset.ckf;
    paint.on ? set.add(id) : set.delete(id);
    row.classList.toggle('sel', paint.on);
  };
  ex.addEventListener('mousedown', e => {
    const i = e.target.closest && e.target.closest('input[data-ckq],input[data-ckf]');
    if (!i || e.button !== 0) return;
    e.preventDefault();
    paint = {on:!i.checked, seen:new Set()};
    $$('[draggable=true]', ex).forEach(x => x.setAttribute('draggable', 'false'));
    ex.classList.add('painting');
    setCk(ckOf(i));
  });
  ex.addEventListener('mouseover', e => { if (paint) setCk(ckOf(e.target)); });
  document.addEventListener('mouseup', () => {
    if (!paint) return;
    paint = null; ex.classList.remove('painting');
    ex._noClick = true; setTimeout(() => { ex._noClick = false; }, 0);
    renderExplorer();
  });
  ex.addEventListener('click', e => { if (ex._noClick && e.target.matches('input[type=checkbox]')) e.preventDefault(); }, true);
  ex.addEventListener('click', async e => {
    const t = e.target;
    if (t.matches('input[type=checkbox]')) return;
    const act = t.closest('[data-act]');
    if (act && !act.disabled) return bankAction(act.dataset.act);
    const crumb = t.closest('.crumb');
    if (crumb) return openFolder(crumb.dataset.open);
    const fc = t.closest('.fcard');
    if (fc) return openFolder(fc.dataset.fid);
    const qr = t.closest('.qrow');
    if (qr) { const q = S.questions.find(x => x.id === qr.dataset.qid); if (q) openQWin(q); }
  });
  ex.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.ckf) { t.checked ? S.sel.f.add(t.dataset.ckf) : S.sel.f.delete(t.dataset.ckf); renderExplorer(); }
    if (t.dataset.ckq) { t.checked ? S.sel.q.add(t.dataset.ckq) : S.sel.q.delete(t.dataset.ckq); renderExplorer(); }
  });
  ex.addEventListener('input', e => {
    if (e.target.id === 'exSearch') {
      S.search = e.target.value;
      clearTimeout(ex._st);
      ex._st = setTimeout(() => { renderExplorer(); const s = $('#exSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250);
    }
  });
  ex.addEventListener('dragstart', e => {
    const fc = e.target.closest('.fcard'), qr = e.target.closest('.qrow');
    let sel;
    if (fc) sel = S.sel.f.has(fc.dataset.fid) ? {folderIds:[...S.sel.f], questionIds:[...S.sel.q]} : {folderIds:[fc.dataset.fid], questionIds:[]};
    else if (qr) sel = S.sel.q.has(qr.dataset.qid) ? {folderIds:[...S.sel.f], questionIds:[...S.sel.q]} : {folderIds:[], questionIds:[qr.dataset.qid]};
    if (!sel) return;
    e.dataTransfer.setData('text/plain', 'bank:' + JSON.stringify(sel));
    e.dataTransfer.effectAllowed = 'move';
  });
  ex.addEventListener('dragover', e => {
    const d = e.target.closest('[data-drop-folder]');
    if (!d) return;
    e.preventDefault();
    $$('.drop-hot', ex).forEach(x => x !== d && x.classList.remove('drop-hot'));
    d.classList.add('drop-hot');
  });
  ex.addEventListener('dragleave', e => { const d = e.target.closest('[data-drop-folder]'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('drop-hot'); });
  ex.addEventListener('drop', async e => {
    const d = e.target.closest('[data-drop-folder]');
    $$('.drop-hot', ex).forEach(x => x.classList.remove('drop-hot'));
    if (!d) return;
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw.startsWith('bank:')) return;
    const sel = JSON.parse(raw.slice(5));
    const target = d.dataset.dropFolder;
    if (sel.folderIds.includes(target)) return;
    const r = await call('moveItems', sel, target);
    applyBank(r); S.sel.f.clear(); S.sel.q.clear(); renderExplorer();
    toast(`'${folderName(target)}'(으)로 옮겼어요`);
  });
}
function applyBank(b){ S.folders = b.folders; S.questions = b.questions; }
async function bankAction(a){
  const sel = {folderIds:[...S.sel.f], questionIds:[...S.sel.q]};
  if (a === 'up') {
    const cur = S.folders.find(f => f.id === S.cwd);
    return openFolder(cur ? cur.parentId || '' : '');
  } else if (a === 'newFolder') {
    const name = await promptBox('새 폴더', '', '폴더 이름');
    if (!name) return;
    applyBank(await call('createFolder', name, S.cwd)); renderExplorer();
  } else if (a === 'rename') {
    const id = sel.folderIds[0];
    const name = await promptBox('폴더 이름 변경', folderName(id));
    if (!name) return;
    applyBank(await call('renameFolder', id, name)); renderExplorer();
  } else if (a === 'del') {
    const ok = await confirmBox(`선택한 ${sel.folderIds.length ? '폴더 ' + sel.folderIds.length + '개(안의 문제 포함) ' : ''}${sel.questionIds.length ? '문제 ' + sel.questionIds.length + '개' : ''}를 삭제할까요?\n삭제하면 되돌릴 수 없어요.`, '삭제', true);
    if (!ok) return;
    applyBank(await call('deleteItems', sel)); S.sel.f.clear(); S.sel.q.clear(); renderExplorer(); toast('삭제했어요');
  } else if (a === 'copy') {
    applyBank(await call('copyItems', sel, null)); S.sel.f.clear(); S.sel.q.clear(); renderExplorer(); toast('복제했어요');
  } else if (a === 'move') {
    const target = await pickFolder('이동할 폴더 선택', sel.folderIds);
    if (target === null) return;
    applyBank(await call('moveItems', sel, target)); S.sel.f.clear(); S.sel.q.clear(); renderExplorer(); toast(`'${folderName(target)}'(으)로 옮겼어요`);
  }
}
function folderTreeHtml(parent, depth, banned){
  return S.folders.filter(f => (f.parentId || '') === parent && !banned.includes(f.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(f =>
    `<label style="display:block;padding:6px 0 6px ${12 + depth * 20}px;cursor:pointer"><input type="radio" name="pf" value="${f.id}"> ${esc(f.name)}</label>` +
    folderTreeHtml(f.id, depth + 1, banned)).join('');
}
function pickFolder(title, banned){
  return new Promise(res => {
    modal({title, body:`<div style="max-height:50vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">
      <label style="display:block;padding:6px 12px;cursor:pointer;font-weight:700"><input type="radio" name="pf" value="" checked> 내 문제은행 (최상위)</label>
      ${folderTreeHtml('', 1, banned || [])}</div>`, buttons:[
      {label:'취소', onClick:() => res(null)},
      {label:'여기로 이동', primary:true, onClick:bg => res($('input[name=pf]:checked', bg).value)}
    ]});
  });
}

/* ---------- 문제 편집 창 (문제은행 왼쪽 전체 · 엑셀 시트처럼 여러 문제 · 7 문제 가안 : 3 오개념 목록) ---------- */
let sheetSeq = 0;
const normName = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const CHECK = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function blankQ(){
  return {id:'', title:'', subject:S.mkSubject || '', type:'mc', stem:'', choices:['', '', '', ''], answer:'', explanation:'', imageUrl:'',
    conceptIds:[], newConcepts:[], choiceMis:[[], [], [], []], pendingMis:[[], [], [], []], choiceImages:['', '', '', ''], code:'', figure:''};
}
/** 선지 · 선지별 오개념(id 목록) · 아직 목록에 없는 오개념 이름(pending) 배열 길이를 맞춤 */
function fixQ(q){
  q = clone(q);
  q.choices = q.choices || []; q.conceptIds = q.conceptIds || []; q.newConcepts = q.newConcepts || [];
  const arr = (a, i) => { const v = (a || [])[i]; return Array.isArray(v) ? v.filter(Boolean) : v ? [String(v)] : []; };
  q.choiceMis = q.choices.map((_, i) => arr(q.choiceMis, i));
  q.pendingMis = q.choices.map((_, i) => arr(q.pendingMis, i));
  q.choiceImages = q.choices.map((_, i) => String((q.choiceImages || [])[i] || ''));
  q.code = q.code || ''; q.figure = q.figure || ''; q.explanation = q.explanation || '';
  delete q.choiceMisNames; delete q.misconceptions; delete q.choiceMisIds; delete q.misIds;
  return q;
}
function misById(id){ return S.miscons.find(m => m.id === id); }
/** 선지에 연결된 오개념 이름들 (미리보기 · AI에 보낼 때) */
function choiceMisNames(q, i){
  return ((q.choiceMis || [])[i] || []).map(id => (misById(id) || {}).name).filter(Boolean)
    .concat(((q.pendingMis || [])[i] || []));
}
function curSheet(){ return S.ed && S.ed.sheets[S.ed.active]; }
/** 문제를 편집 창의 시트로 띄움 (이미 열린 문제면 그 시트로). opt.conceptId = 미리 골라 둘 개념 */
function openQWin(q, opt){
  opt = opt || {};
  if (!S.ed) S.ed = {sheets:[], active:0, min:false, sel:null, editing:null, search:'', tog:new Map()};
  const ed = S.ed;
  const wasHidden = ed.min || !$('#qEditor');
  let i = q.id ? ed.sheets.findIndex(s => s.q.id === q.id) : -1;
  if (i < 0) {
    const sh = {key:'s' + (++sheetSeq), q:fixQ(q), dirty:!q.id, folderId:q.id ? (q.folderId || '') : S.cwd};
    const c = opt.conceptId && S.concepts.find(x => x.id === opt.conceptId);
    if (c) { sh.q.conceptIds = [c.id]; sh.q.newConcepts = []; if (!sh.q.subject) sh.q.subject = c.subject; }
    ed.sheets.push(sh);
    i = ed.sheets.length - 1;
  }
  ed.active = i; ed.min = false; ed.sel = null; ed.editing = null;
  if (wasHidden && S.view === 'bank' && !(history.state && history.state.ed)) histPush({view:'bank', params:{}, cwd:S.cwd, ed:true});
  drawEd();
  return ed.sheets[i];
}
function folderOptions(sel){
  const opts = [`<option value="">내 문제은행</option>`];
  const walk = (p, d) => S.folders.filter(f => (f.parentId || '') === p).sort((a, b) => a.name.localeCompare(b.name, 'ko')).forEach(f => {
    opts.push(`<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${'  '.repeat(d)}${esc(f.name)}</option>`); walk(f.id, d + 1);
  });
  walk('', 1);
  return opts.join('');
}
function markDirty(sh){ sh.dirty = true; drawTabs(); }

function drawEd(){
  const ex = $('#explorer');
  if (!S.ed || !ex) return renderTaskbar();
  let el = $('#qEditor');
  if (!el) {
    el = document.createElement('div');
    el.id = 'qEditor'; el.className = 'qed';
    el.innerHTML = `<div class="qe-top"></div>
      <div class="qe-main">
        <div class="qe-left"><div class="qe-paper"></div><div class="qe-tabs"></div></div>
        <div class="qe-side"><div class="qe-side-h">오개념 목록 <small>과목 › 단원 › 개념 › 오개념</small></div>
          <input class="search" id="qeSearch" placeholder="키워드로 오개념 · 개념 검색">
          <div class="qe-tree" id="qeTree"></div>
          <div class="qe-side-tip">선지를 클릭한 뒤 오개념을 클릭하거나 선지로 끌어다 놓으면 연결돼요 (선지 하나에 여러 개 가능).<br>
            오개념을 다른 개념 위로 끌면 <b>이동</b>, <b>Ctrl</b>(Mac은 ⌥)을 누른 채 끌면 그 개념에도 <b>복제</b>돼요. 더블클릭하면 고치거나 삭제할 수 있어요.</div></div>
      </div>`;
    ex.appendChild(el);
    $('#qeSearch', el).value = S.ed.search;
    bindEd(el);
  }
  el.style.display = S.ed.min ? 'none' : '';
  drawEdTop(); drawPaper(); drawTabs(); drawMisTree(); renderTaskbar();
}
/** 개념 노드 (큰 단원 노드 제외) */
function conceptNodes(subject){ return S.concepts.filter(c => c.kind !== 'unit' && (subject == null || c.subject === subject)); }
/** 과목 선택 상자의 항목 (기본 과목 + 이미 쓰고 있는 과목 + 지금 값) */
function subjectOptions(value, ph){
  value = String(value || '').trim();
  const list = SUBJECT_CHOICES.concat(allSubjects().filter(s => SUBJECT_CHOICES.indexOf(s) < 0));
  if (value && list.indexOf(value) < 0) list.push(value);
  return `<option value="" ${value ? '' : 'selected'}>${esc(ph || '과목 선택')}</option>` +
    list.map(s => `<option value="${esc(s)}" ${s === value ? 'selected' : ''}>${esc(s)}</option>`).join('');
}
/* ---------- 개념 검색 (입력한 글자로 개념 지도의 개념을 후보로 · 한글 초성도) ---------- */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function choseong(t){ return String(t).replace(/[가-힣]/g, ch => CHO[Math.floor((ch.charCodeAt(0) - 0xAC00) / 588)]); }
/** 검색어에 맞는 개념 후보: 앞부분이 같은 것 → 포함 → 초성 순 */
function conceptSuggest(q, text){
  const kw = normName(text), kc = choseong(kw), onlyCho = /^[ㄱ-ㅎ]+$/.test(kw);
  const pool = conceptNodes(q.subject || '').filter(c => !q.conceptIds.includes(c.id));
  const score = c => {
    const n = normName(c.name);
    if (!kw) return 3;
    if (n.startsWith(kw)) return 0;
    if (n.includes(kw)) return 1;
    if ((onlyCho || kw.length >= 2) && choseong(n).includes(kc)) return 2;
    return -1;
  };
  return pool.map(c => ({c, s:score(c)})).filter(x => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.c.name.length - b.c.name.length || a.c.name.localeCompare(b.c.name, 'ko')).slice(0, 10).map(x => x.c);
}
function drawConceptSuggest(box, text){
  const sh = curSheet(), q = sh.q, list = $('.qe-cslist', box);
  const hits = conceptSuggest(q, text), name = text.trim();
  const exact = name && (conceptNodes(q.subject).some(c => normName(c.name) === normName(name)) || q.newConcepts.some(n => normName(n) === normName(name)));
  const hl = n => { const i = normName(n).indexOf(normName(name)); return name && i >= 0 && n.replace(/\s+/g, '') === normName(n) ? esc(n.slice(0, i)) + '<b>' + esc(n.slice(i, i + normName(name).length)) + '</b>' + esc(n.slice(i + normName(name).length)) : esc(n); };
  const items = hits.map(c => ({k:'id', v:c.id, h:`${hl(c.name)}${c.unit ? `<small>${esc(c.unit)}</small>` : ''}`}));
  if (name && !exact) items.push({k:'new', v:name, h:`+ '${esc(name)}' 새 개념으로 추가 <small>저장하면 개념 지도에 생겨요</small>`});
  box._items = items; box._at = items.length ? 0 : -1;
  list.innerHTML = items.length ? items.map((it, i) => `<div class="qe-csit ${i === 0 ? 'on' : ''} ${it.k}" data-i="${i}">${it.h}</div>`).join('') : '<div class="qe-csnone">맞는 개념이 없어요</div>';
  list.hidden = false;
}
function pickConcept(box, i){
  const sh = curSheet(), q = sh.q, it = (box._items || [])[i];
  if (!it) return;
  if (it.k === 'id') { if (!q.conceptIds.includes(it.v)) q.conceptIds.push(it.v); }
  else if (!q.newConcepts.includes(it.v)) q.newConcepts.push(it.v);
  markDirty(sh); drawEdTop(); drawTabs(); drawMisTree();
  const inp = $('#qEditor .qe-csin'); if (inp) { inp.focus(); drawConceptSuggest(inp.parentElement, ''); }
}
function conceptChips(q){
  return q.conceptIds.map(id => `<span class="qe-cchip">${esc(conceptName(id) || '?')}<button data-act="rm-con" data-id="${esc(id)}" title="빼기">×</button></span>`).join('') +
    q.newConcepts.map((n, i) => `<span class="qe-cchip new" title="저장하면 개념 지도에 새 노드로 추가돼요">+ ${esc(n)}<button data-act="rm-newcon" data-i="${i}" title="빼기">×</button></span>`).join('');
}
function drawEdTop(){
  const sh = curSheet(), q = sh.q;
  $('#qEditor .qe-top').innerHTML = `
    <button class="btn qe-back" data-e="min" title="문제 목록으로 (편집 내용은 그대로 · 브라우저 뒤로 가기와 같아요)">‹ 문제 목록</button>
    <input class="inp qe-code" data-e="code" value="${esc(q.code)}" placeholder="문항 번호" title="문항 번호 (예: 역학 1-1)">
    <input class="inp qe-title" data-e="title" value="${esc(q.title)}" placeholder="문제 제목">
    <select class="inp qe-subj" data-e="subject" title="과목">${subjectOptions(q.subject, '과목 선택')}</select>
    <select class="inp qe-type" data-e="type"><option value="mc" ${q.type === 'mc' ? 'selected' : ''}>객관식</option><option value="short" ${q.type === 'short' ? 'selected' : ''}>단답형</option></select>
    <div class="qe-concept" title="이 문제가 확인하는 개념 (여러 개 가능)"><span>개념</span>${conceptChips(q)}
      <div class="qe-cs"><input class="qe-csin" data-e="csearch" autocomplete="off" placeholder="${q.subject ? '+ 개념 검색 · 추가' : '과목을 먼저 고르세요'}" ${q.subject ? '' : 'disabled'}><div class="qe-cslist" hidden></div></div></div>
    <span class="grow"></span>
    <span class="qw-state"></span>
    <select class="inp qe-folder" data-e="folder" title="저장할 폴더">${folderOptions(sh.folderId)}</select>
    <button class="btn primary" data-e="save" title="저장 (Ctrl+S)">저장</button>
    <div class="qw-btns"><button data-e="min" title="접어 두기">–</button><button data-e="close" title="편집 창 닫기">×</button></div>`;
}
/** 더블클릭 · [수정]으로 바로 고치는 칸 */
function editBlock(key, cls, label, value, ph, rows){
  const E = S.ed.editing;
  if (E === key) return `<div class="${cls} editing">${label ? `<label>${label}</label>` : ''}<textarea class="inp" data-in="${key}" rows="${rows}" placeholder="${esc(ph)}">${esc(value)}</textarea><div class="qe-edit-tip">Ctrl+Enter 또는 바깥을 누르면 반영 · Esc 취소</div></div>`;
  return `<div class="${cls} hov" data-dbl="${key}">${label ? `<label>${label}</label>` : ''}<div class="${cls.split(' ').pop()}-t">${value ? esc(value) : `<i class="ph">${esc(ph)}</i>`}</div><span class="qe-tools"><button data-act="edit" data-k="${key}">수정</button></span></div>`;
}
function drawPaper(){
  const ed = S.ed, q = curSheet().q, E = ed.editing;
  let h = editBlock('stem', 'qe-stem', '', q.stem, '발문을 입력하세요 (더블클릭하면 고칠 수 있어요)', 4);
  if (q.imageUrl) h += `<div class="img-box qe-img">${imgTag(q.imageUrl)}<button data-act="rm-img" title="이미지 삭제">×</button></div>`;
  if (q.figure || E === 'fig') h += editBlock('fig', 'qe-fig', '그림 상황', q.figure, '그림 설명 없음', 3);   // 예전 글 설명이 남은 문항만
  if (q.type === 'mc') {
    const need = ansList(q).length;
    h += '<div class="qe-chs">' + q.choices.map((c, i) => {
      const ans = isAns(q, i);
      let misHtml = '';
      if (!ans) {
        const chips = (q.choiceMis[i] || []).map(id => {
          const m = misById(id);
          return `<span class="qe-mis" data-mchip="${esc(id)}" title="더블클릭하면 오개념을 고치거나 삭제할 수 있어요">오개념 · ${esc(m ? m.name : '(삭제된 오개념)')}<button data-act="rm-mis" data-i="${i}" data-id="${esc(id)}" title="이 선지에서 빼기">×</button></span>`;
        }).join('') + (q.pendingMis[i] || []).map((n, k) => `<span class="qe-mis pending" title="오개념 목록에 아직 없어요. 눌러서 개념 범주를 고르면 추가돼요" data-act="pend" data-i="${i}" data-k="${k}">오개념 · ${esc(n)} <small>(범주 선택)</small><button data-act="rm-pend" data-i="${i}" data-k="${k}" title="빼기">×</button></span>`).join('');
        misHtml = `<div class="qe-mislist">${chips}` +
          (E === 'm' + i ? `<input class="inp qe-misin" data-in="m${i}" value="" placeholder="오개념을 입력하고 Enter → 개념 범주 선택 (목록에 있으면 바로 연결)">` :
            ed.sel === i ? '<span class="qe-mis-tip">오른쪽 오개념을 클릭하거나 끌어다 놓으세요 (여러 개 가능)</span>' : '') + '</div>';
      }
      return `<div class="qe-ch ${ans ? 'ans' : ''} ${ed.sel === i ? 'sel' : ''}" data-ch="${i}">
        <button class="qe-no" data-act="ans" data-i="${i}" title="${ans ? '정답 (누르면 해제)' : '눌러서 정답으로'}">${CIRC[i] || (i + 1)}${ans ? `<span class="qe-check">${CHECK}</span>` : ''}</button>
        <div class="qe-cbody">${q.choiceImages[i] ? `<div class="img-box qe-chimg">${imgTag(q.choiceImages[i])}<button data-act="rm-cimg" data-i="${i}" title="선지 그림 삭제">×</button></div>` : ''}${E === 'c' + i ? `<input class="inp" data-in="c${i}" value="${esc(c)}" placeholder="${q.choiceImages[i] ? '그림 아래 글 (없어도 돼요)' : '선지 내용'}">` : c || !q.choiceImages[i] ? `<div class="qe-ctext" data-dbl="c${i}">${c ? esc(c) : '<i class="ph">빈 선지</i>'}</div>` : ''}${misHtml}</div>
        <div class="qe-tools"><button data-act="edit" data-k="c${i}">수정</button><button data-act="cimg" data-i="${i}">${q.choiceImages[i] ? '그림 바꾸기' : '그림'}</button>${ans ? '' : `<button data-act="mis-in" data-i="${i}">오개념 추가</button>`}<button data-act="del-c" data-i="${i}" class="del">선지 제거</button></div>
      </div>`;
    }).join('') + '</div>';
    h += `<div class="qe-acts"><button class="btn" data-act="add-c">+ 선지 추가</button>
        <span class="grow"></span><button class="btn ai" data-act="aiimg" title="문제 내용에 어울리는 그림을 AI가 만들어 넣어요">AI로 그림 만들기</button><button class="btn" data-act="img">내 파일에서 문제 그림 추가</button></div>
      <div class="qe-tip">번호를 누르면 정답(빨간 ✓)이 돼요. 정답이 여러 개면 여러 번호를 누르세요${need > 1 ? ` — 학생은 <b>정답 ${need}개를 모두</b> 골라야 정답이에요` : ''}.<br>
        선지를 클릭하고 오른쪽 오개념을 클릭하면 연결돼요 (선지 하나에 여러 개). 발문 · 선지 · 오개념은 더블클릭해서 고칠 수 있고, Ctrl+S로 저장해요.</div>`;
  } else {
    h += `<div class="qe-short"><label>정답</label><input class="inp" data-live="answer" value="${esc(q.answer)}" placeholder="여러 개 인정 시 | 로 구분 (예: 9|9J)"></div>
      <div class="qe-acts"><span class="grow"></span><button class="btn ai" data-act="aiimg" title="문제 내용에 어울리는 그림을 AI가 만들어 넣어요">AI로 그림 만들기</button><button class="btn" data-act="img">내 파일에서 문제 그림 추가</button></div>`;
  }
  $('#qEditor .qe-paper').innerHTML = `<div class="qe-sheet">${h}</div>`;
  const inp = E && $(`#qEditor [data-in="${E}"]`);
  if (inp) { inp.focus(); const v = inp.value.length; try { inp.setSelectionRange(v, v); } catch(e){} }
}
function drawTabs(){
  const ed = S.ed;
  if (!ed || !$('#qEditor')) return;
  $('#qEditor .qe-tabs').innerHTML = ed.sheets.map((s, i) => `<div class="qe-tab ${i === ed.active ? 'on' : ''}" data-tab="${i}" title="${esc(s.q.title || '새 문제')}">
      <span>${esc(s.q.title || '새 문제')}</span>${s.dirty ? '<i class="dot" title="저장 안 됨"></i>' : ''}<button data-act="close-tab" data-i="${i}" title="이 시트 닫기">×</button></div>`).join('') +
    '<button class="qe-tab add" data-act="new-tab" title="빈 문제 추가">+</button>';
  const st = $('#qEditor .qw-state'), sh = curSheet();
  if (st && sh) { st.className = 'qw-state' + (sh.dirty ? '' : ' ok'); st.textContent = sh.dirty ? '저장 안 됨' : '저장됨'; }
}
function treeOpen(k, def){ return S.ed.tog.has(k) ? S.ed.tog.get(k) : def; }
function drawMisTree(){
  const box = $('#qeTree');
  if (!box || !S.ed) return;
  const q = curSheet().q, kw = S.ed.search.trim().toLowerCase();
  const used = new Set([].concat(...q.choiceMis));
  const allNodes = conceptNodes();
  const lk = x => !!kw && String(x || '').toLowerCase().includes(kw);
  const byName = (a, b) => a.name.localeCompare(b.name, 'ko');
  const subs = [...new Set(allNodes.map(c => c.subject).concat(S.miscons.map(m => m.subject)))].filter(Boolean)
    .sort((a, b) => (b === q.subject) - (a === q.subject) || a.localeCompare(b, 'ko'));
  const misItem = (m, cid) => `<div class="mt-m ${used.has(m.id) ? 'used' : ''}" draggable="true" data-mis="${m.id}" data-from="${esc(cid || '')}" title="${esc(m.desc || '클릭: 선택한 선지에 연결 · 끌기: 선지에 연결 / 다른 개념으로 이동(Ctrl: 복제) · 더블클릭: 고치기')}">${esc(m.name)}${(m.conceptIds || []).length > 1 ? ` <small class="mt-multi" title="${(m.conceptIds || []).length}개 개념에 들어 있어요">×${(m.conceptIds || []).length}</small>` : ''}</div>`;
  const row = (k, def, cls, label, count, kids, drop) => {
    const open = kw ? true : treeOpen(k, def);
    return `<div class="mt-row ${cls} ${open ? 'open' : ''}" data-tg="${esc(k)}"${drop != null ? ` data-drop-con="${esc(drop)}"` : ''}><span class="arr">▶</span><span class="mt-l">${label}</span>${count == null ? '' : `<small>${count}</small>`}</div>` +
      (open ? `<div class="mt-kids"${drop != null ? ` data-drop-con="${esc(drop)}"` : ''}>${kids}</div>` : '');
  };
  let h = '';
  subs.forEach(s => {
    const sHit = lk(s);
    const nodes = allNodes.filter(c => c.subject === s);
    const ms = S.miscons.filter(m => m.subject === s);
    const units = [...new Set(nodes.map(c => c.unit || ''))].sort((a, b) => (!a) - (!b) || a.localeCompare(b, 'ko'));
    let sh = '';
    units.forEach(u => {
      const uHit = sHit || lk(u);
      let uh = '';
      nodes.filter(c => (c.unit || '') === u).sort(byName).forEach(c => {
        const cHit = uHit || lk(c.name);
        const list = ms.filter(m => (m.conceptIds || []).includes(c.id) && (!kw || cHit || lk(m.name) || lk(m.desc))).sort(byName);
        if (kw && !cHit && !list.length) return;
        uh += row('c:' + c.id, true, 'mt-c' + (q.conceptIds.includes(c.id) ? ' cur' : ''), esc(c.name), list.length,
          list.map(m => misItem(m, c.id)).join('') || '<div class="mt-empty">오개념 없음</div>', c.id);
      });
      if (uh) sh += row('u:' + s + '|' + u, true, 'mt-u', esc(u || '단원 미지정'), null, uh);
    });
    const orphan = ms.filter(m => !(m.conceptIds || []).some(id => nodes.some(c => c.id === id)) && (!kw || sHit || lk(m.name) || lk(m.desc))).sort(byName);
    if (orphan.length || !kw) sh += row('o:' + s, !!orphan.length, 'mt-u', '개념 미지정', orphan.length, orphan.map(m => misItem(m, '')).join('') || '<div class="mt-empty">없음</div>', '');
    if (sh) h += row('s:' + s, s === q.subject || subs.length === 1, 'mt-s', esc(s), ms.length, sh);
  });
  box.innerHTML = h || `<div class="mt-empty">${kw ? '검색 결과가 없어요' : '아직 오개념이 없어요. 선지의 [오개념 추가]로 만들거나 통계 › 개념 지도에서 만들 수 있어요.'}</div>`;
}

function bindEd(el){
  el.addEventListener('click', async e => {
    const t = e.target, ed = S.ed;
    if (!ed) return;
    const sh = curSheet(), q = sh.q;
    const eb = t.closest('button[data-e]');
    if (eb) {
      const a = eb.dataset.e;
      if (a === 'save') return saveSheet(sh);
      if (a === 'min') return minimizeEditor();
      if (a === 'close') return closeEditor();
      return;
    }
    const ab = t.closest('[data-act]');
    if (ab) {
      const a = ab.dataset.act, i = Number(ab.dataset.i);
      if (a === 'edit') { ed.editing = ab.dataset.k; return drawPaper(); }
      if (a === 'rm-con') { q.conceptIds = q.conceptIds.filter(x => x !== ab.dataset.id); markDirty(sh); drawEdTop(); drawTabs(); return drawMisTree(); }
      if (a === 'rm-newcon') { q.newConcepts.splice(i, 1); markDirty(sh); drawEdTop(); return drawTabs(); }
      if (a === 'mis-in') {
        if (!q.subject) return toast('과목을 먼저 입력해 주세요 (오개념은 과목별로 관리돼요)', true);
        ed.editing = 'm' + i; ed.sel = i; return drawPaper();
      }
      if (a === 'ans') {
        const set = new Set(ansList(q)), no = String(i + 1);
        if (set.has(no)) set.delete(no);
        else { set.add(no); q.choiceMis[i] = []; q.pendingMis[i] = []; if (ed.sel === i) ed.sel = null; }
        q.answer = [...set].sort((x, y) => x - y).join('|');
        markDirty(sh); drawPaper(); return drawMisTree();
      }
      if (a === 'rm-mis') { e.stopPropagation(); q.choiceMis[i] = q.choiceMis[i].filter(x => x !== ab.dataset.id); markDirty(sh); drawPaper(); return drawMisTree(); }
      if (a === 'rm-pend') { e.stopPropagation(); q.pendingMis[i].splice(Number(ab.dataset.k), 1); markDirty(sh); return drawPaper(); }
      if (a === 'pend') {
        const name = q.pendingMis[i][Number(ab.dataset.k)];
        const m = await createMisWithCategory(q, name);
        if (m) { q.pendingMis[i].splice(Number(ab.dataset.k), 1); linkMis(sh, i, m); }
        return;
      }
      if (a === 'del-c') {
        if (q.choices.length <= 2) return toast('선지는 2개 이상 있어야 해요', true);
        q.choices.splice(i, 1); q.choiceMis.splice(i, 1); q.pendingMis.splice(i, 1); q.choiceImages.splice(i, 1);
        q.answer = ansList(q).map(Number).filter(n => n !== i + 1).map(n => n > i + 1 ? n - 1 : n).join('|');
        ed.sel = null; ed.editing = null; markDirty(sh); drawPaper(); return drawMisTree();
      }
      if (a === 'add-c') {
        if (q.choices.length >= 8) return toast('선지는 8개까지 만들 수 있어요', true);
        q.choices.push(''); q.choiceMis.push([]); q.pendingMis.push([]); q.choiceImages.push('');
        ed.sel = q.choices.length - 1; ed.editing = 'c' + (q.choices.length - 1); markDirty(sh); return drawPaper();
      }
      if (a === 'img') return pickImage(sh);
      if (a === 'aiimg') {
        if (!q.stem.trim()) return toast('발문을 먼저 입력해 주세요', true);
        toast('문제에 어울리는 그림을 만드는 중… (1분 정도 걸려요)');
        return makeAiImage(sh, '');
      }
      if (a === 'rm-img') { q.imageUrl = ''; markDirty(sh); return drawPaper(); }
      if (a === 'cimg') { e.stopPropagation(); return pickImage(sh, i); }
      if (a === 'rm-cimg') { e.stopPropagation(); q.choiceImages[i] = ''; markDirty(sh); return drawPaper(); }
      if (a === 'close-tab') { e.stopPropagation(); return closeSheet(i); }
      if (a === 'new-tab') return openQWin(blankQ());
      return;
    }
    const tab = t.closest('[data-tab]');
    if (tab) { ed.active = Number(tab.dataset.tab); ed.sel = null; ed.editing = null; return drawEd(); }
    const mi = t.closest('[data-mis]');
    if (mi) {
      // 한 번 클릭 = 선택한 선지에 연결 (더블클릭 = 고치기와 겹치지 않게 잠깐 기다림)
      clearTimeout(ed.clickT);
      if (e.detail > 1) return;
      const id = mi.dataset.mis;
      ed.clickT = setTimeout(() => {
        if (!S.ed || curSheet() !== sh) return;
        if (S.ed.sel == null) return toast('먼저 왼쪽에서 오개념을 연결할 선지를 클릭하세요');
        linkMis(sh, S.ed.sel, misById(id));
      }, 260);
      return;
    }
    const tg = t.closest('[data-tg]');
    if (tg) { const k = tg.dataset.tg; ed.tog.set(k, !tg.classList.contains('open')); return drawMisTree(); }
    const ch = t.closest('.qe-ch');
    if (ch && !t.closest('input,textarea,.qe-mis')) {
      if (e.detail > 1) return;   // 더블클릭(고치기)의 두 번째 클릭
      const i = Number(ch.dataset.ch);
      if (isAns(q, i)) { ed.sel = null; toast('정답 선지에는 오개념을 연결하지 않아요'); }
      else ed.sel = ed.sel === i ? null : i;
      return paintSel();
    }
  });
  // 더블클릭으로 고치기: 발문 · 그림 상황 · 해설 · 선지 · 선지의 오개념 · 오른쪽 오개념 목록
  el.addEventListener('dblclick', e => {
    if (!S.ed) return;
    const chip = e.target.closest('[data-mchip]'), mi = e.target.closest('[data-mis]');
    if (chip || mi) { e.preventDefault(); return editMisModal(misById((chip || mi).dataset.mchip || (chip || mi).dataset.mis)); }
    if (S.ed.editing) return;
    const d = e.target.closest('[data-dbl]');
    if (d) { S.ed.editing = d.dataset.dbl; drawPaper(); }
  });
  el.addEventListener('input', e => {
    const t = e.target, sh = curSheet();
    if (t.id === 'qeSearch') { S.ed.search = t.value; return drawMisTree(); }
    if (t.dataset.e === 'title') { sh.q.title = t.value; return markDirty(sh); }
    if (t.dataset.e === 'code') { sh.q.code = t.value; return markDirty(sh); }
    if (t.dataset.e === 'subject') { sh.q.subject = t.value.trim(); return markDirty(sh); }
    if (t.dataset.live === 'answer') { sh.q.answer = t.value; return markDirty(sh); }
  });
  el.addEventListener('change', async e => {
    const t = e.target, sh = curSheet(), q = sh.q;
    if (t.dataset.e === 'subject') { q.conceptIds = []; q.newConcepts = []; drawEdTop(); drawPaper(); drawTabs(); return drawMisTree(); }
    if (t.dataset.e === 'folder') return (sh.folderId = t.value);
    if (t.dataset.e === 'type') {
      q.type = t.value; q.answer = '';
      if (q.type === 'mc' && !q.choices.length) { q.choices = ['', '', '', '']; q.choiceMis = [[], [], [], []]; q.pendingMis = [[], [], [], []]; }
      S.ed.sel = null; S.ed.editing = null; markDirty(sh); return drawPaper();
    }
  });
  // 개념 검색: 입력 → 후보, ↑↓ · Enter 로 고르기, Esc 닫기
  el.addEventListener('focusin', e => { if (e.target.dataset && e.target.dataset.e === 'csearch') drawConceptSuggest(e.target.parentElement, e.target.value); });
  el.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.e === 'csearch') drawConceptSuggest(e.target.parentElement, e.target.value); });
  el.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.e === 'csearch') { const l = $('.qe-cslist', e.target.parentElement); setTimeout(() => { if (l) l.hidden = true; }, 120); } });
  el.addEventListener('mousedown', e => { const it = e.target.closest('.qe-csit'); if (it) { e.preventDefault(); pickConcept(it.closest('.qe-cs'), Number(it.dataset.i)); } });
  el.addEventListener('keydown', e => {
    const t = e.target;
    if (!t.dataset || t.dataset.e !== 'csearch') return;
    const box = t.parentElement, n = (box._items || []).length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!n) return;
      box._at = (box._at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      $$('.qe-csit', box).forEach((x, i) => x.classList.toggle('on', i === box._at));
      const on = $('.qe-csit.on', box); if (on) on.scrollIntoView({block:'nearest'});
    } else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (box._at >= 0) pickConcept(box, box._at); }
    else if (e.key === 'Escape') { $('.qe-cslist', box).hidden = true; t.blur(); }
  });
  el.addEventListener('keydown', e => {
    const t = e.target;
    if (!t.dataset || !t.dataset.in) return;
    if (e.key === 'Escape') { e.preventDefault(); return commitEdit(null, true); }
    if (e.key === 'Enter' && !e.isComposing && (t.tagName !== 'TEXTAREA' || e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(t.value); }
  });
  el.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.in === (S.ed && S.ed.editing) && !S.ed.picking) commitEdit(e.target.value); });
  // 끌어다 놓기: 오개념 → 선지(연결) / 오개념 → 다른 개념(이동 · Ctrl/⌥ 복제)
  el.addEventListener('dragstart', e => {
    const m = e.target.closest('[data-mis]');
    if (!m) return;
    e.dataTransfer.setData('text/plain', 'mis:' + m.dataset.mis + ':' + (m.dataset.from || ''));
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  el.addEventListener('dragover', e => {
    const ch = e.target.closest('.qe-ch'), dc = e.target.closest('[data-drop-con]');
    $$('.drop-hot', el).forEach(x => x !== ch && x !== dc && x.classList.remove('drop-hot'));
    if (ch) { e.preventDefault(); ch.classList.add('drop-hot'); return; }
    if (dc) {
      e.preventDefault();
      e.dataTransfer.dropEffect = (e.ctrlKey || e.altKey || e.metaKey) ? 'copy' : 'move';
      const rowEl = dc.classList.contains('mt-row') ? dc : dc.previousElementSibling;
      if (rowEl) rowEl.classList.add('drop-hot');
    }
  });
  el.addEventListener('dragleave', e => { const x = e.target.closest('.qe-ch, .mt-row'); if (x && !x.contains(e.relatedTarget)) x.classList.remove('drop-hot'); });
  el.addEventListener('drop', e => {
    const ch = e.target.closest('.qe-ch'), dc = e.target.closest('[data-drop-con]');
    $$('.drop-hot', el).forEach(x => x.classList.remove('drop-hot'));
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw.startsWith('mis:')) return;
    e.preventDefault();
    const [, id, from] = raw.split(':');
    const m = misById(id);
    if (ch) return linkMis(curSheet(), Number(ch.dataset.ch), m);
    if (dc) return moveMis(m, from || '', dc.dataset.dropCon, e.ctrlKey || e.altKey || e.metaKey);
  });
}
/** 선택한 선지 표시만 바꿈 (다시 그리지 않아야 더블클릭이 끊기지 않아요) */
function paintSel(){
  const ed = S.ed;
  $$('#qEditor .qe-ch').forEach(el => {
    const i = Number(el.dataset.ch), on = ed.sel === i;
    el.classList.toggle('sel', on);
    const list = $('.qe-mislist', el), tip = list && $('.qe-mis-tip', list);
    if (on && list && !tip && !$('.qe-misin', list)) list.insertAdjacentHTML('beforeend', '<span class="qe-mis-tip">오른쪽 오개념을 클릭하거나 끌어다 놓으세요 (여러 개 가능)</span>');
    if (!on && tip) tip.remove();
  });
}
function commitEdit(val, cancel){
  const ed = S.ed;
  if (!ed || !ed.editing) return;
  const E = ed.editing, sh = curSheet();
  ed.editing = null;
  if (!cancel) {
    if (E === 'stem') { if (val !== sh.q.stem) { sh.q.stem = val; markDirty(sh); } }
    else if (E === 'fig') { if (val !== sh.q.figure) { sh.q.figure = val; markDirty(sh); } }
    else if (E === 'exp') { if (val !== sh.q.explanation) { sh.q.explanation = val; markDirty(sh); } }
    else if (E[0] === 'c') { const i = Number(E.slice(1)); if (val.trim() !== sh.q.choices[i]) { sh.q.choices[i] = val.trim(); markDirty(sh); } }
    else if (E[0] === 'm') return addMisByName(sh, Number(E.slice(1)), val.trim());
  }
  drawPaper();
}
/** 선지에 오개념 연결 (이미 있으면 그대로 · 여러 개 가능) */
function linkMis(sh, i, m){
  const q = sh.q;
  if (!m) return;
  if (isAns(q, i)) return toast('정답 선지에는 오개념을 연결하지 않아요', true);
  if (q.subject && m.subject !== q.subject) return toast(`'${m.subject}' 과목의 오개념이에요. 이 문제의 과목은 '${q.subject}'예요`, true);
  if (!q.subject) q.subject = m.subject;
  if (q.choiceMis[i].includes(m.id)) return toast('이미 연결된 오개념이에요');
  q.choiceMis[i].push(m.id);
  markDirty(sh);
  if (curSheet() === sh) { drawEdTop(); drawPaper(); drawMisTree(); }
}
function setMisList(subject, list){ S.miscons = S.miscons.filter(m => m.subject !== subject).concat(list); }
/** 직접 입력한 오개념: 목록에 있으면 연결, 없으면 개념 범주를 골라 목록에 새로 추가하고 연결 */
async function addMisByName(sh, i, name){
  const q = sh.q;
  if (!name) return drawPaper();
  const hit = S.miscons.find(m => m.subject === q.subject && normName(m.name) === normName(name));
  if (hit) return linkMis(sh, i, hit);
  const m = await createMisWithCategory(q, name);
  if (m) linkMis(sh, i, m);
  else if (curSheet() === sh) drawPaper();
}
/**
 * 새 오개념을 어느 개념 범주(개념 노드)에 넣을지 고르게 하고 오개념 목록에 추가.
 * 고르지 않고 [개념 미지정으로 추가]를 누르면 범주 없이 추가. 취소하면 null.
 */
function pickConcepts(subject, title, intro, preset, okLabel){
  const nodes = conceptNodes(subject);
  const units = [...new Set(nodes.map(c => c.unit || ''))].sort((a, b) => (!a) - (!b) || a.localeCompare(b, 'ko'));
  return new Promise(res => {
    let done = false;
    const finish = v => { if (!done) { done = true; res(v); } };
    const m = modal({title, wide:false, body:`<div class="modal-msg" style="margin-bottom:8px">${intro}</div>
      <input class="inp" id="pcSearch" placeholder="개념 검색" style="margin-bottom:8px">
      <div class="pc-list" id="pcList">${nodes.length ? units.map(u => `<div class="pc-unit">${esc(u || '단원 미지정')}</div>` +
        nodes.filter(c => (c.unit || '') === u).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(c =>
          `<label class="pc-item" data-name="${esc(c.name.toLowerCase())}"><input type="checkbox" value="${c.id}" ${preset.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')).join('')
        : '<div class="mt-empty">이 과목의 개념 지도에 개념이 없어요. 개념 미지정으로 추가할 수 있어요.</div>'}</div>
      <div class="an-sub" style="margin-top:6px">여러 개를 고르면 그 개념들 모두에 들어가요. Enter = ${esc(okLabel)}</div>`,
      buttons:[
        {label:'취소', onClick:() => finish(null)},
        {label:'개념 미지정으로', onClick:() => finish([])},
        {label:okLabel, primary:true, onClick:bg => {
          const ids = $$('#pcList input:checked', bg).map(x => x.value);
          if (!ids.length) { toast('개념을 하나 이상 고르거나 [개념 미지정으로]를 눌러 주세요', true); return false; }
          finish(ids);
        }}
      ]});
    const bg = m.el;
    // 바깥을 눌러 닫으면 취소
    new MutationObserver((_, ob) => { if (!bg.isConnected) { ob.disconnect(); finish(null); } }).observe($('#modalRoot'), {childList:true});
    $('#pcSearch', bg).oninput = e => { const k = e.target.value.trim().toLowerCase(); $$('.pc-item', bg).forEach(x => x.style.display = !k || x.dataset.name.includes(k) ? '' : 'none'); };
    bg.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $$('.modal-f .btn', bg).pop().click(); }
    });
  });
}
async function createMisWithCategory(q, name){
  if (!q.subject) { toast('과목을 먼저 입력해 주세요', true); return null; }
  if (S.ed) S.ed.picking = true;
  let ids;
  try {
    ids = await pickConcepts(q.subject, '오개념의 개념 범주 선택', `'<b>${esc(name)}</b>' 오개념을 어느 개념에 넣을까요?`, [], '이 개념에 추가');
  } finally { if (S.ed) S.ed.picking = false; }
  if (ids === null) return null;
  try {
    const list = await call('saveMisconception', {subject:q.subject, name, desc:'', conceptIds:ids});
    setMisList(q.subject, list);
    toast('오개념 목록에 새 오개념을 추가했어요');
    drawMisTree();
    return list.find(x => normName(x.name) === normName(name)) || null;
  } catch(e){ return null; }
}
/** 오개념을 다른 개념으로 이동(copy=false) 또는 복제(copy=true: 그 개념에도 소속) */
async function moveMis(m, from, to, copy){
  if (!m) return;
  const cids = (m.conceptIds || []).slice();
  if (to && cids.includes(to) && (copy || from === to)) return toast('이미 그 개념에 들어 있어요');
  let next;
  if (!to) next = copy ? cids : cids.filter(x => x !== from);   // '개념 미지정'으로: 이동이면 원래 개념에서만 빼기
  else next = copy ? cids.concat([to]) : cids.filter(x => x !== from).concat(cids.includes(to) ? [] : [to]);
  if (!to && copy) return toast('복제는 개념 위에 놓을 때만 돼요');
  const list = await call('saveMisconception', {...m, conceptIds:[...new Set(next)]});
  setMisList(m.subject, list);
  toast(copy ? `'${conceptName(to) || '?'}' 개념에도 넣었어요 (같은 오개념)` : to ? `'${conceptName(to) || '?'}' 개념으로 옮겼어요` : '개념 미지정으로 옮겼어요');
  drawMisTree();
  if (CM) drawSide();
}
/** 오개념 고치기 · 삭제 (이름을 바꾸면 이 오개념을 연결한 모든 선지에 함께 반영돼요) */
function editMisModal(m){
  if (!m) return toast('오개념 목록에 없는 오개념이에요', true);
  const used = S.questions.filter(q => (q.choiceMis || []).some(a => a.includes(m.id))).length;
  modal({title:'오개념 고치기', body:`
    <label class="f">오개념</label><input class="inp" id="emName" value="${esc(m.name)}">
    <label class="f">설명 (선택)</label><textarea class="inp" id="emDesc" rows="2">${esc(m.desc || '')}</textarea>
    <label class="f">개념 범주</label><div class="an-sub">${(m.conceptIds || []).map(id => esc(conceptName(id) || '?')).join(', ') || '개념 미지정'} · <a href="#" id="emCats">바꾸기</a></div>
    <div class="an-sub" style="margin-top:10px">이 오개념을 연결한 문제 ${used}개 · 이름을 바꾸면 연결된 선지에도 함께 바뀌어요</div>`,
    onOpen:bg => {
      $('#emCats', bg).onclick = async e => {
        e.preventDefault();
        const ids = await pickConcepts(m.subject, '개념 범주 바꾸기', `'<b>${esc(m.name)}</b>'이(가) 들어갈 개념`, m.conceptIds || [], '바꾸기');
        if (ids === null) return;
        setMisList(m.subject, await call('saveMisconception', {...m, conceptIds:ids}));
        bg.remove(); drawMisTree(); if (S.ed) drawPaper(); if (CM) drawSide(); toast('개념 범주를 바꿨어요');
      };
    },
    buttons:[
      {label:'오개념 삭제', cls:'danger', onClick:async () => {
        if (!await confirmBox(`'${m.name}' 오개념을 삭제할까요?${used ? `\n연결된 선지 ${used}곳에서도 빠져요.` : ''}`, '삭제', true)) return false;
        setMisList(m.subject, await call('deleteMisconception', m.id, m.subject));
        dropMisEverywhere(m.id);
        toast('삭제했어요');
      }},
      {label:'취소'},
      {label:'저장', primary:true, onClick:async bg => {
        const name = $('#emName', bg).value.trim();
        if (!name) { toast('오개념을 입력해 주세요', true); return false; }
        setMisList(m.subject, await call('saveMisconception', {...m, name, desc:$('#emDesc', bg).value}));
        if (S.ed) { drawPaper(); drawMisTree(); }
        if (CM) drawSide();
        toast('고쳤어요');
      }}
    ]});
}
/** 삭제한 오개념을 열려 있는 시트 · 문제 목록에서 빼기 (서버는 deleteMisconception 이 정리) */
function dropMisEverywhere(id){
  S.questions.forEach(q => { if (q.choiceMis) q.choiceMis = q.choiceMis.map(a => a.filter(x => x !== id)); });
  if (S.ed) { S.ed.sheets.forEach(sh => { sh.q.choiceMis = sh.q.choiceMis.map(a => a.filter(x => x !== id)); }); drawPaper(); drawMisTree(); }
  if (CM) drawSide();
}
/** AI에 보낼 때: 선지별 오개념을 이름으로 */
function aiLite(q){
  return {title:q.title, subject:q.subject, type:q.type, stem:q.stem, choices:q.choices, answer:q.answer,
    misconceptions:q.choices.map((_, i) => choiceMisNames(q, i).join(' / '))};
}
async function saveSheet(sh){
  const q = sh.q;
  if (S.ed && S.ed.editing && curSheet() === sh) { const inp = $(`#qEditor [data-in="${S.ed.editing}"]`); if (inp) commitEdit(inp.value); }
  if (!q.stem.trim()) return toast('발문을 입력해 주세요', true);
  if (q.type === 'mc') {
    if (q.choices.length < 2) return toast('선지를 2개 이상 만들어 주세요', true);
    if (q.choices.some((c, i) => !String(c).trim() && !q.choiceImages[i])) return toast('빈 선지가 있어요. 내용이나 그림을 넣거나 [선지 제거]를 눌러 주세요', true);
    if (!q.answer && !await confirmBox('정답이 표시되지 않았어요. 그래도 저장할까요?\n(선지 번호를 누르면 정답으로 표시돼요)', '저장')) return;
    // 아직 목록에 없는 오개념(AI 제안 등)은 저장 전에 개념 범주를 골라 목록에 추가
    for (let i = 0; i < q.pendingMis.length; i++) {
      while (q.pendingMis[i].length) {
        const name = q.pendingMis[i][0];
        const hit = S.miscons.find(m => m.subject === q.subject && normName(m.name) === normName(name));
        const m = hit || await createMisWithCategory(q, name);
        if (!m) return toast('오개념의 개념 범주를 고르지 않아 저장을 멈췄어요. 필요 없으면 그 오개념의 ×를 눌러 빼 주세요', true);
        q.pendingMis[i].shift();
        if (!q.choiceMis[i].includes(m.id)) q.choiceMis[i].push(m.id);
      }
    }
  }
  const r = await call('saveQuestion', q, sh.folderId);
  applyBank(r.bank); S.concepts = r.concepts; S.miscons = r.miscons; updateSubjList();
  sh.q = fixQ(r.question); sh.folderId = r.question.folderId || ''; sh.dirty = false;
  if (S.ed && S.ed.sheets.includes(sh)) drawEd();
  if ($('#exMain')) renderExplorer();
  toast(`'${folderName(sh.folderId)}'에 저장했어요`);
}
async function closeSheet(i){
  const ed = S.ed, sh = ed.sheets[i];
  if (sh.dirty && !await confirmBox(`'${sh.q.title || '새 문제'}'이(가) 저장되지 않았어요.\n그래도 닫을까요?`, '닫기', true)) return;
  ed.sheets.splice(i, 1);
  if (!ed.sheets.length) return closeEditor(true);
  if (ed.active >= i && ed.active > 0) ed.active--;
  ed.sel = null; ed.editing = null;
  drawEd();
}
async function closeEditor(force){
  const ed = S.ed;
  if (!ed) return;
  const n = ed.sheets.filter(s => s.dirty).length;
  if (!force && n && !await confirmBox(`저장하지 않은 문제가 ${n}개 있어요.\n그래도 편집 창을 닫을까요?`, '닫기', true)) return;
  S.ed = null;
  const el = $('#qEditor');
  if (el) el.remove();
  try { if (history.state && history.state.ed) history.replaceState({...history.state, ed:false}, ''); } catch(e){}
  renderTaskbar();
}
function renderTaskbar(){
  const tb = $('#taskbar');
  if (!tb) return;
  const ed = S.ed;
  tb.innerHTML = ed && ed.min
    ? `<span class="tb-label">접어 둔 편집 창</span><div class="tb-chip" id="tbEd"><b style="color:var(--blue)">Q</b><span>문제 ${ed.sheets.length}개 편집 중 · 다시 열기</span></div>`
    : '<span class="tb-label">문제를 누르면 편집 창이 열려요 · 편집 창의 [–]로 접어 둘 수 있어요</span>';
  const c = $('#tbEd');
  if (c) c.onclick = () => { S.ed.min = false; drawEd(); };
}
/** 문제 그림 (i 를 주면 그 선지의 그림) */
function pickImage(sh, i){
  const fi = $('#fileInput');
  fi.value = '';
  fi.onchange = async () => {
    const f = fi.files[0];
    if (!f) return;
    try {
      const dataUrl = await resizeImage(f, i == null ? 1400 : 600);
      const r = await call('uploadImage', dataUrl, f.name);
      if (i == null) sh.q.imageUrl = r.url; else if (i < sh.q.choices.length) sh.q.choiceImages[i] = r.url;
      markDirty(sh);
      if (curSheet() === sh) drawPaper();
      toast(i == null ? '이미지를 추가했어요' : `${i + 1}번 선지에 그림을 넣었어요`);
    } catch(e){}
  };
  fi.click();
}
function resizeImage(file, max){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = rej;
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', .88));
      };
      img.onerror = () => res(fr.result);
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------- 문제 만들기 (챗봇) ---------- */
function renderMaker(){
  const m = $('#maker');
  m.innerHTML = `
    <div class="mk-head"><h3>문제 만들기</h3>
      <p id="mkDesc"></p>
      <button class="ai-btn" id="aiBtn"></button></div>
    <div class="mk-opts">과목 <select class="inp" id="mkSubject">${subjectOptions(S.mkSubject, '과목을 고르세요')}</select></div>
    <div class="chat-log" id="chatLog"></div>
    <label class="ai-img ${S.aiImg ? 'on' : ''}" id="aiImgBox"><input type="checkbox" id="aiImg" ${S.aiImg ? 'checked' : ''}>
      <span class="ai-img-ic" aria-hidden="true"><svg viewBox="0 0 108 100"><path d="M14 86L40 14L66 86M25 66H55"/><path d="M90 16V84" stroke-width="20"/></svg></span><span class="ai-img-t"><b>AI로 이미지 만들기</b><small>새로 만든 문제에 어울리는 그림을 함께 넣어요</small></span><span class="ai-img-sw"></span></label>
    <div class="chat-input"><textarea id="chatIn"></textarea><button id="chatSend">보내기</button></div>`;
  $('#aiBtn').onclick = () => { S.aiOn = !S.aiOn; paintAi(); };
  $('#aiImg').onchange = e => { S.aiImg = e.target.checked; $('#aiImgBox').classList.toggle('on', S.aiImg); };
  $('#mkSubject').onchange = e => { S.mkSubject = e.target.value; if (S.mkSubject) subjectHello(S.mkSubject); };
  $('#chatSend').onclick = sendChat;
  $('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); } });
  paintAi();
  renderChat();
}
function paintAi(){
  const b = $('#aiBtn');
  b.className = 'ai-btn' + (S.aiOn ? ' on' : '');
  b.innerHTML = `AI 문제제작 <span class="sw">${S.aiOn ? 'ON' : 'OFF'}</span>`;
  $('#mkDesc').textContent = S.aiOn ? 'AI와 대화하며 문제를 만들어요. 만든 문제는 왼쪽 편집 창에 시트로 떠요. 편집 창이 열려 있으면 "2번 선지를 바꿔줘"처럼 고쳐 달라고 할 수도 있어요.'
    : '문제를 직접 붙여넣으면 문제 서식(문항·선지·정답)에 맞게 정리해 드려요.';
  $('#chatIn').placeholder = S.aiOn ? '예) 역학적 에너지 보존 개념으로 5지선다 문제 만들어줘' :
    '문제를 그대로 입력하세요.\n예)\n1. 다음 중 옳은 것은?\n① ... ② ... ③ ...\n정답: ②';
}
function renderChat(){
  const log = $('#chatLog');
  if (!log) return;
  log.innerHTML = S.chatLog.map(m => `<div class="bub ${m.who}">${esc(m.text)}${m.link ? `<a class="bub-link" href="${esc(m.link.url)}" target="_blank" rel="noopener">${esc(m.link.label)}</a>` : ''}</div>`).join('');
  log.scrollTop = log.scrollHeight;
}
/** 과목별 교육과정 해설서 (나머지 과목은 나중에 추가) */
const CURRICULUM = {'물리학': '/curriculum/physics.pdf'};
/** 과목을 고르면 챗봇이 그 과목으로 안내하고, 해설서가 있으면 맨 아래에 '성취기준' 링크 */
function subjectHello(subject){
  const url = CURRICULUM[subject];
  S.chatLog.push({who:'ai', text:`${subject} 문제를 만들어 볼게요. 어떤 문제를 만들어 드릴까요?\n예) "${subject}에서 확인하고 싶은 개념으로 5지선다 문제 하나 만들어줘"` +
    (url ? '\n\n출제할 때 아래 성취기준을 참고해 보세요.\n' : ''), link: url ? {label:'성취기준', url} : null});
  renderChat();
}
/** 그림을 만들어 달라는 말인지 ("그림도 만들어줘", "이미지 넣어줘" …) */
function wantsImage(text){ return /(그림|이미지|삽화|도식|사진|일러스트)/.test(text) && /(만들|그려|그리|넣|추가|생성|붙|바꿔|다시)/.test(text); }
/**
 * 말이 '새 문제' 요청인지 '지금 문제 고치기' 요청인지 (AI 판단을 이걸로 바로잡아요)
 *  - new: 새 / 하나 더 / 다른 문제 / 문제를 만들어(내) 줘
 *  - edit: 바꿔 · 고쳐 · 수정 · 더 어렵게 · 선지 · 발문 · 정답 · 이 문제 …
 */
function chatIntent(text){
  const t = String(text).replace(/\s+/g, ' ');
  if (/(새로운?\s*문제|새\s*문항|하나\s*더|한\s*문제\s*더|다른\s*문제|문제를?\s*(하나\s*)?(더|또)\s*(만들|내|출제)|(\d+|두|세|네|다섯)\s*(개|문제|문항))/.test(t)) return 'new';
  if (/(바꿔|바꾸|고쳐|고치|수정|변경|다듬|교체|빼\s*줘|빼고|지워|추가해|늘려|줄여|어렵게|쉽게|선지|보기|발문|정답|이\s*문제|위\s*문제|방금\s*(그|만든)|그\s*문제)/.test(t)) return 'edit';
  if (/(문제|문항).*(만들어|만들|출제|내\s*줘|내줘|생성)/.test(t)) return 'new';
  return '';
}
/** AI가 만든 문제는 개념 · 오개념을 연결하지 않고 넘김 (교사가 편집 창에서 직접 추가) */
function bareQ(q){ q = Object.assign({}, q); q.conceptIds = []; q.newConcepts = []; q.choiceMis = (q.choices || []).map(() => []); q.pendingMis = (q.choices || []).map(() => []); q.explanation = ''; return q; }
/** 챗봇이 고친 문제를 편집 중인 시트에 반영 (선지 내용이 그대로인 선지는 연결해 둔 오개념 유지) */
function applyAiEdit(sh, nq){
  const q = sh.q;
  nq = fixQ(nq);
  const old = q.choices.map((c, i) => ({c:normName(c), mis:q.choiceMis[i], pend:q.pendingMis[i], img:q.choiceImages[i]}));
  const keep = c => old.find(x => x.c && x.c === normName(c));
  q.stem = nq.stem || q.stem; q.type = nq.type; q.answer = nq.answer;
  if (!q.title) q.title = nq.title;
  q.choiceMis = nq.choices.map((c, i) => keep(c) ? keep(c).mis.slice() : nq.choiceMis[i]);
  q.pendingMis = nq.choices.map((c, i) => keep(c) ? keep(c).pend.slice() : nq.pendingMis[i]);
  q.choiceImages = nq.choices.map((c, i) => keep(c) ? keep(c).img : (!nq.choices[i] && q.choiceImages[i]) || '');
  q.choices = nq.choices;
  ansList(q).forEach(x => { const a = Number(x) - 1; if (a >= 0 && a < q.choices.length) { q.choiceMis[a] = []; q.pendingMis[a] = []; } });
  sh.dirty = true;
  if (S.ed) { S.ed.sel = null; S.ed.editing = null; S.ed.active = S.ed.sheets.indexOf(sh); S.ed.min = false; drawEd(); }
}
async function makeAiImage(sh, request){
  if (!sh.q.stem.trim()) { S.chatLog.push({who:'sys', text:'발문이 있어야 그림을 만들 수 있어요'}); return renderChat(); }
  const note = {who:'sys', text:'문제에 어울리는 그림을 만드는 중… (1분 정도 걸려요)'};
  S.chatLog.push(note); renderChat();
  try {
    const r = await call('aiImage', sh.q, request || '');
    sh.q.imageUrl = r.url; markDirty(sh);
    if (curSheet() === sh) drawPaper();
    note.text = '문제에 그림을 넣었어요' + (r.note ? ' (' + r.note + ')' : '');
  } catch(e) { note.text = '그림을 만들지 못했어요: ' + ((e && e.message) || e).toString().replace(/^Error:\s*/, ''); }
  renderChat();
}
async function sendChat(){
  const inp = $('#chatIn');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  S.chatLog.push({who:'me', text});
  const typing = {who:'ai typing', text:S.aiOn ? '문제를 만드는 중…' : '서식에 맞춰 정리하는 중…'};
  S.chatLog.push(typing); renderChat();
  try {
    if (S.aiOn) {
      const cur = S.ed && S.ed.sheets.length ? curSheet() : null;
      S.chat.push({role:'user', content:text});
      const r = await call('aiChat', S.chat, S.mkSubject, cur ? aiLite(cur.q) : null, chatIntent(text));
      S.chat.push({role:'assistant', content:r.reply + (r.question ? '\n[문제] ' + JSON.stringify(r.question) : '')});
      S.chatLog.splice(S.chatLog.indexOf(typing), 1);
      // 그림 요청: AI가 알려 주거나("image": true) 말에 '그림 … 만들어/넣어' 가 있으면 편집 창의 문제에 그림을 만들어 넣음
      const img = !!r.image || wantsImage(text);
      S.chatLog.push({who:'ai', text:r.reply || (r.question ? '문제를 만들었어요.' : img ? '그림을 만들게요.' : '')});
      // AI가 mode 를 잘못 줄 때가 있어서, 말에 '새 문제'가 분명하면 새 시트 · '고쳐/바꿔'면 지금 시트를 고침
      const intent = chatIntent(text);
      const asEdit = intent === 'edit' ? true : intent === 'new' ? false : r.mode === 'edit';
      if (r.question && asEdit && cur && S.ed && S.ed.sheets.includes(cur)) {
        applyAiEdit(cur, bareQ(r.question));
        S.chatLog.push({who:'sys', text:'편집 중인 문제를 고쳤어요'});
        if (img) makeAiImage(cur, text);
      } else if (r.question) {
        const sh = openQWin(bareQ(r.question));
        S.chatLog.push({who:'sys', text:'왼쪽 편집 창에 새 시트로 띄웠어요 · 개념과 오개념은 편집 창에서 직접 추가하세요'});
        if ((S.aiImg || img) && sh) makeAiImage(sh, img ? text : '');
      } else if (img) {
        if (cur) makeAiImage(cur, text);
        else S.chatLog.push({who:'sys', text:'그림을 넣을 문제가 없어요. 먼저 문제를 만들거나 편집 창에서 문제를 연 뒤 말씀해 주세요'});
      }
    } else {
      const r = await call('aiFormat', text, S.mkSubject);
      S.chatLog.splice(S.chatLog.indexOf(typing), 1);
      S.chatLog.push({who:'ai', text:(r.note ? r.note + '\n' : '') + '문제 서식으로 정리했어요. 왼쪽 편집 창에서 확인하세요.'});
      const sh = openQWin(bareQ(r.question));
      if (S.aiImg && sh) makeAiImage(sh);
    }
  } catch(e) {
    const i = S.chatLog.indexOf(typing); if (i >= 0) S.chatLog.splice(i, 1);
    S.chatLog.push({who:'sys', text:'오류: ' + ((e && e.message) || e).toString().replace(/^Error:\s*/, '')});
  }
  renderChat();
}

/* =====================================================================
 *  2. 수업하기
 * ===================================================================== */
function schedText(c){ return (c.schedule || []).map(s => `${DAYS[s.day]} ${s.start}~${s.end}`).join(' / '); }
function statusLabel(s){ return {active:'운영중', ready:'준비중', ended:'종료'}[s] || s; }
/** 클래스 전체보기의 과목 필터 (고른 과목이 없으면 전부) */
const CLS_FILTER = new Set();
function renderClasses(){
  const tab = S.params.tab === 'ended' ? 'ended' : 'active';
  S.classTab = tab;
  const main = $('#main');
  const subs = SUBJECT_CHOICES.concat(S.classes.map(c => c.subject).filter(x => x && SUBJECT_CHOICES.indexOf(x) < 0).filter((x, i, a) => a.indexOf(x) === i).sort(subjSort));
  [...CLS_FILTER].forEach(x => { if (subs.indexOf(x) < 0) CLS_FILTER.delete(x); });
  const inTab = S.classes.filter(c => tab === 'ended' ? c.status === 'ended' : c.status !== 'ended');
  const count = x => inTab.filter(c => c.subject === x).length;
  main.innerHTML = `<div class="page-title"><h1>수업하기</h1><span class="grow"></span>
      <button class="btn big" id="goRoster">학생 목록 관리</button>
      <button class="btn primary big" id="addClass">+ 수업 추가하기</button></div>
    <div class="tabs">${[['active', '운영 중인 클래스'], ['ended', '종료된 클래스']]
      .map(t => `<div class="tab ${tab === t[0] ? 'on' : ''}" data-tab="${t[0]}">${t[1]}</div>`).join('')}</div>
    <div class="cls-filter"><span class="cf-l">과목</span>
      ${subs.map(x => `<label class="cf-chk ${count(x) ? '' : 'none'}"><input type="checkbox" value="${esc(x)}" ${CLS_FILTER.has(x) ? 'checked' : ''}> ${esc(x)} <small>${count(x)}</small></label>`).join('')}
      ${CLS_FILTER.size ? '<button class="btn sm" id="cfClear">전체 보기</button>' : ''}</div>
    <div id="clsBody"></div>`;
  $('#addClass').onclick = addClassModal;
  $('#goRoster').onclick = () => go('roster');
  $$('.tab', main).forEach(t => t.onclick = () => go('classes', {tab:t.dataset.tab}));
  $$('.cf-chk input', main).forEach(i => i.onchange = () => { if (i.checked) CLS_FILTER.add(i.value); else CLS_FILTER.delete(i.value); renderClasses(); });
  if ($('#cfClear')) $('#cfClear').onclick = () => { CLS_FILTER.clear(); renderClasses(); };
  const list = inTab.filter(c => !CLS_FILTER.size || CLS_FILTER.has(c.subject));
  $('#clsBody').innerHTML = list.length ? `<div class="cgrid">${list.map(c => {
    const st = subjStyle(c.subject);
    return `<div class="ccard" data-cid="${c.id}">
      <div class="cc-head" style="background:${st.color}">${st.icon}${subjTitle(c.subject || '과목', 38)}</div>
      <div class="cc-body">
        <div class="badges"><span class="b-st ${c.status}">${statusLabel(c.status)}</span><span class="b-sem">${esc(c.semesterName)}</span></div>
        <div class="cc-name">${esc(c.name)}</div>
        <div class="cc-hr">${c.homeroomLabel ? '학생 명단 · ' + esc(c.homeroomLabel) : '<span style="color:var(--danger)">학생 명단 연결 안 됨</span>'}</div>
        <div class="cc-next">${c.next ? `다음 수업 · ${fmtDate(c.next.date)} ${c.next.no}차시` : `전체 ${c.lessonCount}차시`}</div>
        <div class="cc-intro">클래스 소개 ${IC.info}</div>
        <div class="cc-sched"><span>${esc(c.intro || schedText(c))}</span><a data-edit="${c.id}">수정</a></div>
        <button class="cc-go" data-go="${c.id}">${IC.play} 수업하기</button>
      </div></div>`;
  }).join('')}</div>` : `<div class="empty">${CLS_FILTER.size ? '고른 과목의 클래스가 없어요.' : tab === 'ended' ? '종료된 클래스가 없어요.' : '아직 클래스가 없어요. [+ 수업 추가하기]를 눌러 반을 만들어 보세요.'}</div>`;
  $$('[data-go]').forEach(b => b.onclick = () => go('classLessons', {classId:b.dataset.go}));
  $$('[data-edit]').forEach(b => b.onclick = () => editClassModal(S.classes.find(c => c.id === b.dataset.edit)));
}
function currentSemesterId(){
  const s = S.semesters.find(x => x.start <= S.today && S.today <= x.end) || S.semesters.filter(x => x.start > S.today).sort((a, b) => a.start < b.start ? -1 : 1)[0];
  return s ? s.id : (S.semesters[0] || {}).id;
}
function countLessons(semId, slots){
  const sem = S.semesters.find(s => s.id === semId);
  if (!sem || !slots.length) return 0;
  const hs = new Set(S.holidays.map(h => h.date));
  let n = 0;
  const d = new Date(sem.start + 'T00:00:00Z'), end = new Date(sem.end + 'T00:00:00Z');
  while (d <= end) {
    if (!hs.has(d.toISOString().slice(0, 10))) n += slots.filter(s => Number(s.day) === d.getUTCDay()).length;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}
/* ---------- 과목 고르기 (수업 추가 · 클래스 수정) ----------
 * 브라우저 자동완성 목록(datalist)은 창 안에서 모양이 깨지는 경우가 있어 선택 상자로.
 * 기본 과목 + 이미 쓰고 있는 과목, 목록에 없으면 '직접 입력'. */
const SUBJECT_CHOICES = ['중학 과학1', '중학 과학2', '중학 과학3', '통합과학', '물리학', '역학과 에너지', '전자기와 양자'];
function subjectField(id, value){
  value = String(value || '').trim();
  const list = SUBJECT_CHOICES.concat(allSubjects().filter(s => SUBJECT_CHOICES.indexOf(s) < 0));
  if (value && list.indexOf(value) < 0) list.push(value);
  return `<select class="inp" id="${id}">
      <option value="" ${value ? '' : 'selected'} disabled>과목을 고르세요</option>
      ${list.map(s => `<option value="${esc(s)}" ${s === value ? 'selected' : ''}>${esc(s)}</option>`).join('')}
      <option value="__custom">직접 입력…</option>
    </select>
    <input class="inp hidden" id="${id}Custom" placeholder="과목명을 입력하세요" style="margin-top:6px">`;
}
function bindSubjectField(id, bg){
  const sel = $('#' + id, bg), inp = $('#' + id + 'Custom', bg);
  sel.addEventListener('change', () => { inp.classList.toggle('hidden', sel.value !== '__custom'); if (sel.value === '__custom') inp.focus(); });
}
function subjectValue(id, bg){
  const sel = $('#' + id, bg);
  return sel.value === '__custom' ? $('#' + id + 'Custom', bg).value.trim() : sel.value;
}
function addClassModal(){
  const schedRow = (s) => `<div class="sched-row"><select data-k="day">${DAYS.map((d, i) => `<option value="${i}" ${Number(s.day) === i ? 'selected' : ''}>${d}요일</option>`).join('')}</select>
    <input type="time" data-k="start" value="${s.start}"> ~ <input type="time" data-k="end" value="${s.end}"><button class="btn ghost" data-rm>×</button></div>`;
  const m = modal({title:'수업 추가하기', wide:false, body:`
    <label class="f">학기</label><div class="row"><select class="inp" id="ncSem">${S.semesters.map(s => `<option value="${s.id}" ${s.id === currentSemesterId() ? 'selected' : ''}>${esc(s.name)} (${s.start} ~ ${s.end})</option>`).join('')}</select>
      <button class="btn" id="ncSemMgr" style="flex:none">학기 관리</button></div>
    <label class="f">학생 명단 (학년 · 반)</label><div class="row"><select class="inp" id="ncHr">${homeroomOptions('', '고르세요 (학생 목록 관리에서 만든 반)')}</select>
      <button class="btn" id="ncHrMgr" style="flex:none">학생 목록 관리</button></div>
    <label class="f">클래스 이름</label><input class="inp" id="ncName" placeholder="예) 2학년 3반">
    <label class="f">과목</label>${subjectField('ncSubj', '')}
    <label class="f">요일과 수업 시간</label><div id="ncSched">${schedRow({day:1, start:'09:00', end:'09:45'})}</div>
    <button class="btn" id="ncAdd">+ 시간 추가</button>
    <div class="preview-note" id="ncPrev"></div>`,
    buttons:[{label:'취소'}, {label:'클래스 만들기', primary:true, onClick:async bg => {
      const schedule = $$('.sched-row', bg).map(r => ({day:Number($('[data-k=day]', r).value), start:$('[data-k=start]', r).value, end:$('[data-k=end]', r).value})).filter(s => s.start && s.end).filter((s, i, a) => a.findIndex(t => t.day === s.day && t.start === s.start && t.end === s.end) === i);
      if (!subjectValue('ncSubj', bg)) { toast('과목을 골라 주세요', true); return false; }
      if (!$('#ncHr', bg).value && !await confirmBox('학생 명단(학년 · 반)을 고르지 않았어요. 이대로 만들면 학생이 이 클래스 수업에 들어올 수 없어요.\n나중에 클래스 수정에서 연결할 수 있어요. 그래도 만들까요?', '만들기')) return false;
      const r = await call('createClass', {semesterId:$('#ncSem', bg).value, name:$('#ncName', bg).value, subject:subjectValue('ncSubj', bg), schedule, homeroomId:$('#ncHr', bg).value});
      S.classes = r.classes; updateSubjList(); renderNav();
      toast(`클래스를 만들고 ${r.lessonCount}개의 수업 차시를 자동으로 만들었어요`);
      go('classLessons', {classId:r.classId});
    }}]});
  const bg = m.el;
  const upd = () => {
    const slots = $$('.sched-row', bg).map(r => ({day:Number($('[data-k=day]', r).value)}));
    const n = countLessons($('#ncSem', bg).value, slots);
    $('#ncPrev', bg).textContent = `학기 달력(공휴일 제외)을 바탕으로 수업 차시 ${n}개가 자동으로 만들어져요.`;
  };
  $('#ncAdd', bg).onclick = () => { $('#ncSched', bg).insertAdjacentHTML('beforeend', schedRow({day:3, start:'10:00', end:'10:45'})); upd(); };
  $('#ncSched', bg).addEventListener('click', e => { if (e.target.closest('[data-rm]') && $$('.sched-row', bg).length > 1) { e.target.closest('.sched-row').remove(); upd(); } });
  bg.addEventListener('change', upd);
  $('#ncSemMgr', bg).onclick = () => { m.close(); go('settings'); };
  $('#ncHrMgr', bg).onclick = () => { m.close(); go('roster'); };
  bindSubjectField('ncSubj', bg);
  // 반을 고르면 클래스 이름이 비어 있을 때 '1학년 3반'으로 채움
  $('#ncHr', bg).addEventListener('change', e => {
    const h = S.homerooms.find(x => x.id === e.target.value), n = $('#ncName', bg);
    if (h && (!n.value.trim() || n.dataset.auto)) { n.value = `${h.grade}학년 ${h.className}`; n.dataset.auto = '1'; }
  });
  $('#ncName', bg).addEventListener('input', e => delete e.target.dataset.auto);
  upd();
}
function editClassModal(c){
  const m = modal({title:'클래스 수정', body:`
    <label class="f">클래스 이름</label><input class="inp" id="ecName" value="${esc(c.name)}">
    <label class="f">과목</label>${subjectField('ecSubj', c.subject)}
    <label class="f">학생 명단 (학년 · 반)</label><select class="inp" id="ecHr">${homeroomOptions(c.homeroomId || '', '연결 안 함')}</select>
    <label class="f">클래스 소개 (비워두면 수업 시간이 표시돼요)</label><input class="inp" id="ecIntro" value="${esc(c.intro || '')}" placeholder="${esc(schedText(c))}">`,
    buttons:[
      {label:'클래스 삭제', cls:'danger', onClick:async () => {
        if (!await confirmBox(`'${c.name}' 클래스와 모든 차시를 삭제할까요?`, '삭제', true)) return false;
        const r = await call('deleteClass', c.id); S.classes = r.classes; renderNav(); go('classes'); toast('삭제했어요');
      }},
      {label:'취소'},
      {label:'저장', primary:true, onClick:async bg => {
        if (!subjectValue('ecSubj', bg)) { toast('과목을 골라 주세요', true); return false; }
        const r = await call('updateClass', c.id, {name:$('#ecName', bg).value, subject:subjectValue('ecSubj', bg), intro:$('#ecIntro', bg).value, homeroomId:$('#ecHr', bg).value});
        S.classes = r.classes; updateSubjList(); renderNav(); go(S.view, S.params);
      }}
    ]});
  bindSubjectField('ecSubj', m.el);
}
async function renderClassLessons(){
  const main = $('#main');
  main.innerHTML = '<div class="empty">불러오는 중…</div>';
  const r = await call('getLessons', S.params.classId);
  if (S.view !== 'classLessons') return;
  const c = r.cls;
  main.innerHTML = `<div class="page-title"><button class="btn" id="back">‹ 클래스 목록</button>
      <h1>${esc(c.name)}</h1><span class="pill">${esc(c.subject)}</span><span class="pill gray">${esc(c.semesterName)}</span><span class="grow"></span>
      <button class="btn" id="addL">+ 차시 추가</button><button class="btn" id="editC">클래스 수정</button></div>
    <p style="color:var(--sub);margin:-6px 0 14px">${esc(schedText(c))} · 차시를 누르면 문제를 구성할 수 있어요.</p>
    <table class="ltable"><thead><tr><th style="width:70px">차시</th><th style="width:130px">날짜</th><th style="width:130px">시간</th><th>제목</th><th style="width:90px">문제</th><th style="width:90px">상태</th><th style="width:250px"></th></tr></thead>
    <tbody>${r.lessons.map(l => `<tr class="lrow ${l.date < S.today ? 'past' : ''} ${l.date === S.today ? 'today' : ''}" data-id="${l.id}">
      <td><b>${l.no}</b></td><td>${fmtDate(l.date)}${l.date === S.today ? ' <span class="pill ok">오늘</span>' : ''}</td><td>${esc(l.time)}</td>
      <td>${esc(l.title || '')}</td><td>${(l.questionIds || []).length}개</td>
      <td>${l.done ? '<span class="pill ok">완료</span>' : '<span class="pill gray">예정</span>'}</td>
      <td style="text-align:right"><button class="btn" data-q="${l.id}">문제 구성</button> <button class="btn start" data-start="${l.id}">${IC.play} 수업시작</button> <button class="btn ghost" data-del="${l.id}" title="차시 삭제">×</button></td>
    </tr>`).join('')}</tbody></table>
    ${r.lessons.length ? '' : '<div class="empty">차시가 없어요. [+ 차시 추가]로 만들어 보세요.</div>'}`;
  $('#back').onclick = () => go('classes');
  $('#editC').onclick = () => editClassModal(c);
  $('#addL').onclick = () => {
    modal({title:'차시 추가', body:`<label class="f">날짜</label><input class="inp" type="date" id="alD" value="${S.today}">
      <label class="f">시간</label><input class="inp" id="alT" placeholder="예) 10:00~10:45">`, buttons:[{label:'취소'}, {label:'추가', primary:true, onClick:async bg => {
        await call('addLesson', c.id, $('#alD', bg).value, $('#alT', bg).value); go('classLessons', S.params);
      }}]});
  };
  $$('tr.lrow').forEach(tr => tr.onclick = e => {
    if (e.target.closest('[data-start]')) return startClass(e.target.closest('[data-start]').dataset.start);
    if (e.target.closest('[data-del]')) return (async () => {
      if (!await confirmBox('이 차시를 삭제할까요?', '삭제', true)) return;
      await call('deleteLesson', tr.dataset.id); go('classLessons', S.params);
    })();
    go('lesson', {lessonId:tr.dataset.id});
  });
}
let lessonState = null;
async function renderLesson(){
  const main = $('#main');
  main.innerHTML = '<div class="empty">불러오는 중…</div>';
  const r = await call('getLessonDetail', S.params.lessonId);
  if (S.view !== 'lesson') return;
  lessonState = {lesson:r.lesson, cls:r.cls, ids:(r.lesson.questionIds || []).filter(id => S.questions.some(q => q.id === id)), open:new Set([''])};
  const l = r.lesson;
  main.innerHTML = `<div class="page-title"><button class="btn" id="back">‹ 차시 목록</button>
      <h1>${esc(r.cls ? r.cls.name : '')} · ${l.no}차시</h1><span class="pill gray">${fmtDate(l.date)} ${esc(l.time)}</span>
      <span class="grow"></span><span class="saved-ind" id="savedInd"></span>
      <button class="btn start big" id="startBtn">${IC.play} 수업시작</button></div>
    <div class="lesson-split">
      <div class="ls-left"><div class="ls-h">이 차시의 문제 <span class="pill" id="lqCount"></span><span class="grow"></span><span style="font-weight:400;color:var(--sub);font-size:12px">끌어서 순서 변경 · 오른쪽에서 끌어와 추가</span></div>
        <div class="ls-drop" id="lsDrop"></div></div>
      <div class="ls-right"><div class="ls-h">문제은행<span class="grow"></span><input class="search" id="treeSearch" placeholder="문제 검색" style="width:170px"></div>
        <div class="tree" id="tree"></div></div>
    </div>`;
  $('#back').onclick = () => go('classLessons', {classId:l.classId});
  $('#startBtn').onclick = () => startClass(l.id);
  $('#treeSearch').oninput = () => renderTree();
  bindLessonDnD();
  renderLessonQs(); renderTree();
}
function renderLessonQs(){
  const drop = $('#lsDrop');
  const ids = lessonState.ids;
  $('#lqCount').textContent = ids.length + '문제';
  drop.innerHTML = ids.length ? ids.map((id, i) => {
    const q = S.questions.find(x => x.id === id);
    return `<div class="lq" draggable="true" data-idx="${i}" data-qid="${id}"><span class="lq-no">${i + 1}</span>
      <button class="lq-del" data-rm="${i}" title="이 차시에서 빼기">${IC.trash}</button>
      <div class="lq-paper">${renderQ(q, {answer:false})}</div></div>`;
  }).join('') : '<div class="lq-empty">오른쪽 문제은행에서 문제를 이곳으로 끌어다 놓으세요.<br>(또는 문제 옆 + 버튼)</div>';
  $$('[data-rm]', drop).forEach(b => b.onclick = e => { e.stopPropagation(); lessonState.ids.splice(Number(b.dataset.rm), 1); lessonChanged(); });
  $$('.lq', drop).forEach(c => c.ondblclick = () => previewQ(S.questions.find(q => q.id === c.dataset.qid)));
}
function previewQ(q){
  if (!q) return;
  modal({title:q.title, wide:true, body:renderQ(q, {answer:true, mis:true, concepts:true, noTitle:true}) + '<div class="an-sub" style="margin-top:8px">더블클릭하거나 [수정하기]를 누르면 문제은행 편집 창에서 고칠 수 있어요.</div>',
    onOpen:bg => $('.qv', bg).addEventListener('dblclick', () => { bg.remove(); editQ(q); }),
    buttons:[{label:'닫기'}, {label:'수정하기', primary:true, onClick:() => editQ(q)}]});
}
/** 문제은행 편집 창에서 이 문제 열기 */
function editQ(q){
  if (S.view !== 'bank') { S.cwd = q.folderId || ''; go('bank'); }
  openQWin(q);
}
function renderTree(){
  const kw = ($('#treeSearch').value || '').trim().toLowerCase();
  const used = new Set(lessonState.ids);
  const qItem = q => {
    const cn = qConceptNames(q);
    return `<div class="tree-q ${used.has(q.id) ? 'used' : ''}" draggable="true" data-qid="${q.id}">
      <span class="qtype ${q.type}">${q.type === 'mc' ? '객' : '단'}</span><span class="tq-main"><span class="tt" title="${esc(q.stem)}">${esc(q.title)}</span>
      <span class="tq-con">${cn.length ? cn.map(n => `<i>${esc(n)}</i>`).join('') : '<em>연결된 개념 없음</em>'}</span></span>
      <button class="add" data-add="${q.id}" title="추가">+</button></div>`;
  };
  let html;
  if (kw) {
    const qs = S.questions.filter(q => (q.title + ' ' + q.stem).toLowerCase().includes(kw));
    html = qs.length ? qs.map(qItem).join('') : '<div class="empty">검색 결과가 없어요</div>';
  } else {
    const walk = (pid) => S.folders.filter(f => (f.parentId || '') === pid).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(f => {
      const open = lessonState.open.has(f.id);
      const n = countDeep(f.id);   // 하위 폴더에 든 문제까지
      return `<div class="tree-f ${open ? 'open' : ''}" data-tf="${f.id}"><span class="arr">▶</span>${IC.folder.replace('<svg', '<svg width="18" height="18"')}${esc(f.name)} <small style="color:#999">${n}문제</small></div>
        ${open ? `<div class="tree-kids">${walk(f.id)}${S.questions.filter(q => q.folderId === f.id).map(qItem).join('')}</div>` : ''}`;
    }).join('');
    html = walk('') + S.questions.filter(q => !q.folderId).map(qItem).join('');
    if (!S.questions.length) html = '<div class="empty">문제은행이 비어 있어요.</div>';
  }
  $('#tree').innerHTML = html;
  $$('[data-tf]').forEach(f => f.onclick = () => { const id = f.dataset.tf; lessonState.open.has(id) ? lessonState.open.delete(id) : lessonState.open.add(id); renderTree(); });
  $$('[data-add]').forEach(b => b.onclick = () => { if (!lessonState.ids.includes(b.dataset.add)) { lessonState.ids.push(b.dataset.add); lessonChanged(); } });
  $$('.tree-q').forEach(q => q.ondblclick = () => previewQ(S.questions.find(x => x.id === q.dataset.qid)));
}
function bindLessonDnD(){
  const drop = $('#lsDrop'), tree = $('#tree');
  tree.addEventListener('dragstart', e => { const t = e.target.closest('.tree-q'); if (t) e.dataTransfer.setData('text/plain', 'add:' + t.dataset.qid); });
  drop.addEventListener('dragstart', e => {
    const t = e.target.closest('.lq');
    if (!t) return;
    e.dataTransfer.setData('text/plain', 'mv:' + t.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
    // 축소해 그린 문제 카드는 끌 때 잘려 보여서, 번호 · 제목만 담은 꼬리표를 끌기 그림으로
    const q = S.questions.find(x => x.id === t.dataset.qid);
    const g = document.createElement('div');
    g.className = 'lq-ghost';
    g.innerHTML = `<b>${Number(t.dataset.idx) + 1}</b>${esc((q && (q.title || q.stem)) || '문제')}`;
    document.body.appendChild(g);
    try { e.dataTransfer.setDragImage(g, 16, 16); } catch(err){}
    setTimeout(() => g.remove(), 0);
    t.classList.add('dragging');
  });
  drop.addEventListener('dragend', e => { const t = e.target.closest('.lq'); if (t) t.classList.remove('dragging'); });
  drop.addEventListener('dragover', e => {
    e.preventDefault(); drop.classList.add('hot');
    $$('.lq', drop).forEach(x => x.classList.toggle('drag-over', x === e.target.closest('.lq')));
  });
  drop.addEventListener('dragleave', e => { if (!drop.contains(e.relatedTarget)) { drop.classList.remove('hot'); $$('.lq', drop).forEach(x => x.classList.remove('drag-over')); } });
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('hot');
    const raw = e.dataTransfer.getData('text/plain');
    const over = e.target.closest('.lq');
    let pos = over ? Number(over.dataset.idx) : lessonState.ids.length;
    const ids = lessonState.ids;
    if (raw.startsWith('add:')) {
      const id = raw.slice(4);
      if (ids.includes(id)) return toast('이미 추가된 문제예요');
      ids.splice(pos, 0, id);
    } else if (raw.startsWith('mv:')) {
      const from = Number(raw.slice(3));
      const [it] = ids.splice(from, 1);
      if (from < pos) pos--;
      ids.splice(over ? pos : ids.length, 0, it);
    } else return;
    lessonChanged();
  });
}
function lessonChanged(){
  renderLessonQs(); renderTree();
  $('#savedInd').textContent = '저장 중…';
  clearTimeout(lessonState.t);
  lessonState.t = setTimeout(async () => {
    try { await call('setLessonQuestions', lessonState.lesson.id, lessonState.ids); $('#savedInd') && ($('#savedInd').textContent = '자동 저장됨'); } catch(e){}
  }, 600);
}
function startClass(lessonId){
  const url = '/teacher/widget?lesson=' + encodeURIComponent(lessonId);   // 교사 확인은 로그인 쿠키로 (기존 주소의 토큰 파라미터 없앰)
  const win = window.open(url, 'qc_widget', 'width=430,height=760,left=40,top=40,menubar=no,toolbar=no,location=no,status=no');
  if (!win) {
    modal({title:'수업 위젯 열기', body:`<div class="modal-msg">팝업이 차단되었어요. 아래 버튼을 눌러 위젯을 열어 주세요.</div>
      <a class="btn primary big" href="${esc(url)}" target="_blank" style="text-decoration:none">수업 위젯 열기</a>`});
  } else toast('수업 위젯을 열었어요. PPT 옆에 두고 사용하세요');
}

/* ---------- 학생 목록 관리 (학교 › 학년 › 반 › 학생) ---------- */
let RS = null;   // {hid, students, sel:Set}
/** 학년도 (3월 ~ 다음 해 2월) */
function curSchoolYear(){ const [y, m] = String(S.today || '').split('-').map(Number); return y ? (m <= 2 ? y - 1 : y) : new Date().getFullYear(); }
/** 클래스에 연결할 반 고르기: 학년도가 끝난 반은 빼요 (지금 연결된 반은 그대로 보여 줌) */
function homeroomOptions(sel, none){
  const hs = (S.homerooms || []).filter(h => !h.expired || h.id === sel);
  const groups = [...new Set(hs.map(h => h.year + '\u0000' + h.school))].sort((a, b) => b.localeCompare(a, 'ko'));
  return `<option value="">${esc(none || '연결 안 함')}</option>` + groups.map(g => {
    const [y, sc] = g.split('\u0000');
    return `<optgroup label="${esc(y + '학년도 · ' + (sc || '학교 미지정'))}">` +
      hs.filter(h => String(h.year) === y && h.school === sc).map(h => `<option value="${h.id}" ${h.id === sel ? 'selected' : ''}>${h.grade}학년 ${esc(h.className)} (${h.count}명)${h.expired ? ' · 지난 학년도' : ''}</option>`).join('') + '</optgroup>';
  }).join('');
}
async function renderRoster(){
  const main = $('#main');
  if (!RS) RS = {hid:'', students:[], sel:new Set(), old:false};
  const vis = rosterVisible();
  if (RS.hid && !vis.some(h => h.id === RS.hid)) RS.hid = '';
  if (!RS.hid && vis.length) RS.hid = (S.params.hid && vis.some(h => h.id === S.params.hid)) ? S.params.hid : vis[0].id;
  main.innerHTML = `<div class="page-title"><button class="btn" id="back">‹ 수업하기</button><h1>학생 목록 관리</h1><span class="grow"></span>
      <button class="btn primary" id="addHr">+ 학년도 · 학교 · 학년 · 반 추가</button></div>
    <p style="color:var(--sub);margin:-6px 0 14px">여기 등록한 학생만 학생 화면(/student)에 <b>학습코드</b>(반마다 4자리) · <b>학번</b> + 비밀번호로 들어올 수 있어요.
      반 이름은 고교학점제 수업반처럼 A반 · B반으로 직접 정할 수 있어요.
      반은 <b>학년도</b>(3월 ~ 다음 해 2월)마다 따로 만들고, 학년도가 끝나면 목록에서 사라지고 그 반 학생은 로그인할 수 없어요 (지난 수업 기록 · 분석은 그대로).
      학생마다 다른 6자리 <b>처음 비밀번호</b>가 만들어져요. [안내문 인쇄]로 나눠 주면, 학생은 처음 로그인할 때 자기 비밀번호를 정해야 들어가요.
      [수업 추가하기]에서 반을 고르면 그 클래스 수업에 이 학생들이 연결되고, 형성평가 분석의 학생 통계도 이 명단으로 정리돼요.</p>
    <div class="rs-wrap"><div class="rs-tree" id="rsTree"></div><div class="rs-body" id="rsBody"></div></div>`;
  $('#back').onclick = () => go('classes');
  $('#addHr').onclick = () => homeroomModal();
  drawRosterTree();
  await loadRoster();
}
/** 목록에 보이는 반: 이번 학년도 이후 반 (+ '지난 학년도 보기'를 켜면 지난 반도) */
function rosterVisible(){ return (S.homerooms || []).filter(h => !h.expired || (RS && RS.old)); }
function drawRosterTree(){
  const box = $('#rsTree');
  if (!box) return;
  const hs = rosterVisible(), nOld = (S.homerooms || []).filter(h => h.expired).length;
  const oldBtn = nOld ? `<button class="rs-old ${RS.old ? 'on' : ''}" id="rsOld">${RS.old ? '지난 학년도 숨기기' : `지난 학년도 보기 (${nOld})`}</button>` : '';
  if (!hs.length) { box.innerHTML = `<div class="mt-empty" style="padding:14px">${nOld ? '이번 학년도 반이 없어요.' : '아직 반이 없어요.'}<br>[+ 학교 · 학년 · 반 추가]를 눌러 주세요.</div>` + oldBtn; bindOld(box); return; }
  const years = [...new Set(hs.map(h => h.year))].sort((a, b) => b - a);
  box.innerHTML = years.map(y => {
    const hy = hs.filter(h => h.year === y), exp = hy[0].expired;
    const schools = [...new Set(hy.map(h => h.school))].sort((a, b) => a.localeCompare(b, 'ko'));
    return `<div class="rs-year ${exp ? 'old' : ''}">${y}학년도${exp ? ' <small>끝남</small>' : ''}</div>` + schools.map(sc => {
      const grades = [...new Set(hy.filter(h => h.school === sc).map(h => h.grade))].sort((a, b) => a - b);
      return `<div class="rs-school">${esc(sc || '학교 미지정')}</div>` + grades.map(g => `<div class="rs-grade">${g}학년</div>` +
        hy.filter(h => h.school === sc && h.grade === g).sort((a, b) => a.className.localeCompare(b.className, 'ko', {numeric:true})).map(h =>
          `<div class="rs-hr ${h.id === RS.hid ? 'on' : ''} ${h.expired ? 'old' : ''}" data-hid="${h.id}"><span>${esc(h.className)}</span><small>${h.count}명</small></div>`).join('')).join('');
    }).join('');
  }).join('') + oldBtn;
  $$('[data-hid]', box).forEach(x => x.onclick = () => { RS.hid = x.dataset.hid; RS.sel.clear(); drawRosterTree(); loadRoster(); });
  bindOld(box);
}
function bindOld(box){
  const b = $('#rsOld', box);
  if (b) b.onclick = () => { RS.old = !RS.old; if (!RS.old && (S.homerooms.find(h => h.id === RS.hid) || {}).expired) RS.hid = ''; renderRoster(); };
}
async function loadRoster(){
  const body = $('#rsBody');
  if (!body) return;
  if (!RS.hid) { body.innerHTML = '<div class="empty">왼쪽에서 반을 고르거나 새로 추가해 주세요.</div>'; return; }
  body.innerHTML = '<div class="empty">불러오는 중…</div>';
  const r = await call('getRoster', RS.hid);
  if (S.view !== 'roster') return;
  S.homerooms = r.homerooms; RS.students = r.students;
  drawRosterTree(); drawRosterBody();
}
function drawRosterBody(){
  const body = $('#rsBody');
  const h = S.homerooms.find(x => x.id === RS.hid);
  if (!body || !h) return;
  const cls = S.classes.filter(c => h.classIds.includes(c.id));
  const nSel = RS.sel.size;
  body.innerHTML = `<div class="rs-head"><h2><small class="rs-y">${h.year}학년도</small> ${esc(h.label)}</h2><span class="pill gray">${RS.students.length}명</span>
      <span class="rs-code" title="학생이 로그인할 때 넣는 이 반의 코드">학습코드 <b>${esc(h.code || '-')}</b></span>
      <span class="grow"></span><button class="btn" id="hrEdit">반 정보 수정</button><button class="btn danger" id="hrDel">반 삭제</button></div>
    ${h.expired ? '<div class="rs-expired">학년도가 끝난 반이에요. 학생 화면에서 로그인할 수 없고, 목록에서는 숨겨져요 (기록은 그대로).</div>' : ''}
    <div class="an-sub" style="margin:-4px 0 12px">연결된 클래스: ${cls.length ? cls.map(c => `<b>${esc(c.name)}</b> (${esc(c.subject)} · ${esc(c.semesterName)})`).join(', ') : '없음 — [수업 추가하기] 또는 클래스 수정에서 이 반을 고르세요'}</div>
    <div class="rs-add">
      <input class="inp" id="rsNo" inputmode="numeric" placeholder="번호(선택)" style="width:96px">
      <input class="inp" id="rsSno" inputmode="numeric" placeholder="학번 (예: 30301)" style="width:140px">
      <input class="inp" id="rsName" placeholder="이름" style="width:140px">
      <button class="btn primary" id="rsAdd">추가</button>
      <span class="div"></span>
      <button class="btn" id="rsPaste">여러 명 붙여넣기</button>
      <span class="rs-test"><small>테스트용</small><button class="btn" id="rsRandom" title="시연 · 연습용: 임의 이름의 학생으로 명단을 채워요">학생 랜덤 채우기</button></span>
      <span class="grow"></span>
      <button class="btn" id="rsPrint" title="학생별 처음 비밀번호를 잘라서 나눠 줄 수 있게 인쇄">안내문 인쇄</button>
      <button class="btn" id="rsReset" ${nSel ? '' : 'disabled'} title="비밀번호를 잊은 학생: 새 6자리를 만들고, 로그인해 있던 기기는 로그아웃">처음 비밀번호 새로 만들기</button>
      <button class="btn danger" id="rsDelSel" ${nSel ? '' : 'disabled'}>선택 삭제</button>
    </div>
    ${RS.students.length ? `<table class="ltable rs-table"><thead><tr><th style="width:36px"><input type="checkbox" id="rsAll" ${nSel && nSel === RS.students.length ? 'checked' : ''}></th>
      <th style="width:80px">번호</th><th style="width:120px">학번</th><th>이름</th><th style="width:210px">비밀번호</th></tr></thead><tbody>
      ${RS.students.map(st => `<tr data-sid="${st.id}"><td><input type="checkbox" data-ck="${st.id}" ${RS.sel.has(st.id) ? 'checked' : ''}></td>
        <td><input class="inp rs-in" data-f="number" value="${st.number}" inputmode="numeric"></td>
        <td><input class="inp rs-in" data-f="studentNo" value="${esc(st.studentNo)}" inputmode="numeric" placeholder="학번 없음"></td>
        <td><input class="inp rs-in" data-f="name" value="${esc(st.name)}"></td>
        <td>${st.pwSet ? '<span class="pill ok">학생이 정함</span>' : st.initialPw ? `<span class="pill gray">처음 비밀번호</span> <code class="rs-pw" data-pw="${esc(st.initialPw)}" title="눌러서 보기 (수업 화면에 띄울 때 학생에게 보이지 않게 가려 둠)">••••••</code>` : '<span class="pill gray">없음 · 새로 만들어 주세요</span>'}</td></tr>`).join('')}
      </tbody></table><div class="an-sub" style="margin-top:6px">번호 · 학번 · 이름 칸을 고치고 Enter(또는 바깥 클릭)하면 저장돼요. 처음 비밀번호는 가려져 있어요 — 눌러서 보거나 [안내문 인쇄]로 나눠 주세요.</div>`
      : '<div class="empty">아직 학생이 없어요. 위에서 학번과 이름을 넣거나, 엑셀에서 "학번 · 이름" 두 열을 복사해 [여러 명 붙여넣기]를 눌러 주세요.</div>'}`;
  $('#hrEdit').onclick = () => homeroomModal(h);
  $('#hrDel').onclick = async () => {
    if (!await confirmBox(`'${h.label}' 반과 학생 ${RS.students.length}명을 삭제할까요?\n이 반을 쓰던 클래스는 명단 연결만 풀려요. (학생 응답 기록은 남아요)`, '삭제', true)) return;
    const r = await call('deleteHomeroom', h.id); S.homerooms = r.homerooms; RS.hid = ''; RS.sel.clear(); S.classes = await call('listClasses'); renderRoster(); toast('삭제했어요');
  };
  const add = async () => {
    const no = $('#rsNo').value.trim(), sno = $('#rsSno').value.trim(), name = $('#rsName').value.trim();
    if (!sno || !name) return toast('학번과 이름을 입력해 주세요', true);
    const r = await call('addStudents', h.id, [{number:no, studentNo:sno, name}]);
    S.homerooms = r.homerooms; RS.students = r.students; drawRosterTree(); drawRosterBody();
    if (r.skipped.length) return toast(r.skipped[0], true);
    toast(r.updated ? '같은 학번이 있어 이름을 바꿨어요' : '추가했어요');
    if (no) $('#rsNo').value = String(Number(no) + 1);
    if (/^\d+$/.test(sno)) $('#rsSno').value = String(Number(sno) + 1).padStart(sno.length, '0');
    $('#rsName').focus();
  };
  $('#rsAdd').onclick = add;
  $('#rsName').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) add(); };
  $('#rsNo').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('#rsSno').focus(); };
  $('#rsSno').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('#rsName').focus(); };
  // 시연 · 연습용 임의 학생: 지금 있는 마지막 번호 다음부터, 겹치지 않는 임의 이름으로
  $('#rsRandom').onclick = () => modal({title:'학생 랜덤 채우기 (테스트용) · ' + h.label, body:`
      <p class="an-sub" style="margin-top:0">시연이나 연습용으로 임의 이름 · 학번의 학생을 만들어요. 지금 있는 마지막 번호 다음부터 번호를 붙여요. (최대 99번)</p>
      <label class="f">몇 명</label><input class="inp" id="rsRandN" type="number" min="1" max="99" value="${Math.max(1, Math.min(25, 99 - RS.students.reduce((m, s) => Math.max(m, s.number), 0)))}">`,
    buttons:[{label:'취소'}, {label:'만들기', primary:true, onClick:async bg => {
      const last = RS.students.reduce((m, s) => Math.max(m, s.number), 0);
      const n = Math.min(Math.max(1, parseInt($('#rsRandN', bg).value, 10) || 0), 99 - last);
      if (n < 1) { toast('번호가 99번까지 다 찼어요', true); return false; }
      const FAM = '김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모'.split('');
      const GIV = '민서준하윤우지예도현수아은연재시유주원채건다율이소하진태성나린혜승영가온한별'.split('');
      const used = new Set(RS.students.map(s => s.name)), usedNo = new Set(RS.students.map(s => s.studentNo)), list = [];
      const pick = a => a[Math.floor(Math.random() * a.length)];
      for (let i = 1; i <= n; i++) {
        let name = '', sno = '';
        for (let t = 0; t < 50 && (!name || used.has(name)); t++) name = pick(FAM) + pick(GIV) + pick(GIV);
        // 학번 = 학년 + 학급(01~10) + 번호(01~30): 고교학점제 수업반은 여러 학급 학생이 섞여 있어요
        for (let t = 0; t < 200 && (!sno || usedNo.has(sno)); t++) sno = String(h.grade * 10000 + (1 + Math.floor(Math.random() * 10)) * 100 + 1 + Math.floor(Math.random() * 30));
        used.add(name); usedNo.add(sno); list.push({number:last + i, studentNo:sno, name});
      }
      const r = await call('addStudents', h.id, list);
      S.homerooms = r.homerooms; RS.students = r.students; drawRosterTree(); drawRosterBody();
      toast(`학생 ${r.added}명을 임의로 만들었어요`);
    }}]});
  $('#rsPaste').onclick = () => modal({title:'여러 명 붙여넣기 · ' + h.label, wide:true, body:`
      <p class="an-sub" style="margin-top:0">한 줄에 한 명씩 "학번 이름"(또는 "번호 학번 이름")으로 적거나, 엑셀에서 학번 · 이름 열을 복사해 붙여넣으세요.
        번호를 안 적으면 마지막 번호 다음부터 붙여요. 같은 학번이 있으면 이름을 바꿔요.</p>
      <textarea class="inp" id="rsBulk" rows="12" placeholder="30301 김가람\n30415 이나래\n30502 박다솜"></textarea>`,
    buttons:[{label:'취소'}, {label:'추가', primary:true, onClick:async bg => {
      const r = await call('addStudents', h.id, $('#rsBulk', bg).value);
      S.homerooms = r.homerooms; RS.students = r.students; drawRosterTree(); drawRosterBody();
      toast(`추가 ${r.added}명 · 이름 변경 ${r.updated}명` + (r.skipped.length ? ` · 읽지 못한 줄 ${r.skipped.length}개` : ''), r.skipped.length > 0);
    }}]});
  const selIds = () => [...RS.sel];
  $$('.rs-pw', body).forEach(c => c.onclick = () => { c.textContent = c.textContent === c.dataset.pw ? '••••••' : c.dataset.pw; });
  $('#rsPrint').onclick = () => printSlips(h, RS.students.filter(st => !st.pwSet && st.initialPw).filter(st => !nSel || RS.sel.has(st.id)));
  $('#rsReset').onclick = async () => {
    if (!await confirmBox(`선택한 학생 ${nSel}명에게 새 6자리 처음 비밀번호를 만들까요?\n학생이 정한 비밀번호는 지워지고, 로그인해 있던 기기도 로그아웃돼요.`, '새로 만들기')) return;
    const r = await call('resetStudentPassword', h.id, selIds()); RS.students = r.students; RS.sel.clear(); drawRosterBody(); toast('새 처음 비밀번호를 만들었어요. 학생에게 알려 주세요');
  };
  $('#rsDelSel').onclick = async () => {
    if (!await confirmBox(`선택한 학생 ${nSel}명을 명단에서 삭제할까요? (응답 기록은 남아요)`, '삭제', true)) return;
    const r = await call('deleteStudents', h.id, selIds()); S.homerooms = r.homerooms; RS.students = r.students; RS.sel.clear(); drawRosterTree(); drawRosterBody(); toast('삭제했어요');
  };
  const all = $('#rsAll');
  if (all) all.onchange = () => { RS.sel = new Set(all.checked ? RS.students.map(x => x.id) : []); drawRosterBody(); };
  $$('[data-ck]', body).forEach(x => x.onchange = () => { x.checked ? RS.sel.add(x.dataset.ck) : RS.sel.delete(x.dataset.ck); drawRosterBody(); });
  $$('.rs-in', body).forEach(inp => {
    const save = async () => {
      const tr = inp.closest('tr'), st = RS.students.find(x => x.id === tr.dataset.sid), f = inp.dataset.f;
      if (!st || String(st[f]) === inp.value.trim()) return;
      try { const r = await call('updateStudent', st.id, {[f]:inp.value}); RS.students = r.students; drawRosterBody(); toast('저장했어요'); }
      catch(e){ inp.value = st[f]; }
    };
    inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) inp.blur(); if (e.key === 'Escape') { const st = RS.students.find(x => x.id === inp.closest('tr').dataset.sid); inp.value = st[inp.dataset.f]; inp.blur(); } };
    inp.onblur = save;
  });
}
/** 처음 비밀번호 안내문 (학생마다 한 장씩 잘라서 나눠 주기) */
function printSlips(h, list){
  if (!list.length) return toast('나눠 줄 처음 비밀번호가 없어요 (모두 자기 비밀번호를 정했어요)', true);
  const url = studentUrl();
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 막혔어요. 팝업을 허용해 주세요', true);
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(h.label)} 처음 비밀번호</title><style>
    body{font-family:'Noto Sans KR',system-ui,sans-serif;margin:16px;color:#111}
    h1{font-size:16px;margin:0 0 4px} p{font-size:12px;color:#555;margin:0 0 12px}
    .g{display:grid;grid-template-columns:repeat(2,1fr);gap:0}
    .s{border:1px dashed #999;padding:12px 14px;break-inside:avoid;font-size:13px;line-height:1.6}
    .s b{font-size:15px} .pw{font-size:24px;font-weight:900;letter-spacing:4px;font-family:ui-monospace,monospace}
    @media print{p.np{display:none}}
  </style></head><body><h1>${h.year}학년도 ${esc(h.label)} · 수업 참여 안내</h1><p class="np">점선을 따라 잘라 학생에게 한 장씩 나눠 주세요. (이 창에서 Ctrl+P로 인쇄)</p>
  <div class="g">${list.map(st => `<div class="s"><b>${esc(h.className)} ${st.number}번 · 학번 ${esc(st.studentNo || '-')} ${esc(st.name)}</b><br>
    접속 주소: ${esc(url)}<br>학습코드: <b>${esc(h.code)}</b> · 처음 비밀번호: <span class="pw">${esc(st.initialPw)}</span><br>
    처음 로그인하면 <b>자기 비밀번호</b>를 정해야 해요. 이 종이는 다른 친구에게 보여 주지 마세요.</div>`).join('')}</div></body></html>`);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch(e){} }, 300);
}
function homeroomModal(h){
  const schools = [...new Set((S.homerooms || []).map(x => x.school).filter(Boolean))];
  const cy = curSchoolYear();
  modal({title:h ? '반 정보 수정' : '학년도 · 학교 · 학년 · 반 추가', body:`
    <label class="f">학년도</label><select class="inp" id="hmYear">${[cy + 1, cy, cy - 1].concat(h && [cy + 1, cy, cy - 1].indexOf(h.year) < 0 ? [h.year] : [])
      .map(y => `<option value="${y}" ${(h ? h.year : cy) === y ? 'selected' : ''}>${y}학년도 (${y}.3 ~ ${y + 1}.2)${y === cy ? ' · 이번 학년도' : ''}</option>`).join('')}</select>
    <label class="f">학교</label><input class="inp" id="hmSchool" list="hmSchools" value="${esc(h ? h.school : (schools[0] || ''))}" placeholder="예) 물개고등학교">
    <datalist id="hmSchools">${schools.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="row" style="gap:8px"><div style="flex:1"><label class="f">학년</label><input class="inp" id="hmGrade" inputmode="numeric" value="${h ? h.grade : ''}" placeholder="예) 1"></div>
      <div style="flex:1"><label class="f">반 이름</label><input class="inp" id="hmClass" value="${h ? esc(h.className) : ''}" maxlength="20" placeholder="예) A반, 3반"></div></div>
    <div class="an-sub" style="margin-top:8px">반 이름은 직접 정해요 (고교학점제 수업반이면 A반 · B반처럼). 반을 만들면 학생이 로그인할 때 넣는 <b>학습코드</b> 4자리가 생겨요.</div>`,
    buttons:[{label:'취소'}, {label:h ? '저장' : '추가', primary:true, onClick:async bg => {
      const r = await call('saveHomeroom', {id:h ? h.id : '', year:$('#hmYear', bg).value, school:$('#hmSchool', bg).value, grade:$('#hmGrade', bg).value, className:$('#hmClass', bg).value});
      S.homerooms = r.homerooms;
      if (!RS) RS = {hid:'', students:[], sel:new Set()};
      RS.hid = r.id; RS.students = r.students; RS.sel.clear();
      if ((r.homerooms.find(x => x.id === r.id) || {}).expired) RS.old = true;
      S.classes = await call('listClasses'); renderNav();
      if (S.view === 'roster') { drawRosterTree(); drawRosterBody(); } else go('roster', {hid:r.id});
      toast(h ? '저장했어요' : '반을 추가했어요. 이제 학생을 넣어 주세요');
    }}]});
}

/* =====================================================================
 *  3. 통계 · 개념지도
 * ===================================================================== */
let CM = null; // 현재 개념지도 상태
function stopStats(){ CM = null; }
function lvClass(rate, n){ if (!n) return 'lv-none'; if (rate < .4) return 'lv-1'; if (rate < .6) return 'lv-2'; if (rate < .75) return 'lv-3'; if (rate < .9) return 'lv-4'; return 'lv-5'; }
function lvColor(rate, n){ return {'lv-none':'#9aa0ac', 'lv-1':'#c0392b', 'lv-2':'#d9622b', 'lv-3':'#c79a1e', 'lv-4':'#1f8fc4', 'lv-5':'#1aa37a'}[lvClass(rate, n)]; }
/** 개념 지도 화면: 지도와 오른쪽 정보 칸이 창 아래 끝까지만 (페이지를 아래로 내리지 않아도 되게) */
function fitStatWrap(){
  const w = $('.stat-wrap');
  if (!w || window.innerWidth <= 900) { if (w) w.style.height = ''; return; }
  const padB = parseFloat(getComputedStyle($('#main')).paddingBottom) || 0;
  w.style.height = Math.max(420, window.innerHeight - (w.getBoundingClientRect().top + window.scrollY) - padB - 2) + 'px';
}
window.addEventListener('resize', () => { if (S.view === 'stats') fitStatWrap(); });

/* ---------- 문제 미리보기: data-hq="문제 id" 에 마우스를 올리면 문제 내용을 띄움 ----------
 * 누르면 그 자리에 고정 ([크게 보기] · ×). 같은 문제를 다시 누르거나, 바깥을 누르거나, Esc 면 닫힘 */
(function bindPeek(){
  let tip = null, cur = null, pinned = false;
  const hide = () => { if (tip) tip.remove(); tip = null; cur = null; pinned = false; };
  const show = el => {
    hide();
    const q = S.questions.find(x => x.id === el.dataset.hq);
    if (!q) return;
    cur = el;
    tip = document.createElement('div');
    tip.className = 'q-peek';
    tip.innerHTML = renderQ(q, {answer:true});
    document.body.appendChild(tip);
    const place = () => {
      if (!tip || cur !== el) return;
      const r = el.getBoundingClientRect(), w = Math.min(460, window.innerWidth - 24), room = window.innerHeight - 16;
      tip.style.width = w + 'px'; tip.style.transform = '';
      // 화면보다 길면 잘리지 않게 통째로 줄여서 보여 줌
      const h = tip.offsetHeight, k = h > room ? room / h : 1;
      if (k < 1) { tip.style.transform = `scale(${k})`; tip.style.animation = 'none'; }   // 열리는 효과(transform)가 줄이기를 덮지 않게
      const W = w * k, Hk = h * k;
      const left = r.left - W - 12 >= 8 ? r.left - W - 12 : Math.min(window.innerWidth - W - 8, r.right + 12);
      tip.style.left = Math.max(8, left) + 'px';
      tip.style.top = Math.max(8, Math.min(window.innerHeight - Hk - 8, r.top - 20)) + 'px';
    };
    place();
    // 그림이 늦게 불러와져 크기가 바뀌면 다시 맞춤 (transform 은 크기 변화로 치지 않아 되풀이되지 않음)
    if (window.ResizeObserver) new ResizeObserver(place).observe(tip);
    $$('img', tip).forEach(im => { if (!im.complete) im.addEventListener('load', place); });
  };
  const pin = () => {
    if (!tip) return;
    pinned = true;
    tip.classList.add('pinned');
    const bar = document.createElement('div');
    bar.className = 'q-peek-bar';
    bar.innerHTML = '<span>📌 고정됨</span><span class="grow"></span><button class="btn" data-peek="big">크게 보기</button><button class="btn ghost" data-peek="close" title="닫기 (Esc)">×</button>';
    tip.prepend(bar);
  };
  document.addEventListener('mouseover', e => {
    if (pinned) return;
    const el = e.target.closest && e.target.closest('[data-hq]');
    if (el && el !== cur) show(el);
  });
  document.addEventListener('click', e => {
    const t = e.target;
    if (tip && tip.contains(t)) {
      const b = t.closest('[data-peek]');
      if (b && b.dataset.peek === 'close') hide();
      else if (b && b.dataset.peek === 'big') { const id = cur && cur.dataset.hq; hide(); if (id) qPopup(id); }
      return;
    }
    const el = t.closest && t.closest('[data-hq]');
    if (el) {
      if (pinned && cur === el) return hide();
      if (cur !== el || !tip) show(el);
      pin();
      return;
    }
    if (pinned) hide();
  });
  document.addEventListener('keydown', e => { if (pinned && e.key === 'Escape') hide(); });
  document.addEventListener('mouseout', e => {
    if (!cur || pinned) return;
    const to = e.relatedTarget;
    if (!to || !cur.contains(to)) hide();
  });
  document.addEventListener('scroll', e => { if (!pinned || !tip || !tip.contains(e.target)) hide(); }, true);
})();
/** 문제 크게 보기 (개념 지도에서는 이 개념의 응답 · 정답률도 함께) */
function qPopup(qid){
  const q = S.questions.find(y => y.id === qid);
  if (!q) return toast('문제를 찾을 수 없어요', true);
  const n = CM && CM.data && CM.data.nodes.find(x => x.id === CM.sel);
  const st = n && n.stat && n.stat.qs.find(y => y.id === qid);
  modal({title:q.title || '문제', wide:true, body:(st ? `<div class="an-sub" style="margin:-4px 0 10px">이 개념 응답 ${st.n}건 · 정답률 <b style="color:${lvColor(st.rate, st.n)}">${st.n ? pctStr(st.rate) : '-'}</b></div>` : '') +
    `<div class="q-pop">${renderQ(q, {answer:true, mis:true, concepts:true, noTitle:true})}</div>`});
}

async function renderStats(){
  const subject = S.params.subject;
  const main = $('#main');
  if (!subject) {
    const subs = mapSubjects();
    main.innerHTML = `<div class="page-title"><h1>개념 지도</h1></div>
      ${subs.length ? `<div class="cgrid">${subs.map(s => `<div class="ccard" style="cursor:pointer" data-s="${esc(s)}"><div class="cc-head" style="background:${subjStyle(s).color};height:110px">${subjStyle(s).icon}${subjTitle(s, 28)}</div></div>`).join('')}</div>`
        : '<div class="empty">아직 과목이 없어요. [수업하기]에서 클래스를 먼저 만들어 주세요.</div>'}`;
    $$('[data-s]').forEach(c => c.onclick = () => go('stats', {subject:c.dataset.s}));
    return;
  }
  main.innerHTML = `<div class="page-title"><h1>${esc(subject)} · 개념 지도</h1>
      <select class="inp" id="cmClass" style="width:200px"><option value="">전체 반</option></select>
      <span class="grow"></span>
      <div class="legend"><span><i style="background:#c0392b"></i>40% 미만</span><span><i style="background:#d9622b"></i>40~60%</span><span><i style="background:#c79a1e"></i>60~75%</span><span><i style="background:#1f8fc4"></i>75~90%</span><span><i style="background:#1aa37a"></i>90% 이상</span><span><i style="background:#4a5163"></i>데이터 없음</span></div></div>
    <div class="row" style="margin:-4px 0 12px;flex-wrap:wrap;gap:8px">
      <button class="btn" id="cmAdd" style="flex:none">+ 노드 추가</button>
      <button class="btn" id="cmLinkMode" style="flex:none">연결 모드</button>
      <button class="btn ai" id="cmAiLink" style="flex:none" title="AI가 개념끼리 관련된 정도를 판단해 이어요 (굵을수록 관련이 깊어요)">AI로 개념 잇기</button>
      <button class="btn" id="cmLayout" style="flex:none">자동 배치</button>
      <button class="btn" id="cmUndo" style="flex:none;display:none">배치 되돌리기</button>
      <button class="btn" id="cmReload" style="flex:none">새로고침</button>
      <span style="color:var(--sub);font-size:12px;flex:1">노드를 끌어 옮기고, 노드 위의 <b>+</b>를 다른 노드로 끌면 연결돼요. 연결선을 누르면 삭제 ·
        <b>빈 곳 끌기</b> = 화면 이동 · <b>마우스 휠 / 터치패드 오므리기</b> = 확대 · 축소</span>
    </div>
    <div class="stat-wrap"><div class="cmap-box"><div class="cmap" id="cmap"><div class="csizer" id="csizer"><div class="cstage" id="cstage"><svg class="links" id="clinks"></svg></div></div></div>
        <div class="cm-zoom"><button id="cmZoomOut" title="축소">−</button><button id="cmZoomPct" title="100%로">100%</button><button id="cmZoomIn" title="확대">+</button><button id="cmZoomFit" title="전체 보기">맞춤</button></div></div>
      <div class="side" id="cside"></div></div>`;
  CM = {subject, classId:'', data:null, sel:null, linkMode:false, zoom:1, W:1500, H:900};
  CM.zoom = Math.max(ZMIN, Math.min(ZMAX, Number(store.get(cmZoomKey())) || 1));
  bindMapView();
  fitStatWrap();
  $('#cmLayout').onclick = autoLayoutModal;
  $('#cmAiLink').onclick = async () => {
    const n = CM.data.nodes.filter(x => x.kind !== 'unit').length;
    if (!await confirmBox(`AI가 개념 ${n}개를 보고 서로 관련 있는 개념끼리 이어요.\n예전에 AI가 이은 선은 새로 바뀌고, 직접 이은 선은 그대로 남아요.`, '잇기')) return;
    toast('AI가 개념 관계를 살펴보는 중… (30초~1분)');
    const r = await call('aiLinkConcepts', CM.subject);
    CM.data.links = r.links; drawLinks();
    toast(`개념 연결 ${r.added}개를 이었어요` + (r.removed ? ` (예전 AI 연결 ${r.removed}개는 바꿈)` : ''));
  };
  $('#cmUndo').onclick = () => {
    if (!CM.prevPos) return;
    CM.prevPos.forEach(p => { const n = CM.data.nodes.find(x => x.id === p.id); if (n) { n.x = p.x; n.y = p.y; } });
    CM.prevPos = null; $('#cmUndo').style.display = 'none'; drawMap(); saveNodePositions(); toast('배치를 되돌렸어요');
  };
  $('#cmClass').onchange = e => { CM.classId = e.target.value; loadMap(); };
  $('#cmAdd').onclick = addNodeModal;
  $('#cmReload').onclick = loadMap;
  $('#cmLinkMode').onclick = () => { CM.linkMode = !CM.linkMode; $('#cmLinkMode').classList.toggle('mode-on', CM.linkMode); toast(CM.linkMode ? '연결 모드: 노드에서 노드로 끌면 연결돼요' : '이동 모드'); };
  await loadMap(true);
}
async function loadMap(first){
  if (!CM) return;
  const d = await call('getConceptMap', CM.subject, CM.classId);
  if (!CM) return;
  CM.data = d;
  S.concepts = S.concepts.filter(c => c.subject !== CM.subject).concat(d.nodes.map(n => ({id:n.id, subject:n.subject, kind:n.kind, unit:n.unit, name:n.name})));
  if (first) $('#cmClass').innerHTML = '<option value="">전체 반</option>' + d.classes.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.semesterName)})</option>`).join('');
  drawMap();
  if (first) { if (store.get(cmZoomKey())) applyZoom(CM.zoom); else zoomFit(); }
}
function applyMap(d){ CM.data = d; S.concepts = S.concepts.filter(c => c.subject !== CM.subject).concat(d.nodes.map(n => ({id:n.id, subject:n.subject, kind:n.kind, unit:n.unit, name:n.name}))); drawMap(); }
function drawMap(){
  const stage = $('#cstage');
  if (!stage) return;
  const d = CM.data;
  $$('.cnode', stage).forEach(n => n.remove());
  const maxX = Math.max(1500, ...d.nodes.map(n => n.x + 260)), maxY = Math.max(900, ...d.nodes.map(n => n.y + 200));
  CM.W = maxX; CM.H = maxY;
  stage.style.width = maxX + 'px'; stage.style.height = maxY + 'px';
  stage.style.transform = `scale(${CM.zoom})`;
  $('#csizer').style.width = Math.ceil(maxX * CM.zoom) + 'px'; $('#csizer').style.height = Math.ceil(maxY * CM.zoom) + 'px';
  d.nodes.forEach((n, i) => {
    const el = document.createElement('div');
    el.className = 'cnode' + (n.kind === 'unit' ? ' unit' : '') + (CM.sel === n.id ? ' sel' : '');
    el.dataset.id = n.id;
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    el.innerHTML = n.kind === 'unit' ? `<div class="cn-unit">${esc(n.name)}</div><div class="cn-handle" title="끌어서 다른 노드와 연결">+</div>` :
      `<div class="cn-float" style="animation-delay:${-(i * 0.73) % 5}s"><div class="cn-tile ${lvClass(n.stat.rate, n.stat.n)}"><span>${n.stat.n ? pctStr(n.stat.rate) : '–'}</span></div>
      <div class="cn-label">${esc(n.name)}</div></div><div class="cn-handle" title="끌어서 다른 노드와 연결">+</div>`;
    stage.appendChild(el);
    bindNode(el, n);
  });
  drawLinks();
  drawSide();
  if (!d.nodes.length) {
    const tip = document.createElement('div');
    tip.className = 'cnode'; tip.style.left = '50%'; tip.style.top = '45%';
    tip.innerHTML = `<div style="position:absolute;transform:translate(-50%,-50%);color:#cfd6ea;text-align:center;width:420px;line-height:1.7">아직 개념 노드가 없어요.<br>[+ 노드 추가]를 눌러 개념을 만들어 보세요.</div>`;
    stage.appendChild(tip);
  }
}
function drawLinks(temp){
  const svg = $('#clinks');
  if (!svg) return;
  const pos = {};
  CM.data.nodes.forEach(n => pos[n.id] = n);
  // 단원 소속 표시 (단원 노드 → 그 단원의 개념, 연결선이 따로 없을 때만 옅은 점선)
  const has = (a, b) => CM.data.links.some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
  const unitOf = {};
  CM.data.nodes.forEach(n => { if (n.kind === 'unit') unitOf[n.name] = n; });
  const member = CM.data.nodes.filter(n => n.kind !== 'unit' && n.unit && unitOf[n.unit] && !has(n.id, unitOf[n.unit].id))
    .map(n => { const u = unitOf[n.unit]; return `<line class="member" data-a="${u.id}" data-b="${n.id}" x1="${u.x}" y1="${u.y - 4}" x2="${n.x}" y2="${n.y - 4}"/>`; }).join('');
  svg.innerHTML = member + CM.data.links.map(l => {
    const a = pos[l.from], b = pos[l.to];
    if (!a || !b) return '';
    // AI가 이은 선: 관련 정도(weight)만큼 굵고 진하게 · 직접 이은 선: 기본 굵기
    const w = l.weight == null ? '' : ` style="stroke-width:${(1 + l.weight * 5).toFixed(1)}px;opacity:${(0.35 + l.weight * 0.6).toFixed(2)}"`;
    return `<g data-lid="${l.id}" data-a="${l.from}" data-b="${l.to}"><title>${l.weight == null ? '직접 이은 연결' : 'AI 연결 · 관련 정도 ' + Math.round(l.weight * 100) + '%'}</title><line class="hit" x1="${a.x}" y1="${a.y - 4}" x2="${b.x}" y2="${b.y - 4}"/><line class="vis${l.weight == null ? '' : ' ai'}" x1="${a.x}" y1="${a.y - 4}" x2="${b.x}" y2="${b.y - 4}"${w}/></g>`;
  }).join('') + (temp ? `<line class="temp" x1="${temp.x1}" y1="${temp.y1}" x2="${temp.x2}" y2="${temp.y2}"/>` : '');
  applyHl();
  $$('g[data-lid]', svg).forEach(g => g.onclick = async () => {
    const l = CM.data.links.find(x => x.id === g.dataset.lid);
    const na = CM.data.nodes.find(n => n.id === l.from), nb = CM.data.nodes.find(n => n.id === l.to);
    if (!await confirmBox(`'${na.name}' — '${nb.name}' 연결을 삭제할까요?`, '삭제', true)) return;
    const r = await call('deleteLink', l.id, CM.subject); CM.data.links = r.links; drawLinks();
  });
}
/** 화면 좌표 → 지도 좌표 (확대 배율 반영) */
function stagePoint(e){ const r = $('#cstage').getBoundingClientRect(), z = (CM && CM.zoom) || 1; return {x:(e.clientX - r.left) / z, y:(e.clientY - r.top) / z}; }
function bindNode(el, n){
  const tile = $('.cn-tile, .cn-unit', el), handle = $('.cn-handle', el);
  const linkDrag = (e) => {
    e.stopPropagation(); e.preventDefault();
    el.classList.add('link-src');
    const mv = ev => { const p = stagePoint(ev); drawLinks({x1:n.x, y1:n.y - 4, x2:p.x, y2:p.y}); };
    const up = async ev => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      el.classList.remove('link-src');
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = t && t.closest('.cnode');
      drawLinks();
      if (target && target.dataset.id && target.dataset.id !== n.id) {
        const r = await call('addLink', CM.subject, n.id, target.dataset.id);
        CM.data.links = r.links; drawLinks(); toast('개념을 연결했어요');
      }
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  handle.onpointerdown = linkDrag;
  el.onpointerenter = () => { if (!CM.drag) { CM.hl = n.id; applyHl(); } };
  el.onpointerleave = () => { if (!CM.drag && CM.hl === n.id) { CM.hl = null; applyHl(); } };
  tile.onpointerdown = e => {
    if (CM.linkMode) return linkDrag(e);
    e.preventDefault();
    const s = stagePoint(e), ox = n.x, oy = n.y;
    let sim = null;
    const mv = ev => {
      const p = stagePoint(ev);
      if (!sim && Math.hypot(p.x - s.x, p.y - s.y) < 4) return;
      if (!sim) { sim = cmSim(n); CM.drag = n.id; CM.hl = n.id; applyHl(); $('#cmap').classList.add('dragging'); }
      sim.grab(Math.max(50, ox + p.x - s.x), Math.max(50, oy + p.y - s.y));
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (sim) { sim.release(); CM.drag = null; $('#cmap').classList.remove('dragging'); }
      else { CM.sel = CM.sel === n.id ? null : n.id; $$('.cnode').forEach(x => x.classList.toggle('sel', x.dataset.id === CM.sel)); drawSide(); }
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
}
/** 마우스를 올린(끄는) 노드와 바로 이어진 노드 · 선만 또렷하게, 나머지는 흐리게 */
function applyHl(){
  const map = $('#cmap');
  if (!map || !CM) return;
  const id = CM.hl, near = new Set(id ? [id] : []);
  if (id) $$('#clinks [data-a]').forEach(g => { if (g.dataset.a === id) near.add(g.dataset.b); if (g.dataset.b === id) near.add(g.dataset.a); });
  map.classList.toggle('focus', !!id);
  $$('.cnode', map).forEach(x => x.classList.toggle('hl', near.has(x.dataset.id)));
  $$('#clinks [data-a]').forEach(g => g.classList.toggle('hl', !!id && (g.dataset.a === id || g.dataset.b === id)));
}
/**
 * 끌기 물리 (옵시디언 그래프처럼): 끄는 노드는 마우스를 따라가고, 연결선(과 단원 소속)은 끌기 시작할 때 길이를 지키려는 스프링이라
 * 바로 이어진 노드는 많이, 멀리 이어진 노드는 조금 따라와요 (모든 노드는 원래 자리에 약하게 묶여 있어 지도 전체가 끌려가지 않음).
 * 노드끼리는 처음보다 더 가까워지면 밀어냄. 놓으면 움직임이 잦아들 때까지 이어서 움직이다 멈추고 위치를 저장해요.
 */
function cmSim(dragged){
  const nodes = CM.data.nodes, byId = new Map(nodes.map(x => [x.id, x]));
  const els = new Map($$('#cstage .cnode').map(e => [e.dataset.id, e]));
  const edges = [], seen = new Set();
  const addEdge = (a, b, k) => {
    const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
    if (seen.has(key)) return; seen.add(key);
    edges.push({a, b, k, len:Math.max(90, Math.hypot(a.x - b.x, a.y - b.y))});
  };
  CM.data.links.forEach(l => { const a = byId.get(l.from), b = byId.get(l.to); if (a && b) addEdge(a, b, 0.06); });
  const unitOf = {}; nodes.forEach(x => { if (x.kind === 'unit') unitOf[x.name] = x; });
  nodes.forEach(x => { const u = x.kind !== 'unit' && x.unit && unitOf[x.unit]; if (u) addEdge(u, x, 0.015); });
  const vel = new Map(nodes.map(x => [x.id, {x:0, y:0}]));
  const home = new Map(nodes.map(x => [x.id, {x:x.x, y:x.y}]));   // 원래 자리 (약한 스프링)
  const near = nodes.map((a, i) => nodes.map((b, j) => (j > i ? Math.min(120, Math.hypot(a.x - b.x, a.y - b.y)) : 0)));   // 밀어내기 시작 거리
  let target = {x:dragged.x, y:dragged.y}, held = true, raf = 0, calm = 0, after = 0;
  const step = () => {
    const f = new Map(nodes.map(x => [x.id, {x:0, y:0}]));
    edges.forEach(e => {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 0.01, s = (d - e.len) * e.k;
      const fx = dx / d * s, fy = dy / d * s;
      f.get(e.a.id).x += fx; f.get(e.a.id).y += fy; f.get(e.b.id).x -= fx; f.get(e.b.id).y -= fy;
    });
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, lim = near[i][j];
      if (d >= lim) continue;
      const s = (lim - d) * 0.05, fx = dx / d * s, fy = dy / d * s;
      f.get(a.id).x -= fx; f.get(a.id).y -= fy; f.get(b.id).x += fx; f.get(b.id).y += fy;
    }
    nodes.forEach(x => { const h = home.get(x.id), g = f.get(x.id); g.x += (h.x - x.x) * 0.02; g.y += (h.y - x.y) * 0.02; });
    let maxV = 0;
    nodes.forEach(x => {
      const v = vel.get(x.id);
      if (x === dragged) { x.x = target.x; x.y = target.y; v.x = v.y = 0; return; }   // 놓은 뒤에도 놓은 자리에 고정
      v.x = (v.x + f.get(x.id).x) * 0.72; v.y = (v.y + f.get(x.id).y) * 0.72;
      const sp = Math.hypot(v.x, v.y); if (sp > 30) { v.x *= 30 / sp; v.y *= 30 / sp; }
      x.x = Math.max(50, x.x + v.x); x.y = Math.max(50, x.y + v.y);
      maxV = Math.max(maxV, Math.abs(v.x) + Math.abs(v.y));
    });
    nodes.forEach(x => { const e = els.get(x.id); if (e) { e.style.left = x.x + 'px'; e.style.top = x.y + 'px'; } });
    drawLinks();
    if (!held) {
      after++;
      calm = maxV < 0.15 ? calm + 1 : 0;
      if (calm > 8 || after > 300) return finish();
    }
    raf = requestAnimationFrame(step);
  };
  const finish = () => {
    cancelAnimationFrame(raf);
    if (!CM) return;
    nodes.forEach(x => { x.x = Math.round(x.x); x.y = Math.round(x.y); });
    saveNodePositions();
    if (nodes.some(x => x.x + 260 > CM.W || x.y + 200 > CM.H)) drawMap(); else drawLinks();
  };
  raf = requestAnimationFrame(step);
  // 놓으면: 다른 노드들은 지금 자리를 새 '원래 자리'로 삼아 그 근처에서 자리 잡음 (처음 자리로 되돌아가지 않게)
  return {grab:(x, y) => { target = {x, y}; }, release:() => { held = false; nodes.forEach(x => home.set(x.id, {x:x.x, y:x.y})); }};
}
function drawSide(){
  const side = $('#cside');
  if (!side) return;
  const d = CM.data;
  const n = d.nodes.find(x => x.id === CM.sel);
  if (!n) {
    const withData = d.nodes.filter(x => x.stat.n && x.kind !== 'unit');
    const weak = withData.slice().sort((a, b) => a.stat.rate - b.stat.rate).slice(0, 5);
    const tot = withData.reduce((a, x) => a + x.stat.n, 0), cor = withData.reduce((a, x) => a + x.stat.c, 0);
    side.innerHTML = `<h3>${esc(d.subject)} 요약</h3>
      <div style="color:var(--sub);font-size:13px">노드 ${d.nodes.length}개 · 연결 ${d.links.length}개 · 응답 ${tot}건</div>
      <div class="side-sec"><h4>전체 이해도</h4><div class="big-pct" style="color:${lvColor(tot ? cor / tot : null, tot)}">${tot ? pctStr(cor / tot) : '-'}</div>
        <div class="gauge"><b style="width:${tot ? cor / tot * 100 : 0}%;background:${lvColor(tot ? cor / tot : null, tot)}"></b></div></div>
      <div class="side-sec"><h4>보충이 필요한 개념</h4>${weak.length ? weak.map(x => `<div class="mis-item" style="cursor:pointer" data-pick="${x.id}"><b>${esc(x.name)}</b> <span style="float:right;color:${lvColor(x.stat.rate, 1)}">${pctStr(x.stat.rate)}</span>
        <div class="gauge"><b style="width:${x.stat.rate * 100}%;background:${lvColor(x.stat.rate, 1)}"></b></div></div>`).join('') : '<div style="color:#9aa0ac;font-size:13px">아직 학생 응답이 없어요. 문제에 개념 노드를 연결하고 수업에서 사용하면 통계가 쌓여요.</div>'}</div>
      <div class="side-sec" style="color:var(--sub);font-size:12px;line-height:1.6">노드를 누르면 해당 개념의 단원 · 이해도 · 오개념 목록을 보고 고칠 수 있어요.</div>`;
    $$('[data-pick]', side).forEach(x => x.onclick = () => { CM.sel = x.dataset.pick; drawMap(); });
    return;
  }
  const s = n.stat, col = lvColor(s.rate, s.n);
  const maxMis = Math.max(1, ...s.mis.map(m => m.count));
  const units = [...new Set(d.nodes.filter(x => x.kind === 'unit').map(x => x.name).concat(d.nodes.map(x => x.unit)).filter(Boolean))].sort();
  if (n.kind === 'unit') {
    const kids = d.nodes.filter(x => x.kind !== 'unit' && x.unit === n.name);
    side.innerHTML = `<div style="font-size:12px;color:var(--sub)">큰 단원</div><input class="inp" id="nName" value="${esc(n.name)}" style="font-size:17px;font-weight:700">
      <div style="display:flex;gap:6px;margin-top:6px"><button class="btn primary" id="nSave">저장</button><button class="btn danger" id="nDel">단원 삭제</button></div>
      <div class="side-sec"><h4>하위 개념 (${kids.length})</h4>${kids.map(x => `<div class="mis-item" style="cursor:pointer" data-pick="${x.id}"><b>${esc(x.name)}</b></div>`).join('') ||
        '<div style="color:#9aa0ac;font-size:13px">아직 하위 개념이 없어요. [+ 노드 추가]에서 단원을 이 이름으로 적으면 이 아래에 들어가요.</div>'}</div>`;
    $$('[data-pick]', side).forEach(x => x.onclick = () => { CM.sel = x.dataset.pick; drawMap(); });
    $('#nSave').onclick = async () => {
      const name = $('#nName').value.trim();
      if (!name) return;
      // 단원 이름을 바꾸면 하위 개념의 단원 이름도 함께 바꿈
      for (const k of kids) await call('saveNode', {id:k.id, subject:CM.subject, kind:'concept', unit:name, name:k.name, desc:k.desc || '', x:k.x, y:k.y});
      applyMap(await call('saveNode', {id:n.id, subject:CM.subject, kind:'unit', unit:'', name, desc:'', x:n.x, y:n.y, classId:CM.classId})); toast('저장했어요');
    };
    $('#nDel').onclick = async () => {
      if (!await confirmBox(`'${n.name}' 단원 노드를 삭제할까요? (하위 개념은 남아요)`, '삭제', true)) return;
      CM.sel = null; await call('deleteNode', n.id, CM.subject); loadMap();
    };
    return;
  }
  const misList = S.miscons.filter(m => m.subject === CM.subject && (m.conceptIds || []).includes(n.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  side.innerHTML = `<input class="inp" id="nName" value="${esc(n.name)}" style="font-size:17px;font-weight:700">
    <div style="display:flex;gap:6px;align-items:center;margin-top:6px"><span style="font-size:12px;color:var(--sub);flex:none">단원</span>
      <input class="inp" id="nUnit" list="unitList" value="${esc(n.unit || '')}" placeholder="예) 일과 에너지"><datalist id="unitList">${units.map(u => `<option value="${esc(u)}">`).join('')}</datalist></div>
    <textarea class="inp" id="nDesc" rows="2" placeholder="개념 설명 (선택)" style="margin-top:6px">${esc(n.desc || '')}</textarea>
    <div style="display:flex;gap:6px;margin-top:6px"><button class="btn primary" id="nSave">저장</button><button class="btn danger" id="nDel">노드 삭제</button></div>
    <div class="side-sec"><h4>이해도 (정답률)</h4><div class="big-pct" style="color:${col}">${s.n ? pctStr(s.rate) : '-'}</div>
      <div class="gauge"><b style="width:${s.n ? s.rate * 100 : 0}%;background:${col}"></b></div>
      <div style="font-size:12px;color:var(--sub)">응답 ${s.n}건 · 정답 ${s.c}건 · 오답 ${s.n - s.c}건</div></div>
    <div class="side-sec"><h4>오개념 목록 <small style="color:var(--sub);font-weight:400">(${misList.length})</small></h4>
      ${misList.map(m => `<div class="mis-item mis-def"><span style="flex:1;cursor:pointer" data-medit="${m.id}" title="눌러서 고치기">${esc(m.name)}${m.desc ? `<div style="font-size:12px;color:var(--sub)">${esc(m.desc)}</div>` : ''}</span><button class="btn ghost" data-mdel="${m.id}" title="삭제">×</button></div>`).join('') || '<div style="color:#9aa0ac;font-size:13px">이 개념의 오개념이 아직 없어요.</div>'}
      <input class="inp" id="nMisNew" placeholder="새 오개념 입력 후 Enter" style="margin-top:6px"></div>
    <div class="side-sec"><h4>학생 응답에서 나타난 오개념</h4>${s.mis.length ? s.mis.map(m => `<div class="mis-item"><div style="display:flex;gap:8px"><span style="flex:1">${esc(m.text)}</span><b>${m.count}회</b></div>
      <div class="bar"><b style="width:${m.count / maxMis * 100}%"></b></div></div>`).join('') : '<div style="color:#9aa0ac;font-size:13px">기록된 오개념이 없어요.<br>(문제의 오답 선지에 오개념을 적어 두면 여기에 모여요)</div>'}</div>
    <div class="side-sec"><h4>연결된 문제 (${s.qs.length})</h4>${s.qs.length ? s.qs.map(q => `<div class="side-q" data-hq="${esc(q.id)}" title="눌러서 고정"><span style="flex:1">${esc(q.title)}</span><span style="color:${lvColor(q.rate, q.n)}">${q.n ? pctStr(q.rate) + ` (${q.n})` : '응답 없음'}</span></div>`).join('') : '<div style="color:#9aa0ac;font-size:13px">문제은행의 문제 편집 화면에서 이 개념을 연결할 수 있어요.</div>'}</div>`;
  $('#nSave').onclick = async () => { applyMap(await call('saveNode', {id:n.id, subject:CM.subject, kind:'concept', unit:$('#nUnit').value, name:$('#nName').value, desc:$('#nDesc').value, x:n.x, y:n.y, classId:CM.classId})); toast('저장했어요'); };
  const misSave = async m => { setMisList(CM.subject, await call('saveMisconception', m)); drawSide(); };
  $('#nMisNew').onkeydown = e => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.value.trim()) return;
    misSave({subject:CM.subject, name:e.target.value.trim(), desc:'', conceptIds:[n.id]}).then(() => { const i = $('#nMisNew'); if (i) i.focus(); });
  };
  $$('[data-medit]', side).forEach(x => x.onclick = () => editMisModal(S.miscons.find(y => y.id === x.dataset.medit)));
  $$('[data-mdel]', side).forEach(x => x.onclick = async () => {
    const m = S.miscons.find(y => y.id === x.dataset.mdel);
    if (!await confirmBox(`'${m.name}' 오개념을 삭제할까요?`, '삭제', true)) return;
    setMisList(CM.subject, await call('deleteMisconception', m.id, CM.subject)); dropMisEverywhere(m.id); drawSide();
  });
  $('#nDel').onclick = async () => {
    if (!await confirmBox(`'${n.name}' 노드와 연결선을 삭제할까요?`, '삭제', true)) return;
    CM.sel = null; await call('deleteNode', n.id, CM.subject); loadMap();
  };
}
/* ---------- 개념 지도: 확대 · 축소 · 화면 이동 ---------- */
const ZMIN = 0.25, ZMAX = 2.5;
function cmZoomKey(){ return 'cm_zoom_' + (CM ? CM.subject : ''); }
/** 배율을 바꾸면서 (ax, ay) 화면 좌표 아래의 지점이 그대로 있게 */
function applyZoom(z, ax, ay){
  const map = $('#cmap'), stage = $('#cstage'), sizer = $('#csizer');
  if (!CM || !map || !stage) return;
  z = Math.max(ZMIN, Math.min(ZMAX, Math.round(z * 1000) / 1000));
  const mr = map.getBoundingClientRect();
  if (ax == null) { ax = mr.left + map.clientWidth / 2; ay = mr.top + map.clientHeight / 2; }
  const old = CM.zoom || 1;
  const px = (map.scrollLeft + ax - mr.left) / old, py = (map.scrollTop + ay - mr.top) / old;
  CM.zoom = z;
  stage.style.transform = `scale(${z})`;
  sizer.style.width = Math.ceil(CM.W * z) + 'px'; sizer.style.height = Math.ceil(CM.H * z) + 'px';
  map.scrollLeft = px * z - (ax - mr.left); map.scrollTop = py * z - (ay - mr.top);
  const lbl = $('#cmZoomPct'); if (lbl) lbl.textContent = Math.round(z * 100) + '%';
  store.set(cmZoomKey(), String(z));
}
/** 모든 노드가 보이게 */
function zoomFit(){
  const map = $('#cmap');
  if (!CM || !map || !CM.data.nodes.length) return;
  const xs = CM.data.nodes.map(n => n.x), ys = CM.data.nodes.map(n => n.y);
  const x0 = Math.min(...xs) - 120, x1 = Math.max(...xs) + 120, y0 = Math.min(...ys) - 90, y1 = Math.max(...ys) + 110;
  const z = Math.max(ZMIN, Math.min(1.4, Math.min(map.clientWidth / (x1 - x0), map.clientHeight / (y1 - y0))));
  applyZoom(z);
  map.scrollLeft = ((x0 + x1) / 2) * z - map.clientWidth / 2;
  map.scrollTop = ((y0 + y1) / 2) * z - map.clientHeight / 2;
}
function bindMapView(){
  const map = $('#cmap');
  // 휠: 마우스 휠 = 확대 · 축소 / 터치패드 두 손가락 = 화면 이동(기본 스크롤) / 터치패드 오므리기(Ctrl+휠) = 확대 · 축소
  let padAt = 0;
  map.addEventListener('wheel', e => {
    if (!CM) return;
    const now = Date.now();
    if (!e.ctrlKey && (e.deltaX !== 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && e.deltaY % 1 !== 0) || (e.deltaMode === 0 && Math.abs(e.deltaY) < 16))) padAt = now;
    const wheel = e.ctrlKey || (now - padAt > 350 && (e.deltaMode === 1 || Math.abs(e.deltaY) >= 40));
    if (!wheel) return;   // 터치패드 이동은 브라우저 스크롤 그대로
    e.preventDefault();
    const k = e.ctrlKey ? Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)) : (e.deltaY < 0 ? 1.15 : 1 / 1.15);
    applyZoom(CM.zoom * k, e.clientX, e.clientY);
  }, {passive:false});
  // 빈 곳을 클릭한 채 끌기 = 화면 이동 · 두 손가락(터치 화면) = 확대 · 축소
  const pts = new Map();
  let pan = null, pinch = null;
  const isBg = t => !t.closest('.cnode') && !t.closest('g[data-lid]');
  map.addEventListener('pointerdown', e => {
    if (!CM || (e.pointerType === 'mouse' && e.button !== 0) || !isBg(e.target)) return;
    pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
    try { map.setPointerCapture(e.pointerId); } catch(err){}
    if (pts.size === 1) { pan = {x:e.clientX, y:e.clientY, l:map.scrollLeft, t:map.scrollTop, moved:false}; map.classList.add('panning'); }
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = {d:Math.hypot(a.x - b.x, a.y - b.y) || 1, z:CM.zoom};
      pan = null;
    }
  });
  map.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      applyZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pan) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      map.scrollLeft = pan.l - dx; map.scrollTop = pan.t - dy;
    }
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) {
      const clicked = pan && !pan.moved;
      pan = null; map.classList.remove('panning');
      if (clicked && CM.sel) { CM.sel = null; $$('.cnode').forEach(x => x.classList.remove('sel')); drawSide(); }   // 빈 곳 클릭 = 선택 해제
    }
  };
  map.addEventListener('pointerup', end);
  map.addEventListener('pointercancel', end);
  $('#cmZoomIn').onclick = () => applyZoom(CM.zoom * 1.2);
  $('#cmZoomOut').onclick = () => applyZoom(CM.zoom / 1.2);
  $('#cmZoomPct').onclick = () => applyZoom(1);
  $('#cmZoomFit').onclick = zoomFit;
}

/* ---------- 개념 지도: 자동 배치 (단원별 정렬 · 방사형 · 관계망 · 원형) ---------- */
const GRID = 20;
/**
 * 단원별 정렬: 단원을 왼쪽부터 한 줄로, 각 단원의 개념은 그 아래 칸에 줄 맞춰.
 * 한 단원 안에서는 연결선의 앞 개념이 먼저 오게(선수 개념 → 뒤 개념), 같은 단계는 이름순.
 */
function layoutTidy(nodes, links){
  const P = {}, groups = [];
  // 단원이 없는 개념은 한 덩어리로 길게 쌓지 않고, 서로 연결된 개념끼리 묶어 따로 놓음
  layoutGroups(nodes).forEach(g => {
    if (g.unit || g.kids.length <= 6) return groups.push(g);
    const left = new Map(g.kids.map(k => [k.id, k]));
    while (left.size) {
      const first = left.values().next().value, comp = [first], stack = [first.id];
      left.delete(first.id);
      while (stack.length) {
        const id = stack.pop();
        links.forEach(l => {
          const o = l.from === id ? l.to : l.to === id ? l.from : null;
          if (o && left.has(o)) { comp.push(left.get(o)); stack.push(o); left.delete(o); }
        });
      }
      groups.push({unit:null, kids:comp});
    }
  });
  const COLW = 190, ROWH = 150, GAP = 70;
  let x = 0;
  groups.forEach(g => {
    const kids = g.kids, ids = new Set(kids.map(k => k.id));
    // 단원 안 연결로 단계(깊이) 매기기
    const ins = {}; kids.forEach(k => ins[k.id] = []);
    links.forEach(l => { if (ids.has(l.from) && ids.has(l.to)) ins[l.to].push(l.from); });
    const depth = {};
    const dep = (id, seen) => {
      if (depth[id] != null) return depth[id];
      if (seen.has(id)) return 0;
      seen.add(id);
      const d = ins[id].length ? 1 + Math.max(...ins[id].map(p => dep(p, seen))) : 0;
      return (depth[id] = d);
    };
    kids.forEach(k => dep(k.id, new Set()));
    const order = kids.slice().sort((a, b) => depth[a.id] - depth[b.id] || a.name.localeCompare(b.name, 'ko'));
    const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(order.length / 1.6))));
    const w = cols * COLW;
    if (g.unit) P[g.unit.id] = {x:x + w / 2, y:0};
    order.forEach((k, i) => { P[k.id] = {x:x + COLW / 2 + (i % cols) * COLW, y:170 + Math.floor(i / cols) * ROWH}; });
    x += w + GAP;
  });
  return P;
}
function layoutGroups(nodes){
  const units = nodes.filter(n => n.kind === 'unit'), cons = nodes.filter(n => n.kind !== 'unit');
  const names = [...new Set(units.map(u => u.name).concat(cons.map(c => c.unit || '').filter(Boolean)))];
  const groups = names.map(name => ({unit:units.find(u => u.name === name) || null, kids:cons.filter(c => (c.unit || '') === name)}));
  const loose = cons.filter(c => !c.unit || !names.includes(c.unit));
  if (loose.length) groups.push({unit:null, kids:loose});
  return groups.filter(g => g.unit || g.kids.length);
}
/** 방사형: 가운데에서 단원이 안쪽 원, 각 단원의 개념이 그 방향 바깥 원에 부채꼴로 */
function layoutRadial(nodes){
  const P = {}, groups = layoutGroups(nodes);
  const cx = 0, cy = 0;
  if (groups.length === 1) {
    const g = groups[0];
    if (g.unit) P[g.unit.id] = {x:cx, y:cy};
    ringPlace(g.kids, 0, Math.PI * 2, g.unit ? 230 : 0, P, cx, cy);
    return P;
  }
  const weight = groups.map(g => Math.max(1.5, g.kids.length));
  const tot = weight.reduce((a, b) => a + b, 0);
  const R1 = Math.max(200, groups.length * 46);
  let a0 = -Math.PI / 2 - Math.PI * weight[0] / tot;
  groups.forEach((g, i) => {
    const span = Math.PI * 2 * weight[i] / tot, mid = a0 + span / 2;
    if (g.unit) P[g.unit.id] = {x:cx + R1 * Math.cos(mid), y:cy + R1 * Math.sin(mid)};
    ringPlace(g.kids, a0 + span * 0.06, span * 0.88, R1 + 210, P, cx, cy);
    a0 += span;
  });
  return P;
}
/** 부채꼴(시작각 a0, 폭 span) 안에 반지름 r부터 바깥으로 겹치지 않게 (한 바퀴에 들어갈 만큼씩) */
function ringPlace(list, a0, span, r, P, cx, cy){
  if (!list.length) return;
  const sorted = list.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  if (r === 0 && sorted.length === 1) { P[sorted[0].id] = {x:cx, y:cy}; return; }
  r = r || 200;
  let i = 0, ring = 0;
  while (i < sorted.length) {
    const rr = r + ring * 150;
    const cap = Math.max(1, Math.floor((span * rr) / 150));
    const take = sorted.slice(i, i + cap);
    take.forEach((n, k) => {
      const a = take.length === 1 ? a0 + span / 2 : span >= Math.PI * 2 - 1e-6 ? a0 + (span * k) / take.length + ring * 0.3 : a0 + (span * k) / (take.length - 1);
      P[n.id] = {x:cx + rr * Math.cos(a), y:cy + rr * Math.sin(a)};
    });
    i += take.length; ring++;
  }
}
/** 관계망: 연결선(과 단원 소속)을 스프링처럼 당기고 노드끼리는 밀어내는 자유 배치 */
function layoutForce(nodes, links){
  const start = layoutRadial(nodes);
  const N = nodes.map(n => ({id:n.id, x:start[n.id].x + Math.random() * 4, y:start[n.id].y + Math.random() * 4, dx:0, dy:0}));
  const idx = new Map(N.map((n, i) => [n.id, i]));
  const E = links.map(l => [idx.get(l.from), idx.get(l.to)]).filter(e => e[0] != null && e[1] != null);
  const units = nodes.filter(n => n.kind === 'unit');
  nodes.forEach(n => { if (n.kind !== 'unit' && n.unit) { const u = units.find(x => x.name === n.unit); if (u) E.push([idx.get(u.id), idx.get(n.id)]); } });
  const k = 170;
  let temp = 120;
  for (let it = 0; it < 450; it++) {
    N.forEach(n => { n.dx = 0; n.dy = 0; });
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const a = N[i], b = N[j];
      let dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 0.01;
      const f = (k * k) / d;
      dx /= d; dy /= d;
      a.dx += dx * f; a.dy += dy * f; b.dx -= dx * f; b.dy -= dy * f;
    }
    E.forEach(([i, j]) => {
      const a = N[i], b = N[j];
      let dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 0.01;
      const f = (d * d) / k;
      dx /= d; dy /= d;
      a.dx -= dx * f; a.dy -= dy * f; b.dx += dx * f; b.dy += dy * f;
    });
    const mx = N.reduce((t, n) => t + n.x, 0) / N.length, my = N.reduce((t, n) => t + n.y, 0) / N.length;
    N.forEach(n => {   // 가운데로 당김 (연결이 없는 무리끼리 너무 멀어지지 않게)
      n.dx -= (n.x - mx) * 1.1; n.dy -= (n.y - my) * 1.1;
      const d = Math.hypot(n.dx, n.dy) || 0.01, s = Math.min(d, temp);
      n.x += (n.dx / d) * s; n.y += (n.dy / d) * s;
    });
    temp = Math.max(2, temp * 0.985);
  }
  const P = {};
  N.forEach(n => P[n.id] = {x:n.x, y:n.y});
  return P;
}
function layoutCircle(nodes){
  const order = layoutGroups(nodes).flatMap(g => (g.unit ? [g.unit] : []).concat(g.kids.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'))));
  const r = Math.max(220, (order.length * 150) / (Math.PI * 2)), P = {};
  order.forEach((n, i) => { const a = -Math.PI / 2 + (Math.PI * 2 * i) / order.length; P[n.id] = {x:r * Math.cos(a), y:r * Math.sin(a)}; });
  return P;
}
/** 겹친 노드를 살짝 밀어내고 왼쪽 위 여백에 맞춰 정수 좌표로 */
function finishLayout(P){
  const ids = Object.keys(P);
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = P[ids[i]], b = P[ids[j]];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      if (d < 120) { const m = (120 - d) / 2, ux = dx / d, uy = dy / d; a.x -= ux * m; a.y -= uy * m; b.x += ux * m; b.y += uy * m; moved = true; }
    }
    if (!moved) break;
  }
  const minX = Math.min(...ids.map(i => P[i].x)), minY = Math.min(...ids.map(i => P[i].y));
  ids.forEach(i => { P[i] = {x:Math.round((P[i].x - minX + 140) / GRID) * GRID, y:Math.round((P[i].y - minY + 110) / GRID) * GRID}; });
  return P;
}
function autoLayoutModal(){
  if (!CM || !CM.data.nodes.length) return toast('배치할 노드가 없어요', true);
  const opts = [
    ['tidy', '단원별 정렬', '단원을 한 줄로 놓고, 각 단원의 개념을 그 아래에 줄 맞춰 놓아요. 앞 개념(선수 개념)이 위에 와요.'],
    ['radial', '방사형', '가운데에서 단원이 둘러싸고, 각 단원의 개념이 그 방향 바깥으로 퍼져요.'],
    ['force', '관계망 (자유 배치)', '연결선으로 이어진 개념끼리 가까이, 나머지는 멀리 — 연결 구조가 잘 보여요.'],
    ['circle', '원형', '모든 노드를 단원 순서대로 큰 원 위에 놓아요.']
  ];
  modal({title:'자동 배치', body:opts.map((o, i) => `<label class="pc-item" style="padding:9px 10px;border:1px solid var(--line);margin-bottom:6px"><input type="radio" name="lay" value="${o[0]}" ${o[0] === 'force' ? 'checked' : ''}> <b>${o[1]}</b><div class="an-sub" style="margin:2px 0 0 22px">${o[2]}</div></label>`).join('') +
    '<div class="an-sub">배치한 뒤에도 노드를 끌어 자유롭게 옮길 수 있고, [배치 되돌리기]로 원래대로 돌릴 수 있어요.</div>',
    buttons:[{label:'취소'}, {label:'배치하기', primary:true, onClick:bg => applyLayout($('input[name=lay]:checked', bg).value)}]});
}
function applyLayout(kind){
  const nodes = CM.data.nodes;
  CM.prevPos = nodes.map(n => ({id:n.id, x:n.x, y:n.y}));
  const P = finishLayout(kind === 'tidy' ? layoutTidy(nodes, CM.data.links) : kind === 'force' ? layoutForce(nodes, CM.data.links) : kind === 'circle' ? layoutCircle(nodes) : layoutRadial(nodes));
  nodes.forEach(n => { if (P[n.id]) { n.x = P[n.id].x; n.y = P[n.id].y; } });
  drawMap(); zoomFit(); saveNodePositions();
  const u = $('#cmUndo'); if (u) u.style.display = '';
  toast('자동으로 배치했어요');
}
function saveNodePositions(){
  const nodes = CM.data.nodes;   // 화면을 떠나도(CM = null) 저장되게 미리 잡아 둠
  clearTimeout(CM.posT);
  CM.posT = setTimeout(() => call('savePositions', nodes.map(x => ({id:x.id, x:x.x, y:x.y}))).catch(() => {}), 500);
}
function addNodeModal(){
  modal({title:'개념 노드 추가', body:`<label class="f">개념 이름</label><input class="inp" id="anName" placeholder="예) 역학적 에너지 보존">
    <label class="f">단원</label><input class="inp" id="anUnit" placeholder="예) 일과 에너지">
    <label class="f">설명 (선택)</label><textarea class="inp" id="anDesc" rows="2"></textarea>`,
    buttons:[{label:'취소'}, {label:'추가', primary:true, onClick:async bg => {
      const map = $('#cmap');
      const z = CM.zoom || 1;
      const x = (map.scrollLeft + map.clientWidth / 2) / z + (Math.random() * 120 - 60), y = (map.scrollTop + map.clientHeight / 2) / z + (Math.random() * 80 - 40);
      applyMap(await call('saveNode', {subject:CM.subject, unit:$('#anUnit', bg).value, name:$('#anName', bg).value, desc:$('#anDesc', bg).value, x, y, classId:CM.classId}));
    }}]});
}
/* =====================================================================
 *  설정
 * ===================================================================== */
function renderSettings(){
  const main = $('#main');
  main.innerHTML = `<div class="page-title"><h1>설정</h1></div>
    <div class="set-sec"><h3>학생 접속 주소</h3><p class="d">학생 태블릿에서 이 주소로 접속해 학년 · 반 · 번호 · 이름과 비밀번호로 로그인해요. 처음에는 학생 목록 관리에서 만든 6자리 처음 비밀번호로 들어와 자기 비밀번호를 정해요. [수업하기 › 학생 목록 관리]에 등록한 학생만 들어올 수 있어요.</p>
      <div class="copy-url"><input class="inp" id="stuUrl" readonly value="${esc(studentUrl())}"><button class="btn" id="cpUrl">복사</button></div></div>
    <div class="set-sec"><h3>OpenAI (AI 문제 제작)</h3><p class="d">API 키는 Vercel 프로젝트의 환경변수 <b>OPENAI_API_KEY</b> 로 관리해요. (화면에서 입력하지 않아요)
      현재 상태: <b>${S.settings.hasKey ? '키 등록됨' : '키 없음'}</b></p>
      <label class="f">글 모델 (문제 만들기 · 서식 정리 · 출제 조언)</label><input class="inp" id="setModel" list="txtModels" value="${esc(S.settings.model || 'gpt-6-luna')}"><datalist id="txtModels"><option value="gpt-6-luna"></datalist>
      <label class="f">그림 모델 (AI로 그림 만들기)</label><input class="inp" id="setImgModel" list="imgModels" value="${esc(S.settings.imageModel || 'gpt-image-2.5-sunburst')}">
      <datalist id="imgModels"><option value="gpt-image-2.5-sunburst"><option value="gpt-image-1.5"><option value="gpt-image-2"><option value="gpt-image-1-mini"></datalist>
      <p class="d" style="margin:4px 0 0">그림은 그림을 만들 수 있는 모델로 따로 만들어요. 적은 모델을 쓸 수 없으면 이 키로 쓸 수 있는 다른 그림 모델로 한 번 더 시도해요.</p>
      <div style="margin-top:10px;display:flex;gap:6px"><button class="btn primary" id="saveKey">저장</button></div></div>
    <div class="set-sec"><h3>학기 관리</h3><p class="d">클래스를 만들 때 이 기간의 달력으로 수업 차시가 자동 생성돼요.</p>
      <table class="ltable"><thead><tr><th>학기 이름</th><th>시작일</th><th>종료일</th><th></th></tr></thead><tbody>
      ${S.semesters.map(s => `<tr data-sid="${s.id}"><td><input class="inp" data-k="name" value="${esc(s.name)}"></td><td><input class="inp" type="date" data-k="start" value="${s.start}"></td>
        <td><input class="inp" type="date" data-k="end" value="${s.end}"></td><td style="white-space:nowrap"><button class="btn" data-ss>저장</button> <button class="btn danger" data-sd>삭제</button></td></tr>`).join('')}
      <tr data-sid=""><td><input class="inp" data-k="name" placeholder="예) 2027년 1학기"></td><td><input class="inp" type="date" data-k="start"></td><td><input class="inp" type="date" data-k="end"></td><td><button class="btn primary" data-ss>추가</button></td></tr>
      </tbody></table></div>
    <div class="set-sec"><h3>공휴일 · 휴업일</h3><p class="d">한 줄에 하나씩 "YYYY-MM-DD 이름" 형식으로 입력하세요. 이 날짜에는 수업 차시가 만들어지지 않아요. (이미 만든 클래스에는 적용되지 않아요)</p>
      <textarea class="inp" id="holi" rows="8">${esc(S.holidays.map(h => h.date + ' ' + h.name).join('\n'))}</textarea>
      <div style="margin-top:8px"><button class="btn primary" id="saveHoli">저장</button></div></div>
    <div class="set-sec"><h3>비밀번호 변경</h3>
      <div class="row"><input class="inp" id="newPw" type="password" placeholder="새 비밀번호 (6자 이상)"><button class="btn primary" id="savePw" style="flex:none">변경</button></div>
      <div style="margin-top:12px"><button class="btn" id="logout">로그아웃</button></div></div>`;
  $('#cpUrl').onclick = () => { const i = $('#stuUrl'); i.select(); try { document.execCommand('copy'); toast('복사했어요'); } catch(e){} };
  $('#saveKey').onclick = async () => {
    S.settings = await call('saveSettings', {model:$('#setModel').value, imageModel:$('#setImgModel').value});
    toast('저장했어요'); renderSettings();
  };
  $$('[data-ss]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr');
    const r = await call('saveSemester', {id:tr.dataset.sid, name:$('[data-k=name]', tr).value, start:$('[data-k=start]', tr).value, end:$('[data-k=end]', tr).value});
    S.semesters = r.semesters; S.classes = r.classes; toast('저장했어요'); renderSettings();
  });
  $$('[data-sd]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('이 학기를 삭제할까요?', '삭제', true)) return;
    const r = await call('deleteSemester', b.closest('tr').dataset.sid); S.semesters = r.semesters; renderSettings();
  });
  $('#saveHoli').onclick = async () => { const r = await call('saveHolidays', $('#holi').value); S.holidays = r.holidays; toast('저장했어요'); };
  $('#savePw').onclick = async () => { await call('saveSettings', {newPassword:$('#newPw').value}); $('#newPw').value = ''; toast('비밀번호를 바꿨어요'); };
  $('#logout').onclick = () => { const f = document.createElement('form'); f.method = 'post'; f.action = '/auth/signout'; document.body.appendChild(f); f.submit(); };
}

/* ===================== 단축키 ===================== */
document.addEventListener('keydown', e => {
  // Ctrl+S (Mac ⌘S): 편집 중인 문제 저장
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
    const sh = S.ed && !S.ed.min && $('#qEditor') ? curSheet() : null;
    if (sh) { e.preventDefault(); if (!$('.modal-bg')) saveSheet(sh); }
    return;
  }
  // Backspace: 문제은행에서 상위 폴더로 (입력 중이 아닐 때)
  if (e.key === 'Backspace' && S.view === 'bank' && (!S.ed || S.ed.min) && !$('.modal-bg') && !e.target.closest('input,textarea,select,[contenteditable]') && S.cwd) {
    e.preventDefault(); bankAction('up');
  }
});

/* ===================== 시작 ===================== */
(async function init(){
  renderNav();
  try {
    await loadAll(); renderNav();
    go('home', {}, {pop:true});
    try { history.replaceState({view:'home', params:{}, cwd:'', ed:false}, '', location.pathname + location.search + '#home'); } catch(e){}
  } catch(e) { /* 로그인 필요 시 call() 이 /login 으로 보냄 */ }
})();
