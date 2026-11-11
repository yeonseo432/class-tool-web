/*********************************************************************
 * 실시간 수업 문제풀이 · 개념지도 웹앱  (Google Apps Script)
 * ------------------------------------------------------------------
 *  - 이 스프레드시트가 데이터베이스 역할을 합니다. (시트는 자동 생성)
 *  - 교사 화면 :  웹앱주소
 *  - 학생 화면 :  웹앱주소?page=student
 *  - 이 파일은 수정하지 않아도 됩니다.
 *********************************************************************/

const TZ = 'Asia/Seoul';
const PROPS = PropertiesService.getScriptProperties();

const SHEETS = {
  Folders:   ['id', 'name', 'parentId', 'createdAt'],
  Questions: ['id', 'folderId', 'title', 'subject', 'type', 'stem', 'choices', 'answer', 'explanation',
              'imageUrl', 'conceptIds', 'misconceptions', 'createdAt', 'updatedAt', 'analysis'],
  Semesters: ['id', 'name', 'start', 'end'],
  Holidays:  ['date', 'name'],
  Classes:   ['id', 'semesterId', 'name', 'subject', 'schedule', 'intro', 'createdAt'],
  Lessons:   ['id', 'classId', 'no', 'date', 'day', 'time', 'title', 'questionIds', 'done'],
  Responses: ['timestamp', 'lessonId', 'questionId', 'studentKey', 'studentName', 'answer', 'correct',
              'misconception', 'conceptIds'],
  Concepts:  ['id', 'subject', 'name', 'x', 'y', 'desc'],
  Links:     ['id', 'subject', 'from', 'to'],
  Misconceptions: ['id', 'subject', 'name', 'desc', 'conceptIds']
};
const JSON_FIELDS = { choices: 1, conceptIds: 1, misconceptions: 1, schedule: 1, questionIds: 1, analysis: 1 };

/* =================================================================
 *  웹 진입점
 * ================================================================= */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const page = p.page || 'teacher';
  let t;
  if (page === 'student') {
    t = HtmlService.createTemplateFromFile('Student');
    t.code = String(p.code || '');
  } else if (page === 'widget') {
    t = HtmlService.createTemplateFromFile('Widget');
    t.lessonId = String(p.lesson || '');
    t.token = String(p.t || '');
  } else {
    t = HtmlService.createTemplateFromFile('Index');
  }
  t.appUrl = ScriptApp.getService().getUrl() || '';
  const title = page === 'student' ? '수업 참여' : page === 'widget' ? '수업 위젯' : '수업 도구';
  return t.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 스프레드시트 메뉴 (선택 사항) */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('수업도구')
      .addItem('시트 초기화(처음 1회)', 'setupSheets')
      .addToUi();
  } catch (e) {}
}
function setupSheets() {
  ensure_();
  try { SpreadsheetApp.getUi().alert('준비 완료! 이제 [배포] > [새 배포]로 웹앱을 배포하세요.'); } catch (e) {}
}

/* =================================================================
 *  인증 (교사 비밀번호)
 * ================================================================= */
function authStatus() {
  return JSON.stringify({ hasPassword: !!PROPS.getProperty('PASSWORD') });
}
function login(pw) {
  pw = String(pw || '');
  if (pw.length < 4) throw new Error('비밀번호는 4자 이상이어야 해요.');
  const saved = PROPS.getProperty('PASSWORD');
  if (!saved) { // 처음 접속: 비밀번호 생성
    PROPS.setProperty('PASSWORD', hash_(pw));
  } else if (saved !== hash_(pw)) {
    throw new Error('비밀번호가 맞지 않아요.');
  }
  let token = PROPS.getProperty('TOKEN');
  if (!token) { token = Utilities.getUuid(); PROPS.setProperty('TOKEN', token); }
  return token;
}
function hash_(s) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'qc::' + s, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** 교사용 모든 기능은 이 함수 하나를 통해 호출됩니다. */
function api(token, fn, args) {
  if (!token || token !== PROPS.getProperty('TOKEN')) throw new Error('AUTH: 다시 로그인해 주세요.');
  const f = API[fn];
  if (!f) throw new Error('알 수 없는 기능: ' + fn);
  const r = f.apply(null, args || []);
  return JSON.stringify(r === undefined ? null : r);
}

const API = {
  bootstrap: bootstrap_,
  // 문제은행
  createFolder: createFolder_, renameFolder: renameFolder_, deleteItems: deleteItems_,
  moveItems: moveItems_, copyItems: copyItems_, saveQuestion: saveQuestion_,
  aiChat: aiChat_, aiFormat: aiFormat_, uploadImage: uploadImage_,
  // 수업
  createClass: createClass_, updateClass: updateClass_, deleteClass: deleteClass_,
  getLessons: getLessons_, addLesson: addLesson_, deleteLesson: deleteLesson_, updateLesson: updateLesson_,
  setLessonQuestions: setLessonQuestions_, getLessonDetail: getLessonDetail_, upcoming: upcoming_,
  // 실시간
  startLive: startLive_, liveControl: liveControl_, liveStats: liveStats_,
  // 통계
  getConceptMap: getConceptMap_, saveNode: saveNode_, deleteNode: deleteNode_,
  savePositions: savePositions_, addLink: addLink_, deleteLink: deleteLink_,
  loadPreset: loadPreset_, presets: presets_,
  // 설정
  saveSettings: saveSettings_, saveSemester: saveSemester_, deleteSemester: deleteSemester_,
  saveHolidays: saveHolidays_,
  // 형성평가 분석 · 오개념 · 출제 추천 (Analysis.gs)
  getMisconceptions: (...a) => getMisconceptions_(...a), saveMisconception: (...a) => saveMisconception_(...a),
  deleteMisconception: (...a) => deleteMisconception_(...a), importMisconceptions: (...a) => importMisconceptions_(...a),
  analysisStatus: (...a) => analysisStatus_(...a), analyzeMany: (...a) => analyzeMany_(...a),
  getFormativeStats: (...a) => getFormativeStats_(...a), recommendExam: (...a) => recommendExam_(...a),
  examAdvice: (...a) => examAdvice_(...a)
};

/* =================================================================
 *  시트 유틸
 * ================================================================= */
