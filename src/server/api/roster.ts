import 'server-only';
import type { Tables, TablesInsert } from '@/lib/database.types';
import { ApiError, must, schoolYear, str, strArr, uid, type Ctx } from '../core';
import { newInitialPassword } from '../student-auth';

/* =================================================================
 *  학생 명단 (수업하기 › 학생 목록 관리)
 *  학년도 > 학교 > 학년 > 반(homerooms, 이름은 직접 입력: 'A반' · '3반' …) > 학생(번호 · 학번 · 이름)
 *  학년도(3월 ~ 다음 해 2월)가 끝난 반은 expired — 명단 화면 · 학생 로그인에서 빠져요 (데이터는 남음)
 *  학생은 반의 학습코드(4자리) + 학번 + 비밀번호로 /student 에 로그인해요. (학습코드는 DB가 반마다 만들어요)
 *  처음 비밀번호는 학생마다 다른 6자리 숫자(교사가 나눠 줌) → 처음 로그인할 때 자기 비밀번호로 바꿔야 들어가요.
 * ================================================================= */

export type Homeroom = {
  id: string; year: number; expired: boolean; school: string; grade: number; className: string; code: string;
  label: string; count: number; classIds: string[];
};
/** pwSet: 학생이 자기 비밀번호를 정함 · initialPw: 아직이면 나눠 줄 처음 비밀번호 */
export type Student = { id: string; homeroomId: string; number: number; studentNo: string; name: string; pwSet: boolean; initialPw: string };

export const homeroomLabel = (h: { school: string; grade: number; class_name: string }) =>
  `${h.school ? h.school + ' ' : ''}${h.grade}학년 ${h.class_name}`;

const student = (r: Tables<'students'>): Student => ({
  id: r.id, homeroomId: r.homeroom_id, number: r.number, studentNo: r.student_no ?? '', name: r.name, pwSet: !!r.password_hash,
  initialPw: r.password_hash ? '' : r.initial_pw ?? '',
});

