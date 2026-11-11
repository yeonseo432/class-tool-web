#!/usr/bin/env node
/**
 * 실시간 수업 통합 시험 (교사 위젯 API + 학생 API + Realtime 신호) — 실행 중인 앱 + 실제 Supabase
 *   npm run build && npx next start -p 3123   (다른 터미널)
 *   npm run smoke:live -- http://localhost:3123
 * 임시 교사 계정을 만들고 끝나면 계정 · 데이터를 지워요.
 * 다루는 것: 학생 명단 로그인(처음 비밀번호 → 자기 비밀번호) · 사칭 방지(다른 기기 로그인 시 이전 기기 로그아웃)
 *           · 빈 화면 → 문제 출제 → 제출 후 고른 답 · 정답 → 마감 · 복수 정답 · Realtime 신호
 */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const BASE = process.argv[2] || 'http://localhost:3123';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_, PUB, { auth: { persistSession: false } });

let pass = 0, failN = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✔ ' + msg); } else { failN++; console.log('  ✖ ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errOf = async (p) => { try { await p; return null; } catch (e) { return e; } };

async function post(path, fn, args, cookie) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ fn, args }),
  });
  const j = await r.json();
  if (!j.ok) { const e = new Error(j.error); e.status = r.status; e.code = j.code; throw e; }
  return { data: j.data, setCookie: r.headers.get('set-cookie') };
}
/** 학생 한 명의 브라우저 (로그인 쿠키를 들고 다님) */
function device() {
  let cookie = '';
  const call = async (fn, ...args) => {
    try {
      const r = await post('/api/student', fn, args, cookie);
      if (r.setCookie) cookie = /qc_student=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(r.setCookie) ? '' : r.setCookie.split(';')[0];
      return r.data;
    } catch (e) {
      if (e.status === 401) cookie = '';   // 서버가 쿠키를 지움
      throw e;
    }
  };
  return { call, get loggedIn() { return !!cookie; } };
}

/** 채널에 들어온 신호를 모아 두는 수신기 */
async function listen(channel) {
  const got = [];
  const ch = anon.channel('live-' + channel).on('broadcast', { event: 'changed' }, (m) => got.push(m.payload.kind));
  await new Promise((res, rej) => {
    ch.subscribe((s) => s === 'SUBSCRIBED' && res());
    setTimeout(() => rej(new Error('구독 시간 초과')), 10000);
  });
  return {
    async waitFor(kind, ms = 5000) {
      for (let t = 0; t < ms; t += 100) { if (got.includes(kind)) return true; await sleep(100); }
      return false;
    },
    clear() { got.length = 0; },
  };
}