let __ss = null;
function ss_() {
  if (__ss) return __ss;
  const id = PROPS.getProperty('SS_ID');
  if (id) { try { __ss = SpreadsheetApp.openById(id); return __ss; } catch (e) {} }
  __ss = SpreadsheetApp.getActiveSpreadsheet();
  if (__ss) PROPS.setProperty('SS_ID', __ss.getId());
  return __ss;
}
function sheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const h = SHEETS[name];
    sh.getRange(1, 1, sh.getMaxRows(), h.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#e8eefc');
    sh.setFrozenRows(1);
  }
  return sh;
}
function norm_(v) {
  if (v instanceof Date) {
    return v.getFullYear() < 1901 ? Utilities.formatDate(v, TZ, 'HH:mm') : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  return v;
}
function ser_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}
function rows_(name) {
  const sh = sheet_(name);
  const h = SHEETS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, h.length).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    if (r.every(function (c) { return c === '' || c === null; })) return;
    const o = { _row: i + 2 };
    h.forEach(function (k, j) {
      let v = norm_(r[j]);
      if (JSON_FIELDS[k]) {
        try { v = v === '' ? [] : JSON.parse(v); } catch (e) { v = []; }
      }
      o[k] = v;
    });
    if (o.id !== undefined) o.id = String(o.id);
    out.push(o);
  });
  return out;
}
function toRow_(name, o) { return SHEETS[name].map(function (k) { return ser_(o[k]); }); }
function ensureRows_(sh, lastRow) {
  const max = sh.getMaxRows();
  if (lastRow > max) sh.insertRowsAfter(max, lastRow - max + 100);
}
function insertMany_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name);
  const h = SHEETS[name];
  const start = sh.getLastRow() + 1;
  ensureRows_(sh, start + objs.length - 1);
  const rng = sh.getRange(start, 1, objs.length, h.length);
  rng.setNumberFormat('@');
  rng.setValues(objs.map(function (o) { return toRow_(name, o); }));
}
function insert_(name, o) { insertMany_(name, [o]); return o; }
function writeAll_(name, objs) {
  const sh = sheet_(name);
  const h = SHEETS[name];
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, h.length).clearContent();
  if (objs.length) {
    ensureRows_(sh, objs.length + 1);
    const rng = sh.getRange(2, 1, objs.length, h.length);
    rng.setNumberFormat('@');
    rng.setValues(objs.map(function (o) { return toRow_(name, o); }));
  }
}
function getById_(name, id) {
  return rows_(name).filter(function (o) { return o.id === String(id); })[0] || null;
}
function update_(name, id, patch) {
  const r = getById_(name, id);
  if (!r) throw new Error('데이터를 찾을 수 없어요.');
  Object.keys(patch).forEach(function (k) { if (k !== 'id' && k !== '_row') r[k] = patch[k]; });
  sheet_(name).getRange(r._row, 1, 1, SHEETS[name].length).setValues([toRow_(name, r)]);
  return r;
}
function uid_(p) { return p + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function clean_(o) { const c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; }); return c; }
function cleanAll_(a) { return a.map(clean_); }

/* =================================================================
 *  초기 데이터
 * ================================================================= */
function ensure_() {
  Object.keys(SHEETS).forEach(sheet_);
  syncHeaders_();
  if (!rows_('Semesters').length) {
    insertMany_('Semesters', [
      { id: uid_('s_'), name: '2026년 1학기', start: '2026-03-02', end: '2026-07-17' },
      { id: uid_('s_'), name: '2026년 2학기', start: '2026-08-18', end: '2026-12-31' }
    ]);
  }
  if (!rows_('Holidays').length) {
    const H = [['2026-01-01', '신정'], ['2026-02-16', '설날 연휴'], ['2026-02-17', '설날'], ['2026-02-18', '설날 연휴'],
      ['2026-03-01', '삼일절'], ['2026-03-02', '대체공휴일'], ['2026-05-05', '어린이날'], ['2026-05-24', '부처님오신날'],
      ['2026-05-25', '대체공휴일'], ['2026-06-03', '지방선거'], ['2026-06-06', '현충일'], ['2026-08-15', '광복절'],
      ['2026-08-17', '대체공휴일'], ['2026-09-24', '추석 연휴'], ['2026-09-25', '추석'], ['2026-09-26', '추석 연휴'],
      ['2026-10-03', '개천절'], ['2026-10-05', '대체공휴일'], ['2026-10-09', '한글날'], ['2026-12-25', '성탄절']];
    insertMany_('Holidays', H.map(function (x) { return { date: x[0], name: x[1] }; }));
  }
  if (!PROPS.getProperty('SEEDED')) {
    PROPS.setProperty('SEEDED', '1');
    if (!rows_('Folders').length && !rows_('Questions').length) {
      const f = { id: uid_('f_'), name: '예시 문제', parentId: '', createdAt: Date.now() };
      insert_('Folders', f);
      insertMany_('Questions', [{
        id: uid_('q_'), folderId: f.id, title: '자유낙하와 역학적 에너지', subject: '물리', type: 'mc',
        stem: '공기 저항을 무시할 때, 높이 h에서 가만히 놓아 자유낙하하는 물체에 대한 설명으로 옳은 것은?',
        choices: ['운동 에너지는 일정하다.', '위치 에너지는 증가한다.', '역학적 에너지는 일정하다.', '속력은 일정하다.', '가속도는 점점 커진다.'],
        answer: '3', explanation: '중력만 일을 하므로 위치 에너지 감소량만큼 운동 에너지가 증가하여 역학적 에너지는 보존된다.',
        imageUrl: '', conceptIds: [],
        misconceptions: ['운동하는 동안 운동 에너지가 변하지 않는다고 생각함', '높이가 낮아져도 위치 에너지가 증가한다고 착각함', '',
          '등속 운동과 등가속도 운동을 혼동함', '중력 가속도가 낙하할수록 커진다고 생각함'],
        createdAt: Date.now(), updatedAt: Date.now()
      }, {
        id: uid_('q_'), folderId: f.id, title: '운동 에너지 계산', subject: '물리', type: 'short',
        stem: '질량 2 kg인 물체가 3 m/s의 속력으로 운동하고 있다. 이 물체의 운동 에너지는 몇 J인가?',
        choices: [], answer: '9|9J|9 J', explanation: 'Ek = ½mv² = ½ × 2 × 3² = 9 J',
        imageUrl: '', conceptIds: [], misconceptions: [], createdAt: Date.now(), updatedAt: Date.now()
      }]);
    }
  }
}

