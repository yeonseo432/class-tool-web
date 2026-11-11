#!/usr/bin/env node
/**
 * 시연용 고교학점제 수업반 A반 · B반 (각 30명) + 형성평가 응답 만들기
 *   node --env-file=.env.local scripts/demo-ab-classes.mjs --email 교사@이메일 [--dry-run]
 *
 * 먼저 supabase/migrations/20261120000000_class_name_code_student_no.sql 이 적용돼 있어야 해요 (반 이름 · 학습코드 · 학번).
 * 그 교사 계정에서 응답이 가장 많은 '학생 명단이 연결된 클래스'를 A반으로 써요.
 *   1. 그 반 이름 → 'A반', 클래스 이름 → '<학년>학년 A반'. 학생을 30명까지 채우고(학번 포함), 학번 없는 학생은 학년·반·번호로 학번을 채움
 *   2. 같은 학교 · 학년에 'B반' 명단 30명 + 클래스 '<학년>학년 B반'(A반 차시를 이틀 뒤 같은 문항으로) 만들기
 *   3. A반에서 이미 진행한 차시마다, 응답이 없는 A반 학생 · B반 학생의 응답을 A반 응답 분포를 바탕으로 만들기
 * 여러 번 돌려도 이미 있는 학생 · 클래스 · 응답은 다시 만들지 않아요.
 */
import { createClient } from '@supabase/supabase-js';
import { randomInt, randomUUID } from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const EMAIL = arg('email'), DRY = process.argv.includes('--dry-run');
if (!EMAIL) { console.error('사용법: node --env-file=.env.local scripts/demo-ab-classes.mjs --email 교사@이메일 [--dry-run]'); process.exit(1); }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; };
const uid = (p) => p + randomUUID().replace(/-/g, '').slice(0, 10);
const pin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const SIZE = 30, DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const write = async (what, fn) => { if (DRY) { console.log('  (dry-run) ' + what); return null; } return must(await fn(), what); };

/* 같은 결과가 나오도록 고정 시드 난수 */
let seed = 20261111;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const normal = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const FAM = '김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명'.split('');
const GIV = ['민준', '서연', '도윤', '하은', '시우', '지유', '하준', '서아', '은우', '지호', '수아', '유준', '지안', '예준', '하린', '건우', '채원', '우진', '다은', '현우',
  '소윤', '민재', '지원', '태윤', '수빈', '서준', '윤서', '주원', '예린', '도현', '지민', '서윤', '이준', '하윤', '준서', '나은', '시윤', '연우', '아린', '지훈',
  '유나', '승우', '예은', '정우', '가은', '민성', '서현', '재윤', '채은', '선우', '다인', '로운', '수현', '태민', '하율', '은서', '준혁', '소율', '지성', '라온'];