let userId = null;
async function main() {
  console.log('[화면]');
  ok((await fetch(BASE + '/student')).status === 200, '/student 화면 열림 (교사 로그인 없이)');
  const w = await fetch(BASE + '/teacher/widget?lesson=x', { redirect: 'manual' });
  ok(w.status === 307 && w.headers.get('location').includes('/login'), '/teacher/widget 은 교사 로그인 필요');

  // 임시 교사 + 학생 명단 + 클래스 + 문제 2개(단일 정답 · 복수 정답)를 담은 차시
  const email = `smoke-live-${Date.now()}@class-tool.test`, password = 'Smoke-' + crypto.randomUUID();
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = u.user.id;
  const jar = new Map();
  const ssr = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) } });
  await ssr.auth.signInWithPassword({ email, password });
  const tcookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const T = async (fn, ...args) => (await post('/api/teacher', fn, args, tcookie)).data;

  const b = await T('bootstrap');
  const sem = b.semesters.find((s) => s.name.includes('2학기'));
  // 다른 시험 데이터와 섞이지 않도록 드문 학년 · 학번으로 (학생은 반의 학습코드 + 학번 + 비밀번호로 로그인)
  const G = 12, C = 90 + Math.floor(Math.random() * 9);
  const sno = (n) => `${C}${String(n).padStart(3, '0')}`;
  const hr = await T('saveHomeroom', { school: '시험고', grade: G, className: `시험${C}반` });
  const K = hr.homerooms.find((h) => h.id === hr.id).code;
  let ro = await T('addStudents', hr.id, `1 ${sno(1)} 김민수\n2 ${sno(2)} 이서연\n3 ${sno(3)} 박지훈`);
  const code = (no) => ro.students.find((s) => s.number === no).initialPw;
  const ml = await T('saveMisconception', { subject: '물리', name: '운동 방향으로 힘이 있다', desc: '', conceptIds: [] });
  const mis = ml.find((m) => m.name === '운동 방향으로 힘이 있다');
  const q1 = (await T('saveQuestion', { title: '던진 공', subject: '물리', type: 'mc', stem: '공에 작용하는 힘은?', choices: ['중력만', '위 방향 힘만', '위 + 중력', '없음'], answer: '1', explanation: '중력만 작용', choiceMis: [[], [mis.id], [mis.id], []] }, '')).question;
  const q2 = (await T('saveQuestion', { title: '두 개', subject: '물리', type: 'mc', stem: '옳은 것을 모두 고르면?', choices: ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'], answer: '1|3', choiceMis: [[], [mis.id], [], []] }, '')).question;
  const q3 = (await T('saveQuestion', { title: '단답', subject: '물리', type: 'short', stem: '중력 가속도는? (단위 생략)', answer: '9.8|10' }, '')).question;
  const cc = await T('createClass', { semesterId: sem.id, name: '시험반', subject: '물리', homeroomId: hr.id, schedule: [{ day: 1, start: '09:00', end: '09:45' }] });
  const L = (await T('getLessons', cc.classId)).lessons.at(-1);
  await T('setLessonQuestions', L.id, [q1.id, q2.id, q3.id]);

  console.log('[학생 로그인]');
  const s1 = device(), s2 = device(), s3 = device();
  ok((await errOf(s1.call('studentLogin', K, sno(9), '000000')))?.status === 403, '명단에 없는 학번은 못 들어옴');
  ok((await errOf(s1.call('studentLogin', K === '0000' ? '0001' : '0000', sno(1), code(1))))?.status === 403, '학습코드가 틀리면 못 들어옴');
  ok((await errOf(s1.call('studentLogin', K, sno(1), '0000')))?.status === 400, '0000 같은 공통 비밀번호로는 못 들어옴');
  ok((await errOf(s1.call('studentLogin', K, sno(1), code(2))))?.status === 400, '다른 학생의 처음 비밀번호로는 못 들어옴');
  const first = await s1.call('studentLogin', K, sno(1), code(1));
  ok(first.needNewPassword === true && !s1.loggedIn, '처음 비밀번호 → 자기 비밀번호를 정해야 함 (아직 로그인 안 됨)');
  ok((await errOf(s1.call('studentLogin', K, sno(1), code(1), '1234')))?.status === 400, '너무 쉬운 비밀번호 거절');
  const p1 = await s1.call('studentLogin', K, sno(1), code(1), 'minsu!77');
  ok(p1.needNewPassword === false && p1.name === '김민수' && p1.studentNo === sno(1) && s1.loggedIn, '자기 비밀번호를 정하고 로그인');
  ok((await errOf(device().call('studentLogin', K, sno(1), code(1))))?.status === 400, '한 번 쓴 처음 비밀번호는 다시 못 씀');
  ok((await s1.call('studentMe')).name === '김민수', '로그인 유지 (쿠키)');
  await s2.call('studentLogin', K, sno(2), code(2), 'seoyeon#5');
  await s3.call('studentLogin', K, sno(3), code(3), 'jihoon$31');

  console.log('[사칭 방지: 다른 기기에서 로그인]');
  const spy = device();
  await spy.call('studentLogin', K, sno(2), 'seoyeon#5');   // 비밀번호를 아는 사람이 다른 기기에서 로그인했다고 가정
  const kicked = await errOf(s2.call('studentState'));
  ok(kicked?.status === 401 && kicked.code === 'AUTH' && kicked.message.includes('다른 기기') && !s2.loggedIn, '먼저 쓰던 기기는 로그아웃 + 안내');
  await s2.call('studentLogin', K, sno(2), 'seoyeon#5');
  ok((await errOf(spy.call('studentState')))?.status === 401, '본인이 다시 로그인하면 사칭한 기기가 로그아웃');
  await s2.call('studentPassword', 'seoyeon#5', 'seoyeon#new');
  ok((await errOf(spy.call('studentLogin', K, sno(2), 'seoyeon#5')))?.status === 400, '비밀번호를 바꾸면 옛 비밀번호로 못 들어옴');

  console.log('[수업]');
  let v = await s1.call('studentState');
  ok(v.view === 'idle' && v.channel === null, '수업 전: 빈 화면');
  let st = await T('startLive', L.id);
  ok(st.hasRoster && st.rosterN === 3 && st.total === 3, `수업 시작 · 명단 3명`);
  const rx = await listen(st.channel);
  v = await s1.call('studentState');
  ok(v.view === 'idle' && v.channel === st.channel, '수업은 열렸지만 문제 전: 빈 화면');
  ok(await rx.waitFor('join'), '접속 신호(join) 도착');
  await s2.call('studentState');
  ok((await T('liveStats', st.code)).joined === 2, '위젯: 접속 2명');
  ok((await errOf(s1.call('studentSubmit', q1.id, '1')))?.status === 400, '문제 내기 전에는 제출 불가');
  rx.clear();
  await T('liveControl', st.code, 'open');
  ok(await rx.waitFor('phase'), '교사 조작 신호(phase) 도착');
  v = await s1.call('studentState');
  ok(v.view === 'question' && v.question.id === q1.id && v.question.need === 1 && v.question.choices.length === 4, '문제 출제 → 문제 표시 (답 1개)');
  ok(v.question.answer === undefined && v.question.explanation === undefined, '정답 · 해설은 보내지 않음');
  ok((await errOf(s1.call('studentSubmit', q2.id, '1')))?.status === 400, '다른 문제 id 로 제출 차단');
  ok((await errOf(s1.call('studentSubmit', q1.id, '9')))?.status === 400, '없는 보기 번호 차단');
  ok((await errOf(s1.call('studentSubmit', q1.id, '1|2')))?.status === 400, '골라야 할 개수보다 많으면 차단');
  rx.clear();
  await s1.call('studentSubmit', q1.id, '3');
  ok(await rx.waitFor('response'), '제출 신호(response) 도착');
  v = await s1.call('studentState');
  ok(v.view === 'result' && v.result.answer === '3' && v.result.correctAnswer === '1' && v.result.correct === false && v.result.explanation === undefined, '제출 후: 고른 답 · 정답 (해설 없음)');
  ok((await errOf(s1.call('studentSubmit', q1.id, '1')))?.message === '이미 제출했어요.', '같은 학생 두 번 제출 차단');
  await s2.call('studentSubmit', q1.id, '1');
  st = await T('liveStats', st.code);
  ok(st.n === 2 && st.correctN === 1 && st.counts.join() === '1,0,1,0' && st.missing.length === 1 && st.missing[0].name.endsWith('박지훈'), '위젯: 제출 2 · 정답 1 · 분포 · 안 낸 학생');
  await T('liveControl', st.code, 'close');
  ok((await s1.call('studentState')).view === 'idle', '제출 마감 → 빈 화면');
  ok((await errOf(s3.call('studentSubmit', q1.id, '1')))?.status === 400, '마감 후 제출 불가');
  await T('liveControl', st.code, 'reveal');
  ok((await s1.call('studentState')).view === 'idle', '정답 공개(교사 화면용)에도 학생은 빈 화면');

  console.log('[복수 정답]');
  await T('liveControl', st.code, 'goto', 1);
  await T('liveControl', st.code, 'open');
  v = await s2.call('studentState');
  ok(v.view === 'question' && v.question.need === 2, '정답 2개 문항: 2개 골라야 함');
  ok((await errOf(s2.call('studentSubmit', q2.id, '1')))?.message?.includes('2개'), '1개만 고르면 제출 불가');
  await s2.call('studentSubmit', q2.id, '3|1');
  await s1.call('studentSubmit', q2.id, '1|2');
  v = await s2.call('studentState');
  ok(v.result.correct === true && v.result.answer === '1|3', '둘 다 맞혀야 정답');
  ok((await s1.call('studentState')).result.correct === false, '하나라도 틀리면 오답');
  st = await T('liveStats', st.code);
  ok(st.counts.join() === '2,1,1,0', '위젯: 고른 보기마다 집계');

  console.log('[단답형]');
  await T('liveControl', st.code, 'goto', 2);
  await T('liveControl', st.code, 'open');
  await s1.call('studentSubmit', q3.id, ' 9.8 ');
  await s2.call('studentSubmit', q3.id, '9');
  st = await T('liveStats', st.code);
  ok(st.correctN === 1 && st.shorts.find((x) => x.text === '9.8')?.c === true, '단답형: 허용 답안 정답 처리 · 답별 집계');

  console.log('[응답 저장 · 통계 연결]');
  const { data: rows } = await admin.from('responses').select('owner_id, lesson_id, student_key, answer, correct, misconception').eq('session_id', st.channel);
  ok(rows.length === 6 && rows.every((r) => r.owner_id === userId && r.lesson_id === L.id && r.student_key.startsWith('st_')), '응답 6개가 교사 · 차시 · 학생 id 에 연결되어 저장');
  ok(rows.find((r) => r.answer === '3' && !r.correct)?.misconception === mis.name, '오답 선지의 오개념 기록');
  const fs = await T('getFormativeStats', { subject: '물리', classId: cc.classId });
  ok(fs.students.length === 3 && fs.students.find((s) => s.name === '박지훈').n === 0, '형성평가 학생 통계: 명단 3명 (응답 없는 학생 포함)');

  console.log('[선생님이 비밀번호를 새로 만들면]');
  ro = await T('resetStudentPassword', hr.id, [ro.students.find((s) => s.number === 3).id]);
  const kicked3 = await errOf(s3.call('studentState'));
  ok(kicked3?.status === 401 && kicked3.message.includes('선생님이 비밀번호를 새로'), '그 학생은 로그아웃 + 안내');
  ok((await errOf(s3.call('studentLogin', K, sno(3), 'jihoon$31')))?.status === 400, '옛 비밀번호 무효');
  ok((await s3.call('studentLogin', K, sno(3), code(3))).needNewPassword === true, '새 처음 비밀번호로 다시 시작');

  console.log('[종료]');
  rx.clear();
  const oldChannel = st.channel;
  await T('liveControl', st.code, 'end');
  ok(await rx.waitFor('phase'), '종료 신호 도착');
  v = await s1.call('studentState');
  ok(v.view === 'idle' && v.channel === null, '학생 화면: 다시 빈 화면 (진행 중인 수업 없음)');
  st = await T('startLive', L.id);
  ok(st.channel !== oldChannel && st.n === 0, '같은 차시를 다시 시작하면 새 수업 (이전 응답과 분리)');
  await T('liveControl', st.code, 'end');
  await s1.call('studentLogout');
  ok(!s1.loggedIn && (await s1.call('studentMe')) === null, '로그아웃');
  ok((await errOf(s1.call('nope')))?.status === 400, '알 수 없는 학생 기능 차단');
}

try {
  await main();
} catch (e) {
  failN++;
  console.error('\n✖ 예외:', e.message, e.status ?? '');
} finally {
  await anon.removeAllChannels();
  if (userId) await admin.auth.admin.deleteUser(userId);
  console.log(`\n결과: ${pass}개 통과, ${failN}개 실패 (시험 계정 정리함)`);
  process.exit(failN ? 1 : 0);
}