function bootstrap_() {
  ensure_();
  const b = bank_();
  return {
    folders: b.folders, questions: b.questions,
    classes: classesMeta_(),
    semesters: cleanAll_(rows_('Semesters')),
    holidays: cleanAll_(rows_('Holidays')),
    concepts: conceptsLite_(),
    settings: { hasKey: !!PROPS.getProperty('OPENAI_KEY'), model: PROPS.getProperty('OPENAI_MODEL') || 'gpt-4o-mini' },
    today: today_(),
    appUrl: ScriptApp.getService().getUrl() || ''
  };
}
function conceptsLite_() {
  return rows_('Concepts').map(function (c) { return { id: c.id, subject: c.subject, name: c.name }; });
}

/* =================================================================
 *  문제은행
 * ================================================================= */
function bank_() {
  return { folders: cleanAll_(rows_('Folders')), questions: cleanAll_(rows_('Questions')) };
}
function createFolder_(name, parentId) {
  name = String(name || '').trim() || '새 폴더';
  insert_('Folders', { id: uid_('f_'), name: name, parentId: parentId || '', createdAt: Date.now() });
  return bank_();
}
function renameFolder_(id, name) {
  update_('Folders', id, { name: String(name || '').trim() || '이름 없음' });
  return bank_();
}
function descendants_(folders, ids) {
  const set = {};
  const stack = ids.slice();
  while (stack.length) {
    const id = stack.pop();
    if (set[id]) continue;
    set[id] = 1;
    folders.forEach(function (f) { if (f.parentId === id) stack.push(f.id); });
  }
  return set;
}
function deleteItems_(sel) {
  const folders = rows_('Folders');
  const qs = rows_('Questions');
  const dead = descendants_(folders, sel.folderIds || []);
  const qdead = {};
  (sel.questionIds || []).forEach(function (id) { qdead[id] = 1; });
  writeAll_('Folders', folders.filter(function (f) { return !dead[f.id]; }));
  writeAll_('Questions', qs.filter(function (q) { return !qdead[q.id] && !dead[q.folderId]; }));
  return bank_();
}
function moveItems_(sel, target) {
  target = target || '';
  const folders = rows_('Folders');
  const qs = rows_('Questions');
  const fids = sel.folderIds || [];
  const banned = descendants_(folders, fids);
  if (banned[target]) throw new Error('폴더를 자기 자신(또는 하위 폴더) 안으로 옮길 수 없어요.');
  folders.forEach(function (f) { if (fids.indexOf(f.id) >= 0) f.parentId = target; });
  qs.forEach(function (q) { if ((sel.questionIds || []).indexOf(q.id) >= 0) { q.folderId = target; q.updatedAt = Date.now(); } });
  if (fids.length) writeAll_('Folders', folders);
  if ((sel.questionIds || []).length) writeAll_('Questions', qs);
  return bank_();
}
function copyItems_(sel, target) {
  const folders = rows_('Folders');
  const qs = rows_('Questions');
  const nf = [], nq = [], now = Date.now();
  function copyQ(q, fid, suf) {
    const c = clean_(q);
    c.id = uid_('q_'); c.folderId = fid; c.title = q.title + (suf || ''); c.createdAt = now; c.updatedAt = now;
    nq.push(c);
  }
  function copyF(f, parent, suf) {
    const c = { id: uid_('f_'), name: f.name + (suf || ''), parentId: parent, createdAt: now };
    nf.push(c);
    folders.filter(function (x) { return x.parentId === f.id; }).forEach(function (x) { copyF(x, c.id); });
    qs.filter(function (q) { return q.folderId === f.id; }).forEach(function (q) { copyQ(q, c.id); });
  }
  (sel.folderIds || []).forEach(function (id) {
    const f = folders.filter(function (x) { return x.id === id; })[0];
    if (f) copyF(f, target == null ? f.parentId : target, ' (사본)');
  });
  (sel.questionIds || []).forEach(function (id) {
    const q = qs.filter(function (x) { return x.id === id; })[0];
    if (q) copyQ(q, target == null ? q.folderId : target, ' (사본)');
  });
  insertMany_('Folders', nf);
  insertMany_('Questions', nq);
  return bank_();
}
function saveQuestion_(q, folderId) {
  q = q || {};
  const now = Date.now();
  const subject = String(q.subject || '').trim();
  let conceptIds = (q.conceptIds || []).slice();
  // AI가 제안한 '새 개념'은 개념지도 노드로 자동 생성
  const newNames = (q.newConcepts || []).filter(function (n) { return String(n).trim(); });
  if (newNames.length && subject) {
    const exist = rows_('Concepts').filter(function (c) { return c.subject === subject; });
    const add = [];
    newNames.forEach(function (n, i) {
      const hit = exist.filter(function (c) { return c.name === n; })[0];
      if (hit) { conceptIds.push(hit.id); return; }
      const c = { id: uid_('c_'), subject: subject, name: n, x: 200 + Math.round(Math.random() * 900), y: 150 + Math.round(Math.random() * 450), desc: '' };
      add.push(c); conceptIds.push(c.id);
    });
    insertMany_('Concepts', add);
  }
  conceptIds = conceptIds.filter(function (v, i, a) { return a.indexOf(v) === i; });
  const rec = {
    folderId: folderId != null ? folderId : (q.folderId || ''),
    title: String(q.title || '').trim() || String(q.stem || '').slice(0, 20) || '제목 없음',
    subject: subject, type: q.type === 'short' ? 'short' : 'mc', stem: q.stem || '',
    choices: q.type === 'short' ? [] : (q.choices || []), answer: String(q.answer == null ? '' : q.answer),
    explanation: q.explanation || '', imageUrl: q.imageUrl || '', conceptIds: conceptIds,
    misconceptions: q.type === 'short' ? [] : (q.misconceptions || []), updatedAt: now
  };
  let saved;
  if (q.id && getById_('Questions', q.id)) {
    saved = update_('Questions', q.id, rec);
  } else {
    rec.id = uid_('q_'); rec.createdAt = now;
    saved = insert_('Questions', rec);
  }
  // 저장할 때마다 개념 지도 · 오개념 목록 기준으로 문항 사전 분석 (Analysis.gs)
  let analysisNote = '';
  if (rec.subject && PROPS.getProperty('OPENAI_KEY')) {
    try { saved = analyzeQuestion_(saved.id); } catch (e) { analysisNote = '문항 분석 실패: ' + ((e && e.message) || e); }
  }
  return { bank: bank_(), question: clean_(saved), concepts: conceptsLite_(), analysisNote: analysisNote };
}

