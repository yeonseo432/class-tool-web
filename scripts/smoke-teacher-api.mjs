#!/usr/bin/env node
/**
 * 교사 API 통합 시험 — 실행 중인 앱 + 실제 Supabase 대상
 *   npm run build && npx next start -p 3123   (다른 터미널)
 *   npm run smoke:teacher -- http://localhost:3123
 * 임시 교사 계정 2개를 만들고, 끝나면 계정·데이터·이미지를 모두 지워요.
 * 다루는 것: 기본 데이터 · 문제은행(선지별 오개념 여러 개 · 복수 정답) · 학생 명단 · 수업/차시 · 위젯 현황
 *           · 개념지도 · 오개념(이름 바꾸기/삭제 → 선지 동기화) · 형성평가 통계 · 출제 가이드 · 설정 · 교사 간 분리
 */
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const BASE = process.argv[2] || 'http://localhost:3123';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let pass = 0, failN = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✔ ' + msg); } else { failN++; console.log('  ✖ ' + msg); } };

/** @supabase/ssr 로 로그인해서 브라우저와 같은 쿠키를 만든다 */
async function login(email, password) {
  const jar = new Map();
  const sb = createServerClient(URL_, PUB, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
function client(cookie) {
  return async (fn, ...args) => {
    const r = await fetch(BASE + '/api/teacher', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ fn, args }),
    });
    const j = await r.json();
    if (!j.ok) { const e = new Error(j.error); e.status = r.status; e.code = j.code; throw e; }
    return j.data;
  };
}
const expectErr = async (p) => { try { await p; return null; } catch (e) { return e; } };

const stamp = Date.now();
const users = [];
async function mkUser(tag) {
  const email = `smoke-${tag}-${stamp}@class-tool.test`, password = 'Smoke-' + crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  return { id: data.user.id, api: client(await login(email, password)) };
}
const SEED = JSON.parse(readFileSync(new URL('../src/server/seed/physics-items.json', import.meta.url), 'utf8'));
const SAMPLE_N = SEED.questions.length;   // 기본 문항 세트 (scripts/sample-build.mjs 로 만든 파일)

