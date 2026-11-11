import 'server-only';
import type { TablesInsert } from '@/lib/database.types';
import { all, ApiError, DAYS, fmtDate, isDate, must, parseDate, str, strArr, today, uid, type Ctx } from '../core';
import * as M from '../mappers';
import { homeroomLabel } from './roster';

/* =================================================================
 *  수업 (클래스 / 차시) — legacy Code.js
 * ================================================================= */

type SemStatus = 'active' | 'ended' | 'ready';
function semStatus(sem: M.Semester | undefined, t: string): SemStatus {
  if (!sem) return 'active';
  if (sem.end < t) return 'ended';
  if (sem.start > t) return 'ready';
  return 'active';
}
const byDateTime = (a: { date: string; time: string }, b: { date: string; time: string }) =>
  a.date + a.time < b.date + b.time ? -1 : 1;

export type ClassMeta = M.Class & {
  semesterName: string; status: SemStatus; lessonCount: number; homeroomLabel: string;
  next: { id: string; no: number; date: string; time: string } | null;
};

export async function classesMeta({ sb }: Ctx): Promise<ClassMeta[]> {
  const t = today();
  const [c, s, lessons, h] = await Promise.all([
    sb.from('classes').select('*').order('created_at'),
    sb.from('semesters').select('*'),
    all((a, b) => sb.from('lessons').select('id, class_id, no, date, time').order('id').range(a, b)),
    sb.from('homerooms').select('*'),
  ]);
  const sems = must(s).map(M.semester);
  const hrs = must(h);
  return must(c).map((row) => {
    const o = M.klass(row);
    const sem = sems.find((x) => x.id === o.semesterId);
    const ls = lessons.filter((x) => x.class_id === o.id).sort(byDateTime);
    const next = ls.find((x) => x.date >= t);
    return {
      ...o, semesterName: sem?.name ?? '', status: semStatus(sem, t), lessonCount: ls.length,
      homeroomLabel: (() => { const hr = hrs.find((x) => x.id === o.homeroomId); return hr ? homeroomLabel(hr) : ''; })(),
      next: next ? { id: next.id, no: next.no, date: next.date, time: next.time } : null,
    };
  });
}

