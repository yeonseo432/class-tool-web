#!/usr/bin/env node
/**
 * 구글 시트(수업도구 DB) → Supabase 데이터 이전
 *
 * 사용법
 *   node --env-file-if-exists=.env.local scripts/import-sheet.mjs --file data/sheet.xlsx --dry-run
 *   node --env-file-if-exists=.env.local scripts/import-sheet.mjs --sheet <스프레드시트ID> --email teacher@example.com
 *
 * 옵션
 *   --file <xlsx>      내려받은 xlsx 파일 (구글 시트 > 파일 > 다운로드 > Microsoft Excel)
 *   --sheet <id>       또는 스프레드시트 ID (링크가 있는 사용자 보기 권한이 있어야 함)
 *   --email <email>    데이터를 소유할 교사 계정 (Supabase Auth에 먼저 가입되어 있어야 함)
 *   --owner <uuid>     또는 교사 user id
 *   --replace          이 교사의 기존 데이터를 모두 지우고 다시 넣음
 *   --dry-run          DB에 쓰지 않고 변환 결과만 출력
 *
 * 필요한 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';

const { values: opt } = parseArgs({
  options: {
    file: { type: 'string' },
    sheet: { type: 'string' },
    email: { type: 'string' },
    owner: { type: 'string' },
    replace: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
const DRY = opt['dry-run'];

function die(msg) {
  console.error('\n✖ ' + msg);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  1. 시트 읽기                                                        */