async function main() {
  console.log('[인증]');
  const anonErr = await expectErr(client(null)('bootstrap'));
  ok(anonErr?.status === 401 && anonErr.code === 'AUTH', '로그인 없이 호출하면 401 AUTH');
  ok((await fetch(BASE + '/login')).status === 200, '/login 화면 열림');
  const r = await fetch(BASE + '/teacher', { redirect: 'manual' });
  ok(r.status === 307 && r.headers.get('location')?.includes('/login'), '/teacher 는 로그인 화면으로 이동');

  const A = await mkUser('a'), B = await mkUser('b');

  console.log('[bootstrap · 기본 데이터]');
  const b1 = await A.api('bootstrap');
  ok(b1.semesters.length === 2 && b1.holidays.length === 20, '기본 학기 2개 · 공휴일 20개');
  ok(b1.folders.length === SEED.folders.length && b1.questions.length === SAMPLE_N, `기본 문항 ${SAMPLE_N}개 (폴더 ${SEED.folders.length}개)`);
  ok(b1.questions.every((q) => !q.figure && Array.isArray(q.choiceImages) && q.choiceImages.length === q.choices.length), '그림 글 설명 없음 · 선지 그림 칸');
  ok(b1.questions.filter((q) => q.imageUrl.startsWith('/sample/')).length === SEED.questions.filter((q) => q.image).length, '상황 그림');
  ok(b1.questions.every((q) => q.choices.every((c, i) => c || q.choiceImages[i])), '빈 선지 없음 (그림 선지는 그림)');
  const imgs = [...new Set(b1.questions.flatMap((q) => [q.imageUrl, ...q.choiceImages]).filter(Boolean))];
  ok(imgs.every((u) => existsSync(new URL('../public' + u, import.meta.url))), `그림 파일 ${imgs.length}개 모두 있음`);
  ok(SEED.questions.filter((q) => q.choiceMis.some((a) => a.length)).length === b1.questions.filter((q) => q.choiceMis.some((a) => a.length)).length, '선지별 오개념 연결 = 기본 세트');
  ok(b1.questions.every((q) => !q.choices.some((c) => c.includes('직접 그리'))) && b1.questions.every((q) => !q.stem.includes('직접 그리')), "기본 문항에 '직접 그리기' 선지 · 안내 없음");
  ok(b1.questions.every((q) => Array.isArray(q.choiceMis) && q.choiceMis.length === q.choices.length && !('misIds' in q)), '문항: 선지별 오개념(choiceMis) · 문항 단위 오개념 없음');
  ok(b1.concepts.some((c) => c.kind === 'unit') && Array.isArray(b1.homerooms) && b1.homerooms.length === 0, '단원 노드 · 학생 명단(비어 있음)');
  ok(b1.appUrl === BASE && /^\d{4}-\d{2}-\d{2}$/.test(b1.today), 'appUrl · today');
  const b2 = await A.api('bootstrap');
  ok(b2.semesters.length === 2 && b2.questions.length === SAMPLE_N, '두 번째 bootstrap 에서 중복 생성 없음');

  console.log('[문제은행]');
  let bank = await A.api('createFolder', '1단원', '');
  const f1 = bank.folders.find((f) => f.name === '1단원');
  bank = await A.api('createFolder', '하위', f1.id);
  const f2 = bank.folders.find((f) => f.name === '하위');
  ok(f2.parentId === f1.id, '하위 폴더 생성');
  bank = await A.api('renameFolder', f1.id, '1단원(수정)');
  ok(bank.folders.some((f) => f.name === '1단원(수정)'), '폴더 이름 바꾸기');
  let ml = await A.api('saveMisconception', { subject: '열', name: '열은 물질이다', desc: '', conceptIds: [] });
  ml = await A.api('saveMisconception', { subject: '열', name: '온도가 같으면 열의 양도 같다', desc: '', conceptIds: [] });
  const mA = ml.find((m) => m.name === '열은 물질이다').id, mB = ml.find((m) => m.name.startsWith('온도가')).id;
  const sq = await A.api('saveQuestion', {
    title: '열전달', subject: '열', type: 'mc', stem: '열전달의 예는?', choices: ['전도', '대류', '복사', '증발'], answer: '1', explanation: '해설',
    choiceMis: [[mA], [mA, mB], [], [mB, 'm_없는id']], pendingMis: [[], [], ['열은 위로만 이동한다'], []], newConcepts: ['열전달', '전도'],
  }, f2.id);
  const q1 = sq.question;
  ok(q1.id.startsWith('q_') && q1.folderId === f2.id && q1.conceptIds.length === 2, '문제 저장 + 새 개념 2개 자동 생성');
  ok(q1.choiceMis[0].length === 0, '정답 선지의 오개념은 비움');
  ok(q1.choiceMis[1].join() === [mA, mB].join() && q1.choiceMis[3].join() === mB, '선지 하나에 오개념 여러 개 · 없는 id 는 버림');
  const added = sq.miscons.find((m) => m.name === '열은 위로만 이동한다');
  ok(added && q1.choiceMis[2].join() === added.id && added.conceptIds.length === 2, '목록에 없는 오개념(pending)은 문제의 개념에 추가하고 연결');
  ok(q1.choiceMisNames[1].join('|') === '열은 물질이다|온도가 같으면 열의 양도 같다', '선지별 오개념 이름도 저장 (학생 응답 기록용)');
  const sq2 = await A.api('saveQuestion', { ...q1, stem: '열전달의 예로 옳은 것은?' });
  ok(sq2.question.id === q1.id && sq2.question.stem.includes('옳은') && sq2.question.choiceMis[1].length === 2, '같은 문제 수정 (오개념 유지)');
  const sqm = await A.api('saveQuestion', { title: '두 개 고르기', subject: '열', type: 'mc', stem: '옳은 것을 모두 고르면?', choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], answer: '3|1', choiceMis: [[], [mA], [], [mB]] }, f2.id);
  const qm = sqm.question;
  ok(qm.answer === '3|1' || qm.answer === '1|3', '복수 정답 저장');
  bank = await A.api('copyItems', { folderIds: [f1.id] }, null);
  const copied = bank.questions.find((q) => q.title === '열전달' && q.id !== q1.id);
  ok(bank.folders.filter((f) => f.name.startsWith('1단원')).length === 2 && bank.questions.length === SAMPLE_N + 4 && copied?.choiceMis[1].length === 2, '폴더 복사(하위 폴더·문제 · 선지 오개념 포함)');
  const loopErr = await expectErr(A.api('moveItems', { folderIds: [f1.id] }, f2.id));
  ok(loopErr?.status === 400, '폴더를 자기 하위로 옮기기 차단');
  bank = await A.api('moveItems', { questionIds: [q1.id] }, '');
  ok(bank.questions.find((q) => q.id === q1.id).folderId === '', '문제를 최상위로 옮기기');
  const copyF = bank.folders.find((f) => f.name === '1단원(수정) (사본)');
  bank = await A.api('deleteItems', { folderIds: [copyF.id] });
  ok(bank.questions.length === SAMPLE_N + 2 && !bank.folders.some((f) => f.id === copyF.id), '폴더 삭제 시 하위 폴더·문제도 삭제');
  const fmt = await A.api('aiFormat', '1. 다음 중 벡터량은?\n① 질량 ② 속력 ③ 힘 ④ 시간\n정답: ①, ③\n해설: 힘은 크기와 방향', '물리');
  ok(fmt.question.type === 'mc' && fmt.question.choices.length === 4 && fmt.question.answer === '1|3', '직접 입력 문제 정리(규칙 기반) · 정답 여러 개');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const img = await A.api('uploadImage', png, 'a.png');
  ok(img.url.includes('/question-images/' + A.id + '/') && (await fetch(img.url)).status === 200, '이미지 업로드 · 공개 URL 열림');

  console.log('[학생 명단]');
  let hr = await A.api('saveHomeroom', { school: '시험고', grade: '2', className: '4' });
  const H = hr.id;
  ok(hr.homerooms.length === 1 && hr.homerooms[0].label === '시험고 2학년 4반' && /^\d{4}$/.test(hr.homerooms[0].code), '반 추가 (숫자만 쓰면 n반) · 학습코드 4자리');
  ok((await expectErr(A.api('saveHomeroom', { school: '시험고', grade: 2, className: '4반' })))?.status === 400, '같은 반 중복 차단');
  ok((await expectErr(A.api('saveHomeroom', { school: '시험고', grade: '이', className: 'A반' })))?.status === 400, '학년은 숫자만');
  const hrB = await A.api('saveHomeroom', { school: '시험고', grade: 2, className: 'B' });
  ok(hrB.homerooms.some((h) => h.className === 'B반'), '반 이름 직접 입력 (A반 · B반)');
  await A.api('deleteHomeroom', hrB.id);
  let ro = await A.api('addStudents', H, '1 20401 김민수\n20402\t이서연\n3번 20403 박지훈\n최유나 20404\n잘못된 줄');
  ok(ro.added === 4 && ro.skipped.length === 1, '붙여넣기: 4명 추가 · 읽지 못한 줄 1개');
  ok(ro.students.map((s) => s.studentNo).join() === '20401,20402,20403,20404' && ro.students.map((s) => s.number).join() === '1,2,3,4', '학번 저장 · 번호를 안 적으면 다음 번호');
  ok(ro.students.every((s) => /^\d{6}$/.test(s.initialPw) && !s.pwSet) && new Set(ro.students.map((s) => s.initialPw)).size === 4, '학생마다 다른 6자리 처음 비밀번호');
  ro = await A.api('addStudents', H, [{ studentNo: '20402', name: '이서윤' }]);
  ok(ro.updated === 1 && ro.students.find((s) => s.number === 2).name === '이서윤', '같은 학번은 이름만 바꿈');
  ok((await expectErr(A.api('updateStudent', ro.students[0].id, { studentNo: '20403' })))?.status === 400, '학번 중복 변경 차단');
  ok((await expectErr(A.api('updateStudent', ro.students[0].id, { number: 2 })))?.status === 400, '번호 중복 변경 차단');
  const kim = ro.students.find((s) => s.number === 1);
  ro = await A.api('resetStudentPassword', H, [kim.id]);
  ok(ro.students.find((s) => s.id === kim.id).initialPw !== kim.initialPw, '처음 비밀번호 새로 만들기');
  ro = await A.api('deleteStudents', H, [ro.students.find((s) => s.number === 4).id]);
  ok(ro.students.length === 3 && ro.homerooms[0].count === 3, '학생 삭제');

  console.log('[수업 · 차시]');
  const sem = b1.semesters.find((s) => s.name === '2026년 2학기');
  const cc = await A.api('createClass', { semesterId: sem.id, name: '2학년 4반', subject: '열', homeroomId: H,
    schedule: [{ day: 1, start: '09:00', end: '09:45' }, { day: 3, start: '10:00', end: '10:45' }, { day: 3, start: '10:00', end: '10:45' }] });
  ok(cc.lessonCount > 30 && cc.classes.length === 1, `클래스 생성 · 차시 ${cc.lessonCount}개 자동 생성 (중복 시간 제거)`);
  ok(cc.classes[0].homeroomId === H && cc.classes[0].homeroomLabel === '시험고 2학년 4반', '클래스에 학생 명단 연결');
  const dupErr = await expectErr(A.api('createClass', { semesterId: sem.id, name: '2학년 4반', subject: '열', schedule: [{ day: 1, start: '09:00', end: '09:45' }] }));
  ok(dupErr?.status === 400, '같은 클래스 중복 생성 차단');
  let gl = await A.api('getLessons', cc.classId);
  ok(gl.lessons.every((l, i) => l.no === i + 1) && !gl.lessons.some((l) => l.date === '2026-09-25'), '차시 번호 순서 · 공휴일(추석) 제외');
  gl = await A.api('addLesson', cc.classId, '2026-08-18', '13:00~13:45');
  ok(gl.lessons[0].date === '2026-08-18' && gl.lessons[0].no === 1 && gl.lessons.length === cc.lessonCount + 1, '차시 추가 후 번호 다시 매김');
  gl = await A.api('deleteLesson', gl.lessons[0].id);
  ok(gl.lessons.length === cc.lessonCount && gl.lessons[0].no === 1, '차시 삭제 후 번호 다시 매김');
  const L = gl.lessons[gl.lessons.length - 1];
  await A.api('setLessonQuestions', L.id, [q1.id, qm.id]);
  const ul = await A.api('updateLesson', L.id, { title: '마지막 수업' });
  ok(ul.title === '마지막 수업' && ul.questionIds.length === 2, '차시 제목 · 문제 구성 저장');
  ok((await A.api('getLessonDetail', L.id)).cls.id === cc.classId, '차시 상세');
  const up = await A.api('upcoming');
  ok(Array.isArray(up) && up.every((l) => l.className === '2학년 4반'), `다가오는 수업 ${up.length}개`);
  let uc = await A.api('updateClass', cc.classId, { intro: '소개', homeroomId: '' });
  ok(uc.classes[0].intro === '소개' && uc.classes[0].homeroomId === '', '클래스 수정 · 명단 연결 해제');
  uc = await A.api('updateClass', cc.classId, { homeroomId: H });
  ok(uc.classes[0].homeroomId === H && (await A.api('listClasses'))[0].homeroomLabel === '시험고 2학년 4반', '명단 다시 연결 · listClasses');

  console.log('[실시간 수업 (교사 쪽)]');
  let st = await A.api('startLive', L.id);
  ok(/^\d{4}$/.test(st.code) && st.total === 2 && st.phase === 'waiting' && st.hasRoster && st.rosterN === 3, '수업 시작 · 명단 3명');
  ok((await A.api('startLive', L.id)).channel === st.channel, '같은 차시를 다시 시작하면 같은 수업');
  st = await A.api('liveControl', st.code, 'open');
  ok(st.phase === 'open', '문제 출제하기');
  // 학생 제출은 smoke-live 에서 실제 학생 API 로 시험 — 여기서는 관리자 권한으로 직접 넣어 흉내냄
  const stu = (await A.api('getRoster', H)).students;
  const sess = (await admin.from('live_sessions').select('id, class_id').eq('code', st.code).neq('phase', 'ended').single()).data;
  ok(sess.class_id === cc.classId, '수업에 클래스 기록 (학생이 자기 반 수업을 찾는 데 사용)');
  const jr = await admin.from('live_joins').insert([{ session_id: sess.id, student_name: stu[0].id }, { session_id: sess.id, student_name: stu[1].id }]);
  const rr = await admin.from('responses').insert([
    { owner_id: A.id, lesson_id: L.id, session_id: sess.id, question_id: q1.id, student_key: stu[0].id, student_name: stu[0].name, answer: '1', correct: true, concept_ids: q1.conceptIds },
    { owner_id: A.id, lesson_id: L.id, session_id: sess.id, question_id: q1.id, student_key: stu[1].id, student_name: stu[1].name, answer: '2', correct: false, misconception: q1.choiceMisNames[1].join('\n'), concept_ids: q1.conceptIds },
  ]);
  if (jr.error || rr.error) throw new Error('시험용 학생 응답 저장 실패: ' + (jr.error || rr.error).message);
  const dupResp = await admin.from('responses').insert({ owner_id: A.id, lesson_id: L.id, session_id: sess.id, question_id: q1.id, student_key: stu[0].id, student_name: stu[0].name, answer: '3', correct: false });
  ok(dupResp.error?.code === '23505', '같은 학생 중복 제출은 DB가 차단');
  st = await A.api('liveStats', st.code);
  ok(st.joined === 2 && st.n === 2 && st.correctN === 1 && st.counts.join() === '1,1,0,0', '현황: 접속 2 · 제출 2 · 정답 1 · 선지 분포');
  ok(st.missing.length === 1 && st.missing[0].name === `${stu[2].number} ${stu[2].name}` && !st.missing[0].joined, '아직 안 낸 학생 (접속 안 함)');
  st = await A.api('liveControl', st.code, 'goto', 1);
  ok(st.idx === 1 && st.phase === 'waiting' && st.q.answer.includes('|'), '다음 문제로 (복수 정답 문항)');
  const end = await A.api('liveControl', st.code, 'end');
  ok(end.phase === 'ended', '수업 종료');
  ok((await A.api('getLessonDetail', L.id)).lesson.done !== '', '종료한 차시에 완료 날짜 기록');
  ok((await expectErr(A.api('liveStats', st.code)))?.status === 400, '종료한 수업은 더 이상 조회 안 됨');

  console.log('[개념지도 · 오개념]');
  let cm = await A.api('getConceptMap', '열', '');
  const heat = cm.nodes.find((n) => n.name === '열전달');
  ok(heat.stat.n === 2 && heat.stat.c === 1 && heat.stat.mis.length === 2, '개념별 정답률 · 오개념 집계 (선지 오개념 2개)');
  cm = await A.api('getConceptMap', '열', cc.classId);
  ok(cm.classes.length === 1 && cm.nodes.find((n) => n.name === '열전달').stat.n === 2, '반별 필터');
  cm = await A.api('saveNode', { subject: '열', name: '대류', x: 10, y: 20 });
  const conv = cm.nodes.find((n) => n.name === '대류');
  const lk = await A.api('addLink', '열', heat.id, conv.id);
  await A.api('addLink', '열', conv.id, heat.id);
  ok(lk.links.length === 1, '연결 추가 (역방향 중복 차단)');
  ok((await expectErr(A.api('addLink', '열', 'x),or(id.neq.0', conv.id)))?.status === 400, '이상한 id 로 필터 조작 차단');
  await A.api('savePositions', [{ id: conv.id, x: 300, y: 400 }]);
  cm = await A.api('getConceptMap', '열', '');
  ok(cm.nodes.find((n) => n.id === conv.id).x === 300, '노드 위치 저장');
  cm = await A.api('deleteNode', conv.id, '열');
  ok(cm.links.length === 0, '노드 삭제 시 연결선도 삭제');
  const ps = await A.api('presets');
  const before = cm.nodes.length;
  cm = await A.api('loadPreset', '열', ps[0].key);
  ok(cm.nodes.length === before + ps[0].count && cm.links.length >= 10, '과목별 개념 세트 불러오기');
  const im = await A.api('importMisconceptions', '열', '무거우면 빨리 떨어진다 | 설명 | 힘, 없는개념\n열은 물질이다 | 중복');
  ok(im.added === 1 && im.list.find((m) => m.name.startsWith('무거우면')).conceptIds.length === 1, '오개념 붙여넣기 (중복 · 없는 개념 제외)');
  ml = await A.api('saveMisconception', { ...im.list.find((m) => m.id === mA), conceptIds: [heat.id, cm.nodes.find((n) => n.name === '힘').id] });
  ok(ml.find((m) => m.id === mA).conceptIds.length === 2, '오개념을 다른 개념에도 넣기 (복제)');
  ml = await A.api('saveMisconception', { ...ml.find((m) => m.id === mA), name: '열은 물질이다 (고침)' });
  const q1db = (await admin.from('questions').select('misconceptions, choice_mis_ids').eq('id', q1.id).single()).data;
  ok(q1db.misconceptions[1].split('\n')[0] === '열은 물질이다 (고침)', '오개념 이름을 바꾸면 연결된 선지의 이름도 바뀜');
  ml = await A.api('deleteMisconception', mB, '열');
  const q1db2 = (await admin.from('questions').select('choice_mis_ids').eq('id', q1.id).single()).data;
  ok(!ml.some((m) => m.id === mB) && !q1db2.choice_mis_ids.join(',').includes(mB), '오개념을 지우면 선지에서도 빠짐');

  console.log('[형성평가 통계 · 출제 가이드]');
  const fs = await A.api('getFormativeStats', { subject: '열' });
  ok(fs.overview.responses === 2 && fs.hasRoster && fs.overview.roster === 3, '통계: 응답 2 · 명단 3명 연결');
  ok(fs.students.length === 3 && fs.students.every((s) => s.inRoster && s.no != null), '학생 통계에 명단(번호) · 응답 없는 학생 포함');
  ok(fs.miscons.some((m) => m.rate != null && m.expoResp === 2), '오개념 선택 비율 (노출 응답 기준)');
  for (const purpose of ['criterion', 'norm', 'diagnostic']) {
    const p = await A.api('recommendExam', { subject: '열', purpose, n: 12, total: 100, step: 0.5 });
    const sum = p.slots.reduce((a, s) => a + s.points, 0);
    ok(p.purpose === purpose && p.slots.length === 12 && Math.abs(sum - 100) < 1e-6 && !('distribution' in p) && p.design.principles.length >= 3,
      `출제 가이드(${p.purposeLabel}): 12문항 · 100점 · 설계 설명 · 점수 분포 없음`);
  }
  ok((await A.api('recommendExam', { subject: '열', purpose: 'grouping', n: 5 })).purpose === 'criterion', "없앤 목적(grouping)은 기본값(최소 성취기준)으로");

  console.log('[설정]');
  ok((await A.api('saveSettings', { model: 'gpt-4o' })).model === 'gpt-4o', 'AI 모델 저장');
  ok((await expectErr(A.api('saveSettings', { apiKey: 'sk-x' })))?.status === 400, 'API 키 입력은 환경변수 안내');
  ok((await A.api('saveSemester', { name: '2027년 1학기', start: '2027-03-02', end: '2027-07-16' })).semesters.length === 3, '학기 추가');
  ok((await expectErr(A.api('deleteSemester', sem.id)))?.status === 400, '클래스가 있는 학기 삭제 차단');
  const hd = await A.api('saveHolidays', '2026-01-01 신정\n2026-03-01\n잘못된 줄');
  ok(hd.holidays.length === 2 && hd.holidays[1].name === '휴일', '공휴일 전체 교체');

  console.log('[교사 간 데이터 분리]');
  const bb = await B.api('bootstrap');
  ok(bb.questions.length === SAMPLE_N && bb.classes.length === 0 && bb.homerooms.length === 0 && !bb.questions.some((q) => q.id === q1.id), 'B 에게 A 의 문제 · 클래스 · 명단이 안 보임');
  const hijack = await B.api('saveQuestion', { id: q1.id, title: '탈취', subject: '열', type: 'short', stem: 'x', answer: 'x' });
  ok(hijack.question.id !== q1.id, 'B 가 A 의 문제 id 로 저장해도 새 문제로 만들어짐');
  ok((await A.api('bootstrap')).questions.find((q) => q.id === q1.id)?.title === '열전달', 'A 의 문제는 그대로');
  ok((await expectErr(B.api('getLessons', cc.classId)))?.status === 400, 'B 는 A 의 클래스를 열 수 없음');
  ok((await B.api('getRoster', H)).students.length === 0, 'B 는 A 의 학생 명단을 볼 수 없음');
  ok((await expectErr(B.api('addStudents', H, '9 침입자')))?.status === 400, 'B 는 A 의 반에 학생을 넣을 수 없음');
  ok((await expectErr(B.api('createClass', { semesterId: bb.semesters[1].id, name: 'x', subject: '열', homeroomId: H, schedule: [{ day: 1, start: '09:00', end: '09:45' }] })))?.status === 400, 'B 는 A 의 명단을 클래스에 연결할 수 없음');
  await B.api('deleteClass', cc.classId);
  ok((await A.api('getLessons', cc.classId)).lessons.length === cc.lessonCount, 'B 가 A 의 클래스를 지워도 지워지지 않음');
  ok((await expectErr(B.api('uploadImage', 'data:text/html;base64,PGgxPg==')))?.status === 400, '이미지가 아닌 파일 업로드 차단');

  console.log('[삭제 연쇄]');
  await A.api('deleteHomeroom', H);
  ok((await A.api('listClasses'))[0].homeroomId === '', '반 삭제 시 클래스는 명단 연결만 풀림');
  ok(((await admin.from('students').select('id', { count: 'exact', head: true }).eq('homeroom_id', H)).count ?? 0) === 0, '반 삭제 시 학생도 삭제');
  await A.api('deleteClass', cc.classId);
  const left = await admin.from('responses').select('id', { count: 'exact', head: true }).eq('owner_id', A.id);
  ok(left.count === 0, '클래스 삭제 시 차시 · 응답도 삭제');
}

async function cleanup() {
  for (const id of users) {
    const { data } = await admin.storage.from('question-images').list(id);
    if (data?.length) await admin.storage.from('question-images').remove(data.map((f) => `${id}/${f.name}`));
    await admin.auth.admin.deleteUser(id);   // 교사 데이터는 on delete cascade 로 함께 삭제
  }
}

try {
  await main();
} catch (e) {
  failN++;
  console.error('\n✖ 예외:', e.message, e.status ?? '');
} finally {
  await cleanup();
  console.log(`\n결과: ${pass}개 통과, ${failN}개 실패 (시험 계정 ${users.length}개 정리함)`);
  process.exit(failN ? 1 : 0);
}