/* ---------- 이미지 업로드 (구글 드라이브) ---------- */
function uploadImage_(dataUrl, name) {
  const m = String(dataUrl).match(/^data:(.+?);base64,(.*)$/);
  if (!m) throw new Error('이미지 형식이 올바르지 않아요.');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name || 'image');
  let folderId = PROPS.getProperty('IMG_FOLDER');
  let folder = null;
  if (folderId) { try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; } }
  if (!folder) { folder = DriveApp.createFolder('수업도구_문제이미지'); PROPS.setProperty('IMG_FOLDER', folder.getId()); }
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {
    try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {}
  }
  return { url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200' };
}

/* ---------- OpenAI ---------- */
function openai_(messages) {
  const key = PROPS.getProperty('OPENAI_KEY');
  if (!key) throw new Error('OpenAI API 키가 없어요. 왼쪽 메뉴 [설정]에서 키를 입력해 주세요.');
  const model = PROPS.getProperty('OPENAI_MODEL') || 'gpt-4o-mini';
  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ model: model, messages: messages, response_format: { type: 'json_object' } })
  });
  const code = res.getResponseCode();
  let data;
  try { data = JSON.parse(res.getContentText()); } catch (e) { data = {}; }
  if (code >= 300) throw new Error('OpenAI 오류(' + code + '): ' + ((data.error && data.error.message) || res.getContentText().slice(0, 200)));
  const txt = data.choices[0].message.content;
  try { return JSON.parse(txt); } catch (e) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return { reply: txt, question: null };
  }
}
const Q_FORMAT =
  '{"title":"문제 제목(20자 이내)","type":"mc 또는 short","stem":"문항 본문",' +
  '"choices":["선지1","선지2",...] (객관식은 4~5개, 단답형은 []),' +
  '"answer":"객관식은 정답 번호(1부터 시작하는 숫자), 단답형은 정답 텍스트(여러 개 허용 시 | 로 구분)",' +
  '"explanation":"해설",' +
  '"concepts":["이 문제와 관련된 핵심 개념 이름 1~3개"],' +
  '"misconceptions":["각 선지를 고른 학생이 가질 법한 오개념 (선지 순서와 동일, 정답 선지는 빈 문자열)"]}';
function conceptHint_(subject) {
  if (!subject) return '';
  const names = rows_('Concepts').filter(function (c) { return c.subject === subject; }).map(function (c) { return c.name; });
  return names.length ? '\n개념(concepts)은 가능하면 다음 목록의 이름을 그대로 사용해: ' + JSON.stringify(names) : '';
}
function aiChat_(history, subject) {
  const sys = '너는 한국 중·고등학교 교사의 수업용 문항 출제를 돕는 조수야. 반드시 JSON 객체 하나로만 답해.\n' +
    '형식: {"reply":"교사에게 하는 짧은 한국어 답변","question": null 또는 ' + Q_FORMAT + '}\n' +
    '교사가 문제를 만들어 달라고 하면 question을 채우고(한 번에 1문제), 그 외의 대화면 question은 null.\n' +
    '수식은 일반 텍스트로(예: v = 2t + 3, x², ½mv²) 작성. 과목: ' + (subject || '미정') + conceptHint_(subject);
  const msgs = [{ role: 'system', content: sys }].concat((history || []).slice(-12).map(function (m) {
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) };
  }));
  const r = openai_(msgs);
  return { reply: r.reply || '', question: r.question ? normalizeAiQ_(r.question, subject) : null };
}
function aiFormat_(text, subject) {
  const key = PROPS.getProperty('OPENAI_KEY');
  if (!key) {
    return { question: normalizeAiQ_(localParse_(text), subject),
      note: 'API 키가 없어 기본 규칙으로 정리했어요. (설정에서 키를 넣으면 AI가 더 정확히 정리해요)' };
  }
  const sys = '너는 교사가 직접 입력한 문제를 정해진 서식으로 정리하는 도우미야. 문항 내용은 바꾸지 말고 구조만 정리해. ' +
    '정답이 명시되지 않았다면 가장 타당한 정답을 추정해 넣고, 해설과 선지별 오개념도 채워줘. 반드시 JSON 객체 하나로만 답해.\n' +
    '형식: {"reply":"짧은 안내","question":' + Q_FORMAT + '}\n과목: ' + (subject || '미정') + conceptHint_(subject);
  const r = openai_([{ role: 'system', content: sys }, { role: 'user', content: String(text) }]);
  return { question: normalizeAiQ_(r.question || r, subject), note: r.reply || '' };
}
function normalizeAiQ_(q, subject) {
  q = q || {};
  const type = (q.type === 'short' || (!q.choices || !q.choices.length)) ? 'short' : 'mc';
  const choices = type === 'mc' ? (q.choices || []).map(function (c) { return String(c).replace(/^\s*(?:[①②③④⑤⑥]|\(?[1-6][\).])\s*/, ''); }) : [];
  let answer = String(q.answer == null ? '' : q.answer).trim();
  if (type === 'mc') {
    const circ = '①②③④⑤⑥'.indexOf(answer.charAt(0));
    if (circ >= 0) answer = String(circ + 1);
    const n = parseInt(answer, 10);
    answer = isNaN(n) ? '' : String(n);
  }
  const subj = String(q.subject || subject || '');
  const nodes = rows_('Concepts').filter(function (c) { return c.subject === subj; });
  const conceptIds = [], newConcepts = [];
  (q.concepts || []).forEach(function (name) {
    name = String(name).trim(); if (!name) return;
    const hit = nodes.filter(function (c) { return c.name === name; })[0];
    if (hit) conceptIds.push(hit.id); else newConcepts.push(name);
  });
  const mis = choices.map(function (_, i) { return String((q.misconceptions || [])[i] || ''); });
  if (type === 'mc' && answer) mis[Number(answer) - 1] = '';
  return {
    id: '', title: String(q.title || '').slice(0, 40), subject: subj, type: type, stem: String(q.stem || ''),
    choices: choices, answer: answer, explanation: String(q.explanation || ''), imageUrl: '',
    conceptIds: conceptIds, newConcepts: newConcepts, misconceptions: mis
  };
}
/** API 키 없이 직접 입력한 문제를 대략 정리 */
function localParse_(text) {
  let lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(String);
  // 한 줄에 ①②③ 이 모두 있는 경우 분리
  const exp = [];
  lines.forEach(function (l) {
    if ((l.match(/[①②③④⑤]/g) || []).length >= 2) {
      l.split(/(?=[①②③④⑤])/).forEach(function (p) { if (p.trim()) exp.push(p.trim()); });
    } else exp.push(l);
  });
  lines = exp;
  const choiceRe = /^(?:[①②③④⑤⑥]|\(?[1-6][\).]|[A-Fa-f][\).]|[ㄱ-ㅂ][\).])\s*/;
  const stem = [], choices = [];
  let answer = '', explanation = '', mode = 'stem';
  lines.forEach(function (l) {
    let m;
    if ((m = l.match(/^(?:정답|답)\s*[:：)]?\s*(.+)$/))) { answer = m[1].trim(); mode = 'ans'; return; }
    if ((m = l.match(/^(?:해설|풀이)\s*[:：)]?\s*(.*)$/))) { explanation = m[1].trim(); mode = 'exp'; return; }
    if (mode === 'exp') { explanation += '\n' + l; return; }
    if (choiceRe.test(l) && mode !== 'ans' && (stem.length || choices.length)) { choices.push(l.replace(choiceRe, '')); mode = 'ch'; return; }
    if (mode === 'ch' && choices.length) { choices[choices.length - 1] += ' ' + l; return; }
    stem.push(l);
  });
  if (/^[A-Fa-f]$/.test(answer)) answer = String('abcdef'.indexOf(answer.toLowerCase()) + 1);
  const st = stem.join('\n');
  return { title: st.replace(/^\d+[\.)]\s*/, '').slice(0, 20), type: choices.length ? 'mc' : 'short',
    stem: st.replace(/^\d+[\.)]\s*/, ''), choices: choices, answer: answer, explanation: explanation, concepts: [], misconceptions: [] };
}