/* ------------------------------------------------------------------ */
async function loadWorkbook() {
  let buf;
  if (opt.file) buf = await readFile(opt.file);
  else if (opt.sheet) {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(opt.sheet)}/export?format=xlsx`;
    const res = await fetch(url);
    if (!res.ok) die(`시트를 내려받지 못했어요 (${res.status}). 공유 설정을 확인하거나 --file 을 쓰세요.`);
    buf = Buffer.from(await res.arrayBuffer());
  } else die('--file 또는 --sheet 를 지정해 주세요.');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return String(v.text);
    return JSON.stringify(v);
  }
  return v;
}

/** 시트 하나를 [{header: value}] 로 */
function rows(wb, name) {
  const ws = wb.getWorksheet(name);
  if (!ws) return [];
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (header[i] = String(cellValue(c.value)).trim()));
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    let empty = true;
    header.forEach((h, i) => {
      if (!h) return;
      const v = cellValue(row.getCell(i).value);
      if (v !== '') empty = false;
      o[h] = v;
    });
    if (!empty) out.push(o);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  2. 값 변환                                                          */
/* ------------------------------------------------------------------ */
const str = (v) => (v == null ? '' : String(v).trim());
const nul = (v) => (str(v) === '' ? null : str(v));
const int = (v, d = 0) => (Number.isFinite(Number(v)) && str(v) !== '' ? Math.round(Number(v)) : d);
const ts = (v) => (str(v) === '' || !Number.isFinite(Number(v)) ? new Date().toISOString() : new Date(Number(v)).toISOString());
const date = (v) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : null);
/** 시트에 숫자로 저장된 답(4.0)을 "4"로 */
const numText = (v) => (typeof v === 'number' && Number.isInteger(v) ? String(v) : str(v));

function json(v, fallback) {
  if (str(v) === '') return fallback;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}
const textArr = (v) => (Array.isArray(json(v, [])) ? json(v, []) : []).map((x) => (x == null ? '' : String(x)));

function transform(wb, owner) {
  const warn = [];
  const folders = rows(wb, 'Folders').map((r) => ({
    id: str(r.id), owner_id: owner, name: str(r.name) || '이름 없음', parent_id: nul(r.parentId), created_at: ts(r.createdAt),
  }));
  const folderIds = new Set(folders.map((f) => f.id));
  folders.forEach((f) => {
    if (f.parent_id && !folderIds.has(f.parent_id)) { warn.push(`폴더 ${f.id}: 상위 폴더 ${f.parent_id} 없음 → 최상위로`); f.parent_id = null; }
  });

  const questions = rows(wb, 'Questions').map((r) => {
    const analysis = json(r.analysis, null);
    return {
      id: str(r.id), owner_id: owner, folder_id: nul(r.folderId), title: str(r.title), subject: str(r.subject),
      type: str(r.type) === 'short' ? 'short' : 'mc', stem: String(r.stem ?? ''), choices: textArr(r.choices),
      answer: numText(r.answer), explanation: String(r.explanation ?? ''), image_url: str(r.imageUrl),
      concept_ids: textArr(r.conceptIds), misconceptions: textArr(r.misconceptions),
      analysis: analysis && typeof analysis === 'object' && !Array.isArray(analysis) ? analysis : null,
      created_at: ts(r.createdAt), updated_at: ts(r.updatedAt || r.createdAt),
    };
  });
  questions.forEach((q) => {
    if (q.folder_id && !folderIds.has(q.folder_id)) { warn.push(`문제 ${q.id}: 폴더 ${q.folder_id} 없음 → 최상위로`); q.folder_id = null; }
  });

  const semesters = rows(wb, 'Semesters').map((r) => ({
    id: str(r.id), owner_id: owner, name: str(r.name), start_date: date(r.start), end_date: date(r.end),
  }));

  const seenHoliday = new Set();
  const holidays = rows(wb, 'Holidays')
    .map((r) => ({ owner_id: owner, date: date(r.date), name: str(r.name) || '휴일' }))
    .filter((h) => h.date && !seenHoliday.has(h.date) && seenHoliday.add(h.date));

  const semIds = new Set(semesters.map((s) => s.id));
  const classes = rows(wb, 'Classes').map((r) => ({
    id: str(r.id), owner_id: owner, semester_id: str(r.semesterId), name: str(r.name), subject: str(r.subject),
    schedule: json(r.schedule, []), intro: String(r.intro ?? ''), created_at: ts(r.createdAt),
  })).filter((c) => semIds.has(c.semester_id) || (warn.push(`클래스 ${c.id}: 학기 ${c.semester_id} 없음 → 건너뜀`), false));

  const classIds = new Set(classes.map((c) => c.id));
  const lessons = rows(wb, 'Lessons').map((r) => ({
    id: str(r.id), owner_id: owner, class_id: str(r.classId), no: int(r.no), date: date(r.date), day: str(r.day),
    time: str(r.time), title: str(r.title), question_ids: textArr(r.questionIds), done: date(r.done),
  })).filter((l) => (classIds.has(l.class_id) && l.date) || (warn.push(`차시 ${l.id}: 클래스/날짜 없음 → 건너뜀`), false));

  const concepts = rows(wb, 'Concepts').map((r) => ({
    id: str(r.id), owner_id: owner, subject: str(r.subject), name: str(r.name) || '새 개념',
    x: int(r.x, 100), y: int(r.y, 100), description: String(r.desc ?? ''),
  }));
  const conceptIds = new Set(concepts.map((c) => c.id));
  const links = rows(wb, 'Links').map((r) => ({
    id: str(r.id), owner_id: owner, subject: str(r.subject), from_id: str(r.from), to_id: str(r.to),
  })).filter((l) => (conceptIds.has(l.from_id) && conceptIds.has(l.to_id) && l.from_id !== l.to_id)
    || (warn.push(`연결 ${l.id}: 개념 없음 → 건너뜀`), false));

  const misconceptions = rows(wb, 'Misconceptions').map((r) => ({
    id: str(r.id), owner_id: owner, subject: str(r.subject), name: str(r.name) || '이름 없는 오개념',
    description: String(r.desc ?? ''), concept_ids: textArr(r.conceptIds),
  }));

  const lessonIds = new Set(lessons.map((l) => l.id));
  const responses = rows(wb, 'Responses').map((r) => ({
    owner_id: owner, lesson_id: str(r.lessonId), session_id: null, question_id: str(r.questionId),
    student_key: str(r.studentKey || r.studentName), student_name: str(r.studentName || r.studentKey),
    answer: numText(r.answer), correct: Number(r.correct) === 1 || str(r.correct).toLowerCase() === 'true',
    misconception: str(r.misconception), concept_ids: textArr(r.conceptIds), created_at: ts(r.timestamp),
  })).filter((x) => lessonIds.has(x.lesson_id) || (warn.push(`응답: 차시 ${x.lesson_id} 없음 → 건너뜀`), false));

  // 확인용: 같은 학기·이름·과목 클래스 중복 (구버전 버그로 생긴 데이터)
  const dupKey = {};
  classes.forEach((c) => {
    const k = `${c.semester_id}|${c.name}|${c.subject}`;
    if (dupKey[k]) warn.push(`참고: 클래스 ${dupKey[k]} 와 ${c.id} 가 같은 학기·이름·과목이에요 (그대로 옮김)`);
    else dupKey[k] = c.id;
  });

  return {
    data: { folders: sortFolders(folders), questions, semesters, holidays, classes, lessons, concepts, links, misconceptions, responses },
    warn,
  };
}

/** 상위 폴더가 먼저 들어가도록 정렬 */
function sortFolders(list) {
  const byId = new Map(list.map((f) => [f.id, f]));
  const out = [], done = new Set();
  const visit = (f, depth = 0) => {
    if (done.has(f.id) || depth > list.length) return;
    if (f.parent_id && byId.has(f.parent_id)) visit(byId.get(f.parent_id), depth + 1);
    done.add(f.id);
    out.push(f);
  };
  list.forEach((f) => visit(f));
  return out;
}

/* ------------------------------------------------------------------ */
/*  3. 쓰기                                                             */
/* ------------------------------------------------------------------ */
const ORDER = ['folders', 'questions', 'semesters', 'holidays', 'classes', 'lessons', 'concepts', 'links', 'misconceptions', 'responses'];
const CONFLICT = { holidays: 'owner_id,date' };

async function resolveOwner(sb) {
  if (opt.owner) return opt.owner;
  if (!opt.email) return null;
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die('교사 계정을 찾지 못했어요: ' + error.message);
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === opt.email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  die(`${opt.email} 계정이 없어요. 먼저 앱에서 가입해 주세요.`);
}

async function main() {
  const wb = await loadWorkbook();
  let sb = null;
  let owner = opt.owner || '00000000-0000-0000-0000-000000000000';
  if (!DRY) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) die('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY 환경변수가 필요해요 (.env.local).');
    sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    owner = await resolveOwner(sb);
    if (!owner) die('--email 또는 --owner 로 교사 계정을 지정해 주세요.');
  }

  const { data, warn } = transform(wb, owner);
  console.log('변환 결과');
  ORDER.forEach((t) => console.log(`  ${t.padEnd(15)} ${data[t].length}`));
  if (warn.length) { console.log('\n확인할 점'); warn.forEach((w) => console.log('  - ' + w)); }
  if (DRY) {
    console.log('\n(dry-run) 예시 행:');
    ORDER.forEach((t) => data[t][0] && console.log(`  ${t}:`, JSON.stringify(data[t][0]).slice(0, 300)));
    return;
  }

  if (opt.replace) {
    console.log('\n기존 데이터 삭제 중…');
    for (const t of [...ORDER].reverse()) {
      const { error } = await sb.from(t).delete().eq('owner_id', owner);
      if (error) die(`${t} 삭제 실패: ${error.message}`);
    }
  } else {
    const { count } = await sb.from('responses').select('id', { count: 'exact', head: true }).eq('owner_id', owner);
    if (count) {
      console.log(`\n이미 응답 ${count}개가 있어 responses 는 건너뜀 (중복 방지). 다시 넣으려면 --replace`);
      data.responses = [];
    }
  }

  for (const t of ORDER) {
    const list = data[t];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const q = t === 'responses' ? sb.from(t).insert(chunk) : sb.from(t).upsert(chunk, { onConflict: CONFLICT[t] || 'id' });
      const { error } = await q;
      if (error) die(`${t} 저장 실패: ${error.message}`);
    }
    console.log(`  ✔ ${t}`);
  }
  console.log('\n완료!');
}

main().catch((e) => die(e?.stack || String(e)));