const NAME_MAX = 30;
export const cleanName = (v: unknown) => str(v).trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
/** 반 이름 (직접 입력): 'A' · '3' 처럼 글자 하나나 숫자만 쓰면 '반'을 붙여요 */
export const cleanClassName = (v: unknown) => {
  const t = str(v).trim().replace(/\s+/g, ' ').slice(0, 20);
  return /^([0-9]{1,2}|[A-Za-z가-힣])$/.test(t) ? t + '반' : t;
};
/** 학번: 숫자 4~8자리 (예: 30301 = 3학년 3반 1번) */
export const STUDENT_NO = /^[0-9]{4,8}$/;
export const cleanStudentNo = (v: unknown) => str(v).replace(/\s+/g, '');
const intIn = (v: unknown, lo: number, hi: number) => {
  const n = Number(str(v).trim());
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** 반 목록 (학생 수 · 이 명단을 쓰는 클래스 포함) */
export async function homerooms({ sb }: Ctx): Promise<Homeroom[]> {
  const [h, s, c] = await Promise.all([
    sb.from('homerooms').select('*').order('year', { ascending: false }).order('school').order('grade').order('class_name'),
    sb.from('students').select('homeroom_id'),
    sb.from('classes').select('id, homeroom_id'),
  ]);
  const count = new Map<string, number>();
  must(s).forEach((x) => count.set(x.homeroom_id, (count.get(x.homeroom_id) ?? 0) + 1));
  const cls = must(c), now = schoolYear();
  return must(h).map((r) => ({
    id: r.id, year: r.year, expired: r.year < now, school: r.school, grade: r.grade, className: r.class_name, code: r.code,
    label: homeroomLabel(r), count: count.get(r.id) ?? 0, classIds: cls.filter((x) => x.homeroom_id === r.id).map((x) => x.id),
  }));
}

export async function getRoster(ctx: Ctx, homeroomId: unknown) {
  const id = str(homeroomId);
  const rows = must(await ctx.sb.from('students').select('*').eq('homeroom_id', id).order('number'));
  return { homerooms: await homerooms(ctx), students: rows.map(student) };
}

/** 학교 · 학년 · 반 추가 / 수정 */
export async function saveHomeroom(ctx: Ctx, h: { id?: string; year?: unknown; school?: string; grade?: unknown; className?: unknown }) {
  const school = str(h?.school).trim().replace(/\s+/g, ' ').slice(0, 40);
  const grade = intIn(h?.grade, 1, 12), className = cleanClassName(h?.className);
  const year = h?.year == null || str(h.year).trim() === '' ? schoolYear() : intIn(h.year, 2000, 2100);
  if (year == null) throw new ApiError('학년도를 숫자(예: 2026)로 입력해 주세요.');
  if (grade == null) throw new ApiError('학년을 숫자(1~12)로 입력해 주세요.');
  if (!className) throw new ApiError('반 이름을 입력해 주세요. (예: A반, 3반)');
  const rec = { year, school, grade, class_name: className };
  const dup = must(await ctx.sb.from('homerooms').select('id').eq('year', year).eq('school', school).eq('grade', grade).eq('class_name', className));
  if (dup.some((d) => d.id !== str(h?.id))) throw new ApiError('같은 학년도 · 학교 · 학년 · 반이 이미 있어요.');
  let id = str(h?.id);
  const updated = id ? must(await ctx.sb.from('homerooms').update(rec).eq('id', id).select('id')) : [];
  if (!updated.length) {
    id = uid('h_');
    must(await ctx.sb.from('homerooms').insert({ ...rec, id }));
  }
  return { ...(await getRoster(ctx, id)), id };
}

/** 반 삭제 — 학생도 함께 지워지고, 이 반을 쓰던 클래스는 명단 연결만 풀려요 (응답 기록은 남음) */
export async function deleteHomeroom(ctx: Ctx, id: unknown) {
  must(await ctx.sb.from('homerooms').delete().eq('id', str(id)));
  return { homerooms: await homerooms(ctx) };
}

/**
 * 학생 여러 명 추가: [{number?, studentNo, name}] 또는 붙여넣은 글(줄마다 "학번 이름" / "번호 학번 이름", 탭 · 쉼표도 됨).
 * 같은 학번이 이미 있으면 이름(과 적은 번호)만 바꿔요 (비밀번호는 그대로). 번호를 안 적으면 마지막 번호 다음부터.
 */
export async function addStudents(ctx: Ctx, homeroomId: unknown, list: unknown) {
  const hid = str(homeroomId);
  const hr = must(await ctx.sb.from('homerooms').select('id').eq('id', hid).maybeSingle());
  if (!hr) throw new ApiError('반을 먼저 골라 주세요.');
  const items: { number: number | null; studentNo: string; name: string }[] = [];
  const bad: string[] = [];
  const push = (no: unknown, sno: unknown, nm: unknown, raw: string) => {
    const noTxt = str(no).trim(), number = noTxt ? intIn(noTxt, 1, 99) : null;
    const studentNo = cleanStudentNo(sno), name = cleanName(nm);
    if ((noTxt && number == null) || !STUDENT_NO.test(studentNo) || !name) return bad.push(raw);
    const i = items.findIndex((x) => x.studentNo === studentNo);
    if (i >= 0) items[i] = { number, studentNo, name }; else items.push({ number, studentNo, name });
  };
  if (typeof list === 'string') {
    // 엑셀에서 복사한 '학번<TAB>이름', '30301 홍길동', '1 30301 홍길동', '홍길동 30301' 모두 허용
    list.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const tok = line.split(/[\t,]+|\s+/).map((t) => t.trim()).filter(Boolean);
      const si = tok.findIndex((t) => STUDENT_NO.test(t));
      const ni = tok.findIndex((t, k) => k !== si && /^\d{1,2}(번|\.)?$/.test(t));
      const name = tok.filter((_, k) => k !== si && k !== ni).join(' ');
      if (si < 0 || !name) return bad.push(line);
      push(ni >= 0 ? tok[ni].replace(/\D/g, '') : '', tok[si], name, line);
    });
  } else {
    (Array.isArray(list) ? list : []).forEach((x: { number?: unknown; studentNo?: unknown; name?: unknown }) =>
      push(x?.number ?? '', x?.studentNo, x?.name, `${str(x?.studentNo)} ${str(x?.name)}`));
  }
  if (!items.length) {
    throw new ApiError(bad.length ? `학생 정보를 읽지 못했어요 (학번은 숫자 4~8자리): ${bad.slice(0, 3).join(', ')}` : '학번과 이름을 입력해 주세요.');
  }
  const exist = must(await ctx.sb.from('students').select('id, number, student_no').eq('homeroom_id', hid));
  const usedNo = new Set(exist.map((e) => e.number));
  const upd = items.filter((x) => exist.some((e) => e.student_no === x.studentNo));
  // 번호: 적은 번호가 비어 있으면 그대로, 아니면(또는 안 적었으면) 비어 있는 다음 번호
  let next = Math.max(0, ...exist.map((e) => e.number));
  const add: TablesInsert<'students'>[] = [];
  for (const x of items.filter((y) => !upd.includes(y))) {
    let number = x.number;
    if (number == null || usedNo.has(number)) { do next++; while (usedNo.has(next)); number = next; }
    if (number > 99) { bad.push(`${x.studentNo} ${x.name} (번호가 99번까지 다 찼어요)`); continue; }
    usedNo.add(number);
    add.push({ id: uid('st_'), homeroom_id: hid, number, student_no: x.studentNo, name: x.name, initial_pw: newInitialPassword() });
  }
  for (const u of upd) {
    const e = exist.find((y) => y.student_no === u.studentNo)!;
    const patch: { name: string; number?: number } = { name: u.name };
    if (u.number != null && u.number !== e.number && !usedNo.has(u.number)) patch.number = u.number;
    must(await ctx.sb.from('students').update(patch).eq('id', e.id));
  }
  if (add.length) must(await ctx.sb.from('students').insert(add));
  return { ...(await getRoster(ctx, hid)), added: add.length, updated: upd.length, skipped: bad };
}

