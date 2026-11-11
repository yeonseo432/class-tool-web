#!/usr/bin/env node
/**
 * 내 컴퓨터에서만 돌려 보기 (운영 DB · 배포와 완전히 분리)
 *   Docker Desktop 이 켜져 있어야 해요.
 *
 *   npm run local:up      로컬 Supabase(DB · 로그인 · 실시간 · 저장소)를 켜고, 모든 마이그레이션을 적용하고,
 *                         .env.development.local 을 만들어요 → 이 파일이 있으면 `npm run dev` 가 로컬 DB 를 써요.
 *   npm run local:demo    시험용 교사 계정 · 학생 명단 · 클래스 · 오늘 차시를 만들어 바로 써 볼 수 있게 해요.
 *   npm run local:reset   로컬 DB 를 비우고 마이그레이션부터 다시 (데이터 전부 삭제)
 *   npm run local:down    로컬 Supabase 를 끄고 .env.development.local 을 지워요 → `npm run dev` 가 다시 운영 DB 를 써요.
 *
 * 운영 DB(.env.local)는 건드리지 않아요. Next.js 는 개발 모드에서 .env.development.local 을 .env.local 보다 먼저 읽어요.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env.development.local');
const MARK = '# local-supabase (scripts/local.mjs 가 만든 파일 — npm run local:down 으로 지워져요)';
const require = createRequire(import.meta.url);

function cli(args, capture = false) {
  let bin;
  try { bin = require.resolve('supabase/dist/supabase.js', { paths: [ROOT] }); } catch {
    console.error('Supabase CLI 가 없어요. 먼저 `npm install` 을 해 주세요.'); process.exit(1);
  }
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: ROOT, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`\n✖ supabase ${args.join(' ')} 실패.` + (args[0] === 'start' ? ' Docker Desktop 이 켜져 있는지 확인해 주세요.' : ''));
    process.exit(r.status ?? 1);
  }
  return r.stdout ?? '';
}

function status() {
  const out = cli(['status', '-o', 'env'], true);
  const env = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnv() {
  const s = status();
  const url = s.API_URL, pub = s.PUBLISHABLE_KEY || s.ANON_KEY, secret = s.SECRET_KEY || s.SERVICE_ROLE_KEY;
  if (!url || !pub || !secret) { console.error('✖ 로컬 Supabase 주소 · 키를 읽지 못했어요:', Object.keys(s).join(', ')); process.exit(1); }
  writeFileSync(ENV_FILE, [
    MARK,
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${pub}`,
    `SUPABASE_SECRET_KEY=${secret}`,
    `POSTGRES_URL_NON_POOLING=${s.DB_URL ?? ''}`,
    '',
  ].join('\n'));
  return s;
}

function readLocalEnv() {
  if (!existsSync(ENV_FILE)) { console.error('✖ 로컬 Supabase 가 꺼져 있어요. 먼저 `npm run local:up` 을 해 주세요.'); process.exit(1); }
  return Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

/** 시험용 교사 · 학생 명단 · 클래스 · 오늘과 내일 차시 */
async function demo() {
  const env = readLocalEnv();
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const email = 'teacher@local.test', password = 'local-teacher-1';
  let uid;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) {
    const list = await admin.auth.admin.listUsers();
    uid = list.data?.users.find((u) => u.email === email)?.id;
    if (!uid) throw made.error;
    console.log('· 시험용 교사 계정이 이미 있어요 (그대로 사용)');
  } else uid = made.data.user.id;
  const own = (o) => ({ ...o, owner_id: uid });
  const must = (r, what) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; };
  const hrExist = must(await admin.from('homerooms').select('id').eq('owner_id', uid).eq('id', 'h_local'), '반 확인');
  if (hrExist.length) {
    console.log('· 시험용 데이터가 이미 있어요. 처음부터 다시 하려면 `npm run local:reset` 후 `npm run local:demo`.');
  } else {
    const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const today = new Date(), tomorrow = new Date(Date.now() + 86400000);
    const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
    must(await admin.from('semesters').insert(own({ id: 's_local', name: '로컬 시험 학기', start_date: ymd(new Date(Date.now() - 30 * 86400000)), end_date: ymd(new Date(Date.now() + 90 * 86400000)) })), '학기');
    must(await admin.from('homerooms').insert(own({ id: 'h_local', school: '로컬고', grade: 1, class_name: '3반' })), '반');
    const names = ['김가람', '이나래', '박다솜', '최가온', '정나린'];
    must(await admin.from('students').insert(names.map((name, i) => own({ id: 'st_local' + (i + 1), homeroom_id: 'h_local', number: i + 1, student_no: String(10301 + i), name, initial_pw: String(111111 * (i + 1)).slice(0, 6) }))), '학생');
    must(await admin.from('classes').insert(own({ id: 'k_local', semester_id: 's_local', homeroom_id: 'h_local', name: '1학년 3반', subject: '물리학', schedule: [{ day: today.getDay(), start: '09:00', end: '09:45' }] })), '클래스');
    must(await admin.from('lessons').insert([today, tomorrow].map((d, i) => own({ id: 'l_local' + (i + 1), class_id: 'k_local', no: i + 1, date: ymd(d), day: DAYS[d.getDay()], time: '09:00~09:45', title: i ? '' : '로컬 시험 수업' }))), '차시');
  }
  const stu = must(await admin.from('students').select('number, student_no, name, initial_pw, password_hash').eq('homeroom_id', 'h_local').order('number'), '학생 목록');
  const hrCode = must(await admin.from('homerooms').select('code').eq('id', 'h_local').single(), '학습코드').code;
  console.log(`
✔ 시험용 데이터 준비 완료
  1) npm run dev  →  http://localhost:3000/teacher  (교사)  ${email} / ${password}
     처음 들어가면 기본 문항 세트(물리 오개념 문항 · 그림 · 개념 지도 · 오개념 목록)가 자동으로 만들어져요.
     [수업하기 › 1학년 3반 › 1차시]에서 문제를 담고 [수업시작] → 위젯에서 [문제 출제하기]
  2) 다른 브라우저(또는 시크릿 창)로 http://localhost:3000/student  (학생: 1학년 3반 · 학습코드 ${hrCode})
${stu.map((s) => `     학번 ${s.student_no} ${s.name}  처음 비밀번호 ${s.password_hash ? '(이미 자기 비밀번호를 정함)' : s.initial_pw}`).join('\n')}
     같은 학생으로 두 브라우저에서 로그인하면 먼저 쓰던 쪽이 로그아웃되는 것도 볼 수 있어요.
  DB 직접 보기: http://127.0.0.1:54323 (Supabase Studio)`);
}