/* =================================================================
 *  수업 (클래스 / 차시)
 * ================================================================= */
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function pd_(s) { const a = String(s).split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); }
function fd_(d) { return d.toISOString().slice(0, 10); }

function semStatus_(sem, today) {
  if (!sem) return 'active';
  if (sem.end < today) return 'ended';
  if (sem.start > today) return 'ready';
  return 'active';
}
function classesMeta_() {
  const today = today_();
  const sems = rows_('Semesters');
  const lessons = rows_('Lessons');
  return rows_('Classes').map(function (c) {
    const sem = sems.filter(function (s) { return s.id === c.semesterId; })[0];
    const ls = lessons.filter(function (l) { return l.classId === c.id; })
      .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
    const next = ls.filter(function (l) { return l.date >= today; })[0];
    const o = clean_(c);
    o.semesterName = sem ? sem.name : '';
    o.status = semStatus_(sem, today);
    o.lessonCount = ls.length;
    o.next = next ? { id: next.id, no: next.no, date: next.date, time: next.time } : null;
    return o;
  });
}
function genLessons_(cls, sem, holidays) {
  const hs = {};
  holidays.forEach(function (h) { hs[h.date] = 1; });
  const out = [];
  const slots = (cls.schedule || []).slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  const d = pd_(sem.start), end = pd_(sem.end);
  let no = 0;
  while (d <= end) {
    const ds = fd_(d), wd = d.getUTCDay();
    if (!hs[ds]) {
      slots.forEach(function (s) {
        if (Number(s.day) !== wd) return;
        no++;
        out.push({ id: uid_('l_'), classId: cls.id, no: no, date: ds, day: DAYS[wd], time: s.start + '~' + s.end,
          title: '', questionIds: [], done: '' });
      });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function createClass_(d) {
  const sem = getById_('Semesters', d.semesterId);
  if (!sem) throw new Error('학기를 선택해 주세요.');
  if (!String(d.name || '').trim()) throw new Error('클래스 이름을 입력해 주세요.');
  const seen = {};
  d.schedule = (d.schedule || []).filter(function (s) { const k = s.day + '|' + s.start + '|' + s.end; if (seen[k]) return false; seen[k] = 1; return true; });
  if (!d.schedule.length) throw new Error('요일과 수업 시간을 1개 이상 입력해 주세요.');
  const nm = String(d.name).trim(), sj = String(d.subject || '').trim();
  if (rows_('Classes').some(function (c) { return c.semesterId === sem.id && c.name === nm && c.subject === sj; })) throw new Error('이 학기에 같은 클래스가 이미 있어요.');
  const cls = { id: uid_('k_'), semesterId: sem.id, name: String(d.name).trim(), subject: String(d.subject || '').trim(),
    schedule: d.schedule, intro: String(d.intro || ''), createdAt: Date.now() };
  insert_('Classes', cls);
  const ls = genLessons_(cls, sem, rows_('Holidays'));
  insertMany_('Lessons', ls);
  return { classes: classesMeta_(), classId: cls.id, lessonCount: ls.length };
}
function updateClass_(id, patch) {
  const p = {};
  ['name', 'subject', 'intro'].forEach(function (k) { if (patch[k] != null) p[k] = String(patch[k]); });
  update_('Classes', id, p);
  return { classes: classesMeta_() };
}
function deleteClass_(id) {
  writeAll_('Classes', rows_('Classes').filter(function (c) { return c.id !== id; }));
  writeAll_('Lessons', rows_('Lessons').filter(function (l) { return l.classId !== id; }));
  return { classes: classesMeta_() };
}
function getLessons_(classId) {
  const cls = classesMeta_().filter(function (c) { return c.id === classId; })[0];
  if (!cls) throw new Error('클래스를 찾을 수 없어요.');
  const ls = rows_('Lessons').filter(function (l) { return l.classId === classId; })
    .sort(function (a, b) { return Number(a.no) - Number(b.no); });
  return { cls: cls, lessons: cleanAll_(ls) };
}
function renumber_(classId) {
  const all = rows_('Lessons');
  all.filter(function (l) { return l.classId === classId; })
    .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; })
    .forEach(function (l, i) { l.no = i + 1; });
  writeAll_('Lessons', all);
}
function addLesson_(classId, date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜를 입력해 주세요.');
  insert_('Lessons', { id: uid_('l_'), classId: classId, no: 0, date: date, day: DAYS[pd_(date).getUTCDay()],
    time: time || '', title: '', questionIds: [], done: '' });
  renumber_(classId);
  return getLessons_(classId);
}
function deleteLesson_(id) {
  const l = getById_('Lessons', id);
  if (!l) throw new Error('차시를 찾을 수 없어요.');
  writeAll_('Lessons', rows_('Lessons').filter(function (x) { return x.id !== id; }));
  renumber_(l.classId);
  return getLessons_(l.classId);
}
function updateLesson_(id, patch) {
  const p = {};
  ['title', 'time', 'done'].forEach(function (k) { if (patch[k] != null) p[k] = String(patch[k]); });
  return clean_(update_('Lessons', id, p));
}
function setLessonQuestions_(id, ids) {
  return clean_(update_('Lessons', id, { questionIds: ids || [] }));
}
function getLessonDetail_(id) {
  const l = getById_('Lessons', id);
  if (!l) throw new Error('차시를 찾을 수 없어요.');
  const cls = classesMeta_().filter(function (c) { return c.id === l.classId; })[0];
  return { lesson: clean_(l), cls: cls };
}
function upcoming_() {
  const today = today_();
  const classes = classesMeta_().filter(function (c) { return c.status !== 'ended'; });
  const cmap = {};
  classes.forEach(function (c) { cmap[c.id] = c; });
  return rows_('Lessons').filter(function (l) { return cmap[l.classId] && l.date >= today; })
    .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; })
    .slice(0, 40)
    .map(function (l) {
      const o = clean_(l);
      o.className = cmap[l.classId].name; o.subject = cmap[l.classId].subject;
      return o;
    });
}