export async function updateStudent(ctx: Ctx, id: unknown, patch: { number?: unknown; studentNo?: unknown; name?: unknown }) {
  const p: { number?: number; student_no?: string; name?: string } = {};
  if (patch?.number != null) {
    const n = intIn(patch.number, 1, 99);
    if (n == null) throw new ApiError('번호를 숫자(1~99)로 입력해 주세요.');
    p.number = n;
  }
  if (patch?.studentNo != null) {
    const n = cleanStudentNo(patch.studentNo);
    if (!STUDENT_NO.test(n)) throw new ApiError('학번을 숫자 4~8자리(예: 30301)로 입력해 주세요.');
    p.student_no = n;
  }
  if (patch?.name != null) {
    const n = cleanName(patch.name);
    if (!n) throw new ApiError('이름을 입력해 주세요.');
    p.name = n;
  }
  const r = await ctx.sb.from('students').update(p).eq('id', str(id)).select('homeroom_id');
  if (r.error?.code === '23505') throw new ApiError(p.student_no ? '같은 학번의 학생이 이미 있어요.' : '같은 번호의 학생이 이미 있어요.');
  const row = must(r).at(0);
  if (!row) throw new ApiError('학생을 찾을 수 없어요.');
  return getRoster(ctx, row.homeroom_id);
}

export async function deleteStudents(ctx: Ctx, homeroomId: unknown, ids: unknown) {
  const list = strArr(ids);
  if (list.length) must(await ctx.sb.from('students').delete().in('id', list));
  return getRoster(ctx, homeroomId);
}

/**
 * 비밀번호를 잊은 학생: 새 6자리 처음 비밀번호를 만들고 자기 비밀번호는 지움.
 * 로그인해 있던 기기도 로그아웃돼요 (다음 로그인 때 다시 자기 비밀번호를 정함).
 */
export async function resetStudentPassword(ctx: Ctx, homeroomId: unknown, ids: unknown) {
  for (const id of strArr(ids)) {
    must(await ctx.sb.from('students').update({ password_hash: null, initial_pw: newInitialPassword(), session_id: null }).eq('id', id));
  }
  return getRoster(ctx, homeroomId);
}