try {
  /* 0. 계정 · A반 */
  let owner = null;
  for (let page = 1; !owner; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (r.error) throw r.error;
    owner = r.data.users.find((u) => (u.email ?? '').toLowerCase() === EMAIL.toLowerCase())?.id ?? null;
    if (r.data.users.length < 1000) break;
  }
  if (!owner) throw new Error(`${EMAIL} 계정을 찾지 못했어요.`);
  const classes = must(await admin.from('classes').select('*').eq('owner_id', owner).not('homeroom_id', 'is', null), '클래스');
  const resp = must(await admin.from('responses').select('lesson_id, question_id, student_key, answer, correct').eq('owner_id', owner).limit(20000), '응답');
  const lessons = must(await admin.from('lessons').select('*').eq('owner_id', owner).limit(5000), '차시');
  const lessonCls = new Map(lessons.map((l) => [l.id, l.class_id]));
  const nResp = (cid) => resp.filter((r) => lessonCls.get(r.lesson_id) === cid).length;
  const clsA = classes.filter((c) => !/B반$/.test(c.name)).sort((a, b) => nResp(b.id) - nResp(a.id))[0];
  if (!clsA || !nResp(clsA.id)) throw new Error('응답이 있는, 학생 명단이 연결된 클래스가 없어요.');
  const hrA = must(await admin.from('homerooms').select('*').eq('id', clsA.homeroom_id).single(), 'A반');
  if (!('class_name' in hrA)) throw new Error('마이그레이션(20261120000000)을 먼저 적용해 주세요.');
  console.log(`A반: ${hrA.school} ${hrA.grade}학년 ${hrA.class_name} → A반 · 클래스 '${clsA.name}' (응답 ${nResp(clsA.id)}개)`);

  /* 1. A반 */
  const nameA = `${hrA.grade}학년 A반`;
  if (hrA.class_name !== 'A반') await write('A반 이름', () => admin.from('homerooms').update({ class_name: 'A반' }).eq('id', hrA.id));
  if (clsA.name !== nameA) await write('A반 클래스 이름', () => admin.from('classes').update({ name: nameA }).eq('id', clsA.id));
  const allStu = must(await admin.from('students').select('id, homeroom_id, number, name, student_no').eq('owner_id', owner), '학생');
  const usedNames = new Set(allStu.map((s) => s.name)), usedNos = new Set(allStu.map((s) => s.student_no).filter(Boolean));
  const newName = () => { let n; do n = pick(FAM) + pick(GIV); while (usedNames.has(n)); usedNames.add(n); return n; };
  /** 학번: 학년 + 학급(cls) + 번호 — 고교학점제 수업반은 여러 학급 학생이 섞여 있어요 */
  const newNo = (classes_) => { let n; do n = String(hrA.grade * 10000 + pick(classes_) * 100 + 1 + Math.floor(rnd() * 30)); while (usedNos.has(n)); usedNos.add(n); return n; };
  let stuA = allStu.filter((s) => s.homeroom_id === hrA.id).sort((a, b) => a.number - b.number);
  for (const s of stuA.filter((x) => !x.student_no)) {
    const no = String(hrA.grade * 10000 + (hrA.class_no ?? 3) * 100 + s.number);
    usedNos.add(no);
    await write(`학번 ${s.name} ${no}`, () => admin.from('students').update({ student_no: no }).eq('id', s.id));
    s.student_no = no;
  }
  const addA = [];
  for (let n = Math.max(0, ...stuA.map((s) => s.number)) + 1; stuA.length + addA.length < SIZE; n++) {
    addA.push({ id: uid('st_'), owner_id: owner, homeroom_id: hrA.id, number: n, name: newName(), student_no: newNo([1, 4, 6]), initial_pw: pin() });
  }
  if (addA.length) await write(`A반 학생 ${addA.length}명 추가`, () => admin.from('students').insert(addA));
  stuA = [...stuA, ...addA];

  /* 2. B반 명단 · 클래스 · 차시 */
  let hrB = must(await admin.from('homerooms').select('*').eq('owner_id', owner).eq('year', hrA.year).eq('school', hrA.school)
    .eq('grade', hrA.grade).eq('class_name', 'B반'), 'B반').at(0);
  if (!hrB) {
    hrB = { id: uid('h_'), owner_id: owner, year: hrA.year, school: hrA.school, grade: hrA.grade, class_name: 'B반' };
    const r = await write('B반 명단 만들기', () => admin.from('homerooms').insert(hrB).select('*'));
    if (r) hrB = r[0];
  }
  let stuB = allStu.filter((s) => s.homeroom_id === hrB.id);
  const addB = [];
  for (let n = Math.max(0, ...stuB.map((s) => s.number)) + 1; stuB.length + addB.length < SIZE; n++) {
    addB.push({ id: uid('st_'), owner_id: owner, homeroom_id: hrB.id, number: n, name: newName(), student_no: newNo([1, 2, 5, 7]), initial_pw: pin() });
  }
  // B반은 학번 순으로 번호를 매김
  addB.sort((a, b) => a.student_no.localeCompare(b.student_no)).forEach((s, i) => { s.number = Math.max(0, ...stuB.map((x) => x.number)) + i + 1; });
  if (addB.length) await write(`B반 학생 ${addB.length}명 추가`, () => admin.from('students').insert(addB));
  stuB = [...stuB, ...addB];

  const nameB = `${hrA.grade}학년 B반`;
  let clsB = must(await admin.from('classes').select('*').eq('owner_id', owner).eq('semester_id', clsA.semester_id).eq('name', nameB), 'B반 클래스').at(0);
  const shift = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
  const lessonsA = lessons.filter((l) => l.class_id === clsA.id).sort((a, b) => a.no - b.no);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  let lessonsB = [];
  if (!clsB) {
    const schedule = (clsA.schedule ?? []).map((s) => ({ ...s, day: (Number(s.day) + 2) % 7 }));
    clsB = { id: uid('k_'), owner_id: owner, semester_id: clsA.semester_id, name: nameB, subject: clsA.subject, schedule, intro: clsA.intro ?? '', homeroom_id: hrB.id };
    await write('B반 클래스 만들기', () => admin.from('classes').insert(clsB));
    lessonsB = lessonsA.map((l) => {
      const date = shift(l.date, 2);
      return { id: uid('l_'), owner_id: owner, class_id: clsB.id, no: l.no, date, day: DAYS[new Date(date + 'T00:00:00Z').getUTCDay()], time: l.time,
        title: l.title, question_ids: l.question_ids, done: l.done && date <= today ? date : null };
    });
    await write(`B반 차시 ${lessonsB.length}개`, () => admin.from('lessons').insert(lessonsB));
  } else {
    lessonsB = lessons.filter((l) => l.class_id === clsB.id);
  }

  /* 3. 응답 (A반 응답 분포를 바탕으로) */
  const qids = [...new Set(lessonsA.flatMap((l) => l.question_ids))];
  const qs = qids.length ? must(await admin.from('questions').select('id, answer, choices, misconceptions, concept_ids').in('id', qids), '문항') : [];
  const qBy = new Map(qs.map((q) => [q.id, q]));
  const have = new Set(resp.map((r) => `${r.lesson_id}|${r.question_id}|${r.student_key}`));
  const ability = new Map();
  const theta = (s, shiftMean) => { if (!ability.has(s.id)) ability.set(s.id, shiftMean + normal()); return ability.get(s.id); };
  const logit = (p) => Math.log(p / (1 - p)), sig = (x) => 1 / (1 + Math.exp(-x));
  const rows = [];
  const gen = (lessonA, lessonId, date, startUtcH, students, shiftMean) => {
    lessonA.question_ids.forEach((qid, qi) => {
      const q = qBy.get(qid);
      if (!q) return;
      const base = resp.filter((r) => r.lesson_id === lessonA.id && r.question_id === qid);
      const pA = Math.min(0.93, Math.max(0.12, base.length ? base.filter((r) => r.correct).length / base.length : 0.5));
      const right = String(q.answer).split('|').map(Number);
      const wrongW = q.choices.map((_, i) => (right.includes(i + 1) ? 0 : base.filter((r) => r.answer === String(i + 1)).length + 0.7));
      students.forEach((s) => {
        if (have.has(`${lessonId}|${qid}|${s.id}`)) return;
        if (rnd() < 0.06) return;   // 결석 · 미제출
        const ok = rnd() < sig(logit(pA) + 1.3 * theta(s, shiftMean));
        let answer = q.answer, mis = '';
        if (!ok) {
          if (rnd() < 0.05) answer = '0';   // 모르겠어요
          else {
            let t = rnd() * wrongW.reduce((a, b) => a + b, 0), no = 0;
            while (no < wrongW.length - 1 && (t -= wrongW[no]) > 0) no++;
            while (right.includes(no + 1)) no = (no + 1) % q.choices.length;
            answer = String(no + 1);
            mis = String((q.misconceptions ?? [])[no] ?? '');
          }
        }
        const at = new Date(`${date}T00:00:00Z`);
        at.setUTCHours(startUtcH, 4 + qi * 7 + Math.floor(rnd() * 5), Math.floor(rnd() * 60));
        rows.push({ owner_id: owner, lesson_id: lessonId, session_id: null, question_id: qid, student_key: s.id, student_name: s.name,
          answer, correct: ok, misconception: mis, concept_ids: q.concept_ids ?? [], created_at: at.toISOString() });
      });
    });
  };
  const doneA = lessonsA.filter((l) => l.done && l.question_ids.length);
  for (const l of doneA) {
    gen(l, l.id, l.date, 0, stuA, 0);
    const lb = lessonsB.find((x) => x.no === l.no);
    if (lb && lb.date <= today) gen(l, lb.id, lb.date, 1, stuB, -0.2);
  }
  console.log(`응답 ${rows.length}개 만들기 (A반 진행한 차시 ${doneA.length}개 기준)`);
  for (let i = 0; i < rows.length; i += 500) await write(`응답 ${i + 1}~${Math.min(rows.length, i + 500)}`, () => admin.from('responses').insert(rows.slice(i, i + 500)));

  const codes = must(await admin.from('homerooms').select('class_name, code').in('id', [hrA.id, hrB.id]), '학습코드');
  console.log('✔ 끝났어요.', codes.map((c) => `${c.class_name} 학습코드 ${c.code}`).join(' · '));
} catch (e) {
  console.error('✖', e.message);
  process.exit(1);
}