/* =================================================================
 *  실시간 수업 (교사 위젯 ↔ 학생 태블릿)
 * ================================================================= */
const CACHE_SEC = 21600; // 6시간
function cache_() { return CacheService.getScriptCache(); }
function cget_(k) { const v = cache_().get(k); return v ? JSON.parse(v) : null; }
function cput_(k, o) { try { cache_().put(k, JSON.stringify(o), CACHE_SEC); } catch (e) {} }

function liveGet_(code) {
  code = String(code || '').trim();
  if (!code) return null;
  let st = cget_('LS_' + code);
  if (!st) {
    const p = PROPS.getProperty('LIVE_' + code);
    if (p) { st = JSON.parse(p); cput_('LS_' + code, st); }
  }
  return st;
}
function liveSet_(st) {
  cput_('LS_' + st.code, st);
  PROPS.setProperty('LIVE_' + st.code, JSON.stringify(st));
}
function buildLiveQs_(lessonId) {
  const l = getById_('Lessons', lessonId);
  const qs = rows_('Questions');
  return (l ? l.questionIds : []).map(function (id) {
    return qs.filter(function (q) { return q.id === id; })[0];
  }).filter(Boolean).map(clean_);
}
function liveQs_(st) {
  let qs = cget_('LQ_' + st.code);
  if (!qs) { qs = buildLiveQs_(st.lessonId); cput_('LQ_' + st.code, qs); }
  return qs;
}
function startLive_(lessonId) {
  const l = getById_('Lessons', lessonId);
  if (!l) throw new Error('차시를 찾을 수 없어요.');
  const cls = getById_('Classes', l.classId);
  let code = PROPS.getProperty('LIVE_LESSON_' + lessonId);
  let st = code ? liveGet_(code) : null;
  if (!st || st.phase === 'ended') {
    do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (PROPS.getProperty('LIVE_' + code));
    st = { code: code, lessonId: lessonId, title: (cls ? cls.name : '') + ' · ' + l.no + '차시',
      subject: cls ? cls.subject : '', idx: 0, phase: 'waiting', startedAt: Date.now() };
    PROPS.setProperty('LIVE_LESSON_' + lessonId, code);
    liveSet_(st);
  }
  const qs = buildLiveQs_(lessonId); // 수업 시작 때마다 최신 문제 반영
  cput_('LQ_' + code, qs);
  return liveStats_(code);
}
function liveControl_(code, action, idx) {
  const st = liveGet_(code);
  if (!st) throw new Error('진행 중인 수업이 없어요.');
  const qs = liveQs_(st);
  if (action === 'goto') { st.idx = Math.max(0, Math.min(qs.length - 1, Number(idx) || 0)); st.phase = 'waiting'; }
  else if (action === 'open') st.phase = 'open';
  else if (action === 'close') st.phase = 'closed';
  else if (action === 'reveal') st.phase = 'reveal';
  else if (action === 'end') {
    st.phase = 'ended';
    PROPS.deleteProperty('LIVE_LESSON_' + st.lessonId);
    try { update_('Lessons', st.lessonId, { done: today_() }); } catch (e) {}
  }
  liveSet_(st);
  if (action === 'end') { PROPS.deleteProperty('LIVE_' + code); return { phase: 'ended' }; }
  return liveStats_(code);
}
function respKey_(st, qid) { return 'LR_' + st.code + '_' + st.startedAt + '_' + qid; }
function liveResponses_(st, qid) {
  let r = cget_(respKey_(st, qid));
  if (!r) { // 캐시가 비었으면 시트에서 복구
    r = {};
    rows_('Responses').forEach(function (x) {
      if (x.lessonId === st.lessonId && x.questionId === qid && Number(x.timestamp) >= st.startedAt) {
        r[x.studentKey] = { n: x.studentName, a: String(x.answer), c: Number(x.correct) === 1 };
      }
    });
    cput_(respKey_(st, qid), r);
  }
  return r;
}
function isCorrect_(q, ans) {
  if (q.type === 'mc') return String(ans).trim() === String(q.answer).trim();
  const n = function (s) { return String(s).replace(/\s+/g, '').toLowerCase(); };
  return String(q.answer).split('|').map(n).filter(String).indexOf(n(ans)) >= 0;
}
function liveStats_(code) {
  const st = liveGet_(code);
  if (!st) throw new Error('진행 중인 수업이 없어요.');
  const qs = liveQs_(st);
  const q = qs[st.idx] || null;
  const out = { code: st.code, lessonId: st.lessonId, title: st.title, phase: st.phase, idx: st.idx, total: qs.length,
    questions: qs.map(function (x) { return { id: x.id, title: x.title, type: x.type }; }),
    q: q, joined: (cget_('LJ_' + st.code) || []).length, n: 0, correctN: 0, counts: [], shorts: [], submitted: [] };
  if (q) {
    const r = liveResponses_(st, q.id);
    const keys = Object.keys(r);
    out.n = keys.length;
    if (q.type === 'mc') out.counts = (q.choices || []).map(function () { return 0; });
    const sm = {};
    keys.forEach(function (k) {
      const x = r[k];
      if (x.c) out.correctN++;
      out.submitted.push({ name: x.n, c: x.c });
      if (q.type === 'mc') { const i = Number(x.a) - 1; if (i >= 0 && i < out.counts.length) out.counts[i]++; }
      else { const t = String(x.a).trim(); sm[t] = sm[t] || { text: t, count: 0, c: x.c }; sm[t].count++; }
    });
    out.shorts = Object.keys(sm).map(function (k) { return sm[k]; }).sort(function (a, b) { return b.count - a.count; });
  }
  return out;
}