/** 학기 기간 × 요일별 시간표 − 공휴일 → 차시 목록 */
function genLessons(classId: string, schedule: M.Slot[], sem: M.Semester, holidays: string[]) {
  const hs = new Set(holidays);
  const slots = schedule.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  const out: TablesInsert<'lessons'>[] = [];
  const d = parseDate(sem.start), end = parseDate(sem.end);
  let no = 0;
  while (d <= end) {
    const ds = fmtDate(d), wd = d.getUTCDay();
    if (!hs.has(ds)) {
      slots.forEach((s) => {
        if (Number(s.day) !== wd) return;
        out.push({ id: uid('l_'), class_id: classId, no: ++no, date: ds, day: DAYS[wd], time: `${s.start}~${s.end}` });
      });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

type ClassIn = { semesterId?: string; name?: string; subject?: string; schedule?: M.Slot[]; intro?: string; homeroomId?: string };

/** 연결할 학생 명단(학년·반)이 내 것인지 확인 ('' = 연결 안 함) */
async function checkHomeroom(ctx: Ctx, id: unknown) {
  const hid = str(id);
  if (!hid) return null;
  const hr = must(await ctx.sb.from('homerooms').select('id').eq('id', hid).maybeSingle());
  if (!hr) throw new ApiError('학생 명단(학년·반)을 다시 골라 주세요.');
  return hid;
}

export async function createClass(ctx: Ctx, d: ClassIn) {
  const { sb } = ctx;
  const semRow = must(await sb.from('semesters').select('*').eq('id', str(d?.semesterId)).maybeSingle());
  if (!semRow) throw new ApiError('학기를 선택해 주세요.');
  const sem = M.semester(semRow);
  const name = str(d.name).trim(), subject = str(d.subject).trim();
  if (!name) throw new ApiError('클래스 이름을 입력해 주세요.');
  const seen = new Set<string>();
  const schedule = (Array.isArray(d.schedule) ? d.schedule : [])
    .map((s) => ({ day: Number(s.day), start: str(s.start), end: str(s.end) }))
    .filter((s) => {
      const k = `${s.day}|${s.start}|${s.end}`;
      if (seen.has(k) || !(s.day >= 0 && s.day <= 6) || !s.start || !s.end) return false;
      seen.add(k);
      return true;
    });
  if (!schedule.length) throw new ApiError('요일과 수업 시간을 1개 이상 입력해 주세요.');
  const dup = must(await sb.from('classes').select('id').eq('semester_id', sem.id).eq('name', name).eq('subject', subject));
  if (dup.length) throw new ApiError('이 학기에 같은 클래스가 이미 있어요.');

  const id = uid('k_');
  const homeroom_id = await checkHomeroom(ctx, d.homeroomId);
  must(await sb.from('classes').insert({ id, semester_id: sem.id, name, subject, schedule, intro: str(d.intro), homeroom_id }));
  const holidays = must(await sb.from('holidays').select('date')).map((h) => h.date);
  const ls = genLessons(id, schedule, sem, holidays);
  if (ls.length) must(await sb.from('lessons').insert(ls));
  return { classes: await classesMeta(ctx), classId: id, lessonCount: ls.length };
}

export async function updateClass(ctx: Ctx, id: unknown, patch: ClassIn) {
  const p: { name?: string; subject?: string; intro?: string; homeroom_id?: string | null } = {};
  if (patch?.homeroomId != null) p.homeroom_id = await checkHomeroom(ctx, patch.homeroomId);
  if (patch?.name != null) p.name = str(patch.name);
  if (patch?.subject != null) p.subject = str(patch.subject);
  if (patch?.intro != null) p.intro = str(patch.intro);
  const rows = must(await ctx.sb.from('classes').update(p).eq('id', str(id)).select('id'));
  if (!rows.length) throw new ApiError('데이터를 찾을 수 없어요.');
  return { classes: await classesMeta(ctx) };
}

/** 클래스 삭제 — 차시·응답은 on delete cascade */
export async function deleteClass(ctx: Ctx, id: unknown) {
  must(await ctx.sb.from('classes').delete().eq('id', str(id)));
  return { classes: await classesMeta(ctx) };
}

export async function getLessons(ctx: Ctx, classId: unknown) {
  const cls = (await classesMeta(ctx)).find((c) => c.id === str(classId));
  if (!cls) throw new ApiError('클래스를 찾을 수 없어요.');
  const ls = must(await ctx.sb.from('lessons').select('*').eq('class_id', cls.id).order('no'));
  return { cls, lessons: ls.map(M.lesson) };
}

/** 날짜·시간 순으로 차시 번호를 다시 매김 */
async function renumber({ sb }: Ctx, classId: string) {
  const ls = must(await sb.from('lessons').select('*').eq('class_id', classId)).sort(byDateTime);
  const changed = ls.map((l, i) => ({ ...l, no: i + 1 })).filter((l, i) => ls[i].no !== l.no);
  if (changed.length) must(await sb.from('lessons').upsert(changed));
}

export async function addLesson(ctx: Ctx, classId: unknown, date: unknown, time: unknown) {
  if (!isDate(date)) throw new ApiError('날짜를 입력해 주세요.');
  must(await ctx.sb.from('lessons').insert({
    id: uid('l_'), class_id: str(classId), no: 0, date, day: DAYS[parseDate(date).getUTCDay()], time: str(time),
  }));
  await renumber(ctx, str(classId));
  return getLessons(ctx, classId);
}

export async function deleteLesson(ctx: Ctx, id: unknown) {
  const l = must(await ctx.sb.from('lessons').delete().eq('id', str(id)).select('class_id')).at(0);
  if (!l) throw new ApiError('차시를 찾을 수 없어요.');
  await renumber(ctx, l.class_id);
  return getLessons(ctx, l.class_id);
}

export async function updateLesson(ctx: Ctx, id: unknown, patch: { title?: string; time?: string; done?: string }) {
  const p: { title?: string; time?: string; done?: string | null } = {};
  if (patch?.title != null) p.title = str(patch.title);
  if (patch?.time != null) p.time = str(patch.time);
  if (patch?.done != null) p.done = isDate(patch.done) ? patch.done : null;
  const row = must(await ctx.sb.from('lessons').update(p).eq('id', str(id)).select()).at(0);
  if (!row) throw new ApiError('데이터를 찾을 수 없어요.');
  return M.lesson(row);
}

export async function setLessonQuestions(ctx: Ctx, id: unknown, ids: unknown) {
  const row = must(await ctx.sb.from('lessons').update({ question_ids: strArr(ids) }).eq('id', str(id)).select()).at(0);
  if (!row) throw new ApiError('데이터를 찾을 수 없어요.');
  return M.lesson(row);
}

export async function getLessonDetail(ctx: Ctx, id: unknown) {
  const row = must(await ctx.sb.from('lessons').select('*').eq('id', str(id)).maybeSingle());
  if (!row) throw new ApiError('차시를 찾을 수 없어요.');
  const cls = (await classesMeta(ctx)).find((c) => c.id === row.class_id);
  return { lesson: M.lesson(row), cls };
}

/** 오늘·다가오는 수업 (종료되지 않은 학기, 최대 40개) */
export async function upcoming(ctx: Ctx) {
  const classes = (await classesMeta(ctx)).filter((c) => c.status !== 'ended');
  if (!classes.length) return [];
  const cmap = new Map(classes.map((c) => [c.id, c]));
  const ls = must(await ctx.sb.from('lessons').select('*').in('class_id', [...cmap.keys()]).gte('date', today())
    .order('date').order('time').limit(40));
  return ls.map((l) => ({ ...M.lesson(l), className: cmap.get(l.class_id)!.name, subject: cmap.get(l.class_id)!.subject }));
}