const cmd = process.argv[2];
if (cmd === 'up') {
  cli(['start']);
  const s = writeEnv();
  console.log(`
✔ 로컬 Supabase 가 켜졌어요 (모든 마이그레이션 적용됨)
  · .env.development.local 을 만들었어요 → 이제 \`npm run dev\` 는 로컬 DB 를 써요 (운영 DB 는 그대로)
  · 시험용 교사 · 학생을 바로 만들려면: npm run local:demo
  · DB 보기(Studio): ${s.STUDIO_URL ?? 'http://127.0.0.1:54323'}
  · 끝나면: npm run local:down`);
} else if (cmd === 'demo') {
  demo().catch((e) => { console.error('✖', e.message); process.exit(1); });
} else if (cmd === 'reset') {
  readLocalEnv();
  cli(['db', 'reset']);
  writeEnv();
  console.log('✔ 로컬 DB 를 비우고 마이그레이션부터 다시 적용했어요. 시험용 데이터: npm run local:demo');
} else if (cmd === 'down') {
  cli(['stop']);
  if (existsSync(ENV_FILE) && readFileSync(ENV_FILE, 'utf8').startsWith(MARK)) rmSync(ENV_FILE);
  console.log('✔ 로컬 Supabase 를 껐어요. 이제 `npm run dev` 는 다시 운영 DB(.env.local)를 써요.');
} else {
  console.log('사용법: npm run local:up | local:demo | local:reset | local:down');
}