/* ---------- 학생용 (로그인 없이 호출 가능) ---------- */
function studentJoin(code, name) {
  name = String(name || '').trim();
  if (!name) throw new Error('이름을 입력해 주세요.');
  const st = liveGet_(code);
  if (!st || st.phase === 'ended') throw new Error('수업 코드를 찾을 수 없어요. 선생님께 코드를 다시 확인해 주세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const j = cget_('LJ_' + st.code) || [];
    if (j.indexOf(name) < 0) { j.push(name); cput_('LJ_' + st.code, j); }
  } finally { lock.releaseLock(); }
  return JSON.stringify({ ok: true, title: st.title });
}
function studentState(code, name) {
  const st = liveGet_(code);
  if (!st || st.phase === 'ended') return JSON.stringify({ phase: 'ended' });
  const qs = liveQs_(st);
  const q = qs[st.idx];
  const out = { phase: st.phase, idx: st.idx, total: qs.length, title: st.title, question: null, mine: null };
  if (q) {
    out.question = { id: q.id, title: q.title, type: q.type, stem: q.stem, choices: q.choices, imageUrl: q.imageUrl };
    const mine = liveResponses_(st, q.id)[String(name || '').trim()];
    if (mine) out.mine = { a: mine.a };
    if (st.phase === 'reveal') {
      out.question.answer = q.answer; out.question.explanation = q.explanation;
      if (mine) out.mine.c = mine.c;
    }
  }
  return JSON.stringify(out);
}
function studentSubmit(code, name, qid, answer) {
  name = String(name || '').trim();
  const st = liveGet_(code);
  if (!st || st.phase !== 'open') throw new Error('지금은 답을 제출할 수 없어요.');
  const qs = liveQs_(st);
  const q = qs[st.idx];
  if (!q || q.id !== qid) throw new Error('문제가 바뀌었어요. 화면을 확인해 주세요.');
  answer = String(answer == null ? '' : answer).trim();
  if (!answer) throw new Error('답을 선택(입력)해 주세요.');
  const correct = isCorrect_(q, answer);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const key = respKey_(st, q.id);
    const r = liveResponses_(st, q.id);
    if (r[name]) throw new Error('이미 제출했어요.');
    r[name] = { n: name, a: answer, c: correct };
    cput_(key, r);
  } finally { lock.releaseLock(); }
  const mis = (!correct && q.type === 'mc') ? String((q.misconceptions || [])[Number(answer) - 1] || '') : '';
  sheet_('Responses').appendRow(toRow_('Responses', {
    timestamp: Date.now(), lessonId: st.lessonId, questionId: q.id, studentKey: name, studentName: name,
    answer: answer, correct: correct ? 1 : 0, misconception: mis, conceptIds: q.conceptIds || []
  }));
  return JSON.stringify({ ok: true });
}

/* =================================================================
 *  통계 · 개념지도
 * ================================================================= */
function getConceptMap_(subject, classId) {
  const nodes = rows_('Concepts').filter(function (n) { return n.subject === subject; });
  const links = rows_('Links').filter(function (l) { return l.subject === subject; });
  const classes = classesMeta_().filter(function (c) { return c.subject === subject; })
    .map(function (c) { return { id: c.id, name: c.name, semesterName: c.semesterName }; });
  let resp = rows_('Responses');
  if (classId) {
    const lids = {};
    rows_('Lessons').forEach(function (l) { if (l.classId === classId) lids[l.id] = 1; });
    resp = resp.filter(function (r) { return lids[r.lessonId]; });
  }
  const qs = rows_('Questions');
  const qmap = {};
  qs.forEach(function (q) { qmap[q.id] = q; });
  const st = {};
  nodes.forEach(function (n) { st[n.id] = { n: 0, c: 0, mis: {}, qs: {} }; });
  qs.forEach(function (q) {
    (q.conceptIds || []).forEach(function (cid) { if (st[cid]) st[cid].qs[q.id] = st[cid].qs[q.id] || { n: 0, c: 0 }; });
  });
  resp.forEach(function (r) {
    const ok = Number(r.correct) === 1;
    (r.conceptIds || []).forEach(function (cid) {
      const s = st[cid];
      if (!s) return;
      s.n++;
      if (ok) s.c++;
      else if (r.misconception) s.mis[r.misconception] = (s.mis[r.misconception] || 0) + 1;
      const x = s.qs[r.questionId] = s.qs[r.questionId] || { n: 0, c: 0 };
      x.n++; if (ok) x.c++;
    });
  });
  return {
    subject: subject, classes: classes, links: cleanAll_(links),
    nodes: nodes.map(function (n) {
      const s = st[n.id];
      const o = clean_(n);
      o.x = Number(n.x) || 100; o.y = Number(n.y) || 100;
      o.stat = {
        n: s.n, c: s.c, rate: s.n ? s.c / s.n : null,
        mis: Object.keys(s.mis).map(function (k) { return { text: k, count: s.mis[k] }; })
          .sort(function (a, b) { return b.count - a.count; }).slice(0, 8),
        qs: Object.keys(s.qs).map(function (qid) {
          const x = s.qs[qid];
          return { id: qid, title: qmap[qid] ? qmap[qid].title : '(삭제된 문제)', n: x.n, rate: x.n ? x.c / x.n : null };
        })
      };
      return o;
    })
  };
}
function saveNode_(node) {
  const rec = { subject: String(node.subject || ''), name: String(node.name || '').trim() || '새 개념',
    x: Math.round(Number(node.x) || 200), y: Math.round(Number(node.y) || 200), desc: String(node.desc || '') };
  if (node.id && getById_('Concepts', node.id)) update_('Concepts', node.id, rec);
  else { rec.id = uid_('c_'); insert_('Concepts', rec); }
  return getConceptMap_(rec.subject, node.classId || '');
}
function deleteNode_(id, subject) {
  writeAll_('Concepts', rows_('Concepts').filter(function (c) { return c.id !== id; }));
  writeAll_('Links', rows_('Links').filter(function (l) { return l.from !== id && l.to !== id; }));
  return getConceptMap_(subject, '');
}
function savePositions_(list) {
  const all = rows_('Concepts');
  const m = {};
  (list || []).forEach(function (p) { m[p.id] = p; });
  all.forEach(function (c) { if (m[c.id]) { c.x = Math.round(m[c.id].x); c.y = Math.round(m[c.id].y); } });
  writeAll_('Concepts', all);
  return true;
}
function addLink_(subject, from, to) {
  if (from === to) return { links: cleanAll_(rows_('Links').filter(function (l) { return l.subject === subject; })) };
  const all = rows_('Links');
  const dup = all.some(function (l) { return (l.from === from && l.to === to) || (l.from === to && l.to === from); });
  if (!dup) insert_('Links', { id: uid_('e_'), subject: subject, from: from, to: to });
  return { links: cleanAll_(rows_('Links').filter(function (l) { return l.subject === subject; })) };
}
function deleteLink_(id, subject) {
  writeAll_('Links', rows_('Links').filter(function (l) { return l.id !== id; }));
  return { links: cleanAll_(rows_('Links').filter(function (l) { return l.subject === subject; })) };
}

/** 과목별 불러오기 – 테스트용 기본 개념 세트 */
const PRESETS = {
  phys_mech: { label: '물리 · 역학과 에너지',
    nodes: ['속도와 가속도', '힘', '뉴턴 운동 법칙', '마찰력', '운동량', '충격량', '일', '운동 에너지', '위치 에너지', '일-에너지 정리', '역학적 에너지 보존'],
    links: [[0, 2], [1, 2], [3, 2], [2, 4], [4, 5], [1, 6], [6, 7], [6, 8], [7, 9], [6, 9], [7, 10], [8, 10]] },
  phys_em: { label: '물리 · 전기와 자기',
    nodes: ['전하', '쿨롱 법칙', '전기장', '전위와 전위차', '전류', '저항', '옴의 법칙', '전력', '자기장', '전자기 유도'],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [4, 6], [6, 7], [4, 8], [8, 9]] },
  chem: { label: '화학 · 물질의 구성과 변화',
    nodes: ['원자 구조', '전자 배치', '주기율', '이온', '화학 결합', '분자 구조', '몰', '화학 반응식', '산과 염기', '산화와 환원'],
    links: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [6, 7], [7, 8], [7, 9], [3, 8]] },
  bio: { label: '생명과학 · 항상성과 몸의 기능',
    nodes: ['세포', '물질대사', '소화와 흡수', '호흡', '순환', '배설', '신경계', '호르몬', '항상성', '면역'],
    links: [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5], [6, 8], [7, 8], [8, 9]] },
  earth: { label: '지구과학 · 지구 시스템',
    nodes: ['지권의 구조', '판 구조론', '지진', '화산', '암석의 순환', '대기의 구조', '기압과 바람', '해수의 성질', '해류', '기후 변화'],
    links: [[0, 1], [1, 2], [1, 3], [3, 4], [5, 6], [7, 8], [6, 8], [8, 9], [5, 9]] },
  math_func: { label: '수학 · 함수와 미적분',
    nodes: ['함수의 정의', '일차함수', '이차함수', '그래프 해석', '지수함수', '로그함수', '삼각함수', '극한', '미분', '적분'],
    links: [[0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [0, 6], [3, 7], [7, 8], [8, 9]] }
};
function presets_() {
  return Object.keys(PRESETS).map(function (k) { return { key: k, label: PRESETS[k].label, count: PRESETS[k].nodes.length }; });
}
function loadPreset_(subject, key) {
  const p = PRESETS[key];
  if (!p) throw new Error('불러올 개념 세트를 선택해 주세요.');
  const exist = rows_('Concepts').filter(function (c) { return c.subject === subject; });
  const ids = [], add = [];
  p.nodes.forEach(function (name, i) {
    const hit = exist.filter(function (c) { return c.name === name; })[0];
    if (hit) { ids.push(hit.id); return; }
    const row = Math.floor(i / 4), col = i % 4;
    const c = { id: uid_('c_'), subject: subject, name: name,
      x: 170 + col * 260 + (row % 2) * 120, y: 130 + row * 190 + (col % 2) * 40, desc: '' };
    add.push(c); ids.push(c.id);
  });
  insertMany_('Concepts', add);
  const all = rows_('Links');
  const newL = [];
  p.links.forEach(function (e) {
    const a = ids[e[0]], b = ids[e[1]];
    const dup = all.concat(newL).some(function (l) { return (l.from === a && l.to === b) || (l.from === b && l.to === a); });
    if (!dup) newL.push({ id: uid_('e_'), subject: subject, from: a, to: b });
  });
  insertMany_('Links', newL);
  return getConceptMap_(subject, '');
}

/* =================================================================
 *  설정
 * ================================================================= */
function saveSettings_(s) {
  if (s.apiKey) PROPS.setProperty('OPENAI_KEY', String(s.apiKey).trim());
  if (s.clearKey) PROPS.deleteProperty('OPENAI_KEY');
  if (s.model) PROPS.setProperty('OPENAI_MODEL', String(s.model).trim());
  if (s.newPassword) {
    if (String(s.newPassword).length < 4) throw new Error('비밀번호는 4자 이상이어야 해요.');
    PROPS.setProperty('PASSWORD', hash_(String(s.newPassword)));
  }
  return { hasKey: !!PROPS.getProperty('OPENAI_KEY'), model: PROPS.getProperty('OPENAI_MODEL') || 'gpt-4o-mini' };
}
function saveSemester_(s) {
  if (!s.name || !/^\d{4}-\d{2}-\d{2}$/.test(s.start) || !/^\d{4}-\d{2}-\d{2}$/.test(s.end)) throw new Error('학기 이름과 시작/종료일을 입력해 주세요.');
  if (s.start > s.end) throw new Error('종료일이 시작일보다 빨라요.');
  const rec = { name: s.name, start: s.start, end: s.end };
  if (s.id) update_('Semesters', s.id, rec); else { rec.id = uid_('s_'); insert_('Semesters', rec); }
  return { semesters: cleanAll_(rows_('Semesters')), classes: classesMeta_() };
}
function deleteSemester_(id) {
  if (rows_('Classes').some(function (c) { return c.semesterId === id; })) throw new Error('이 학기에 클래스가 있어 삭제할 수 없어요.');
  writeAll_('Semesters', rows_('Semesters').filter(function (s) { return s.id !== id; }));
  return { semesters: cleanAll_(rows_('Semesters')) };
}
function saveHolidays_(text) {
  const list = [];
  String(text || '').split(/\r?\n/).forEach(function (l) {
    const m = l.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
    if (m) list.push({ date: m[1], name: m[2] || '휴일' });
  });
  writeAll_('Holidays', list);
  return { holidays: cleanAll_(rows_('Holidays')) };
}
