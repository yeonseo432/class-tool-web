import 'server-only';
import { ApiError, isDate, must, str, uid, type Ctx } from '../core';
import * as M from '../mappers';
import { settings } from './bootstrap';
import { classesMeta } from './classes';

/* =================================================================
 *  설정 — legacy Code.js
 *  - OpenAI 키: 화면 입력(Script Properties) → Vercel 환경변수 OPENAI_API_KEY
 *  - 교사 비밀번호: Supabase Auth 비밀번호 변경
 * ================================================================= */

export async function saveSettings(ctx: Ctx, s: { model?: string; imageModel?: string; newPassword?: string; apiKey?: string; clearKey?: boolean }) {
  if (s?.apiKey || s?.clearKey) {
    throw new ApiError('OpenAI API 키는 이제 Vercel 프로젝트의 환경변수(OPENAI_API_KEY)에서 관리해요.');
  }
  if (s?.model || s?.imageModel) {
    must(await ctx.sb.from('teacher_settings').upsert({
      owner_id: ctx.uid,
      ...(s.model ? { openai_model: str(s.model).trim() } : {}),
      ...(s.imageModel ? { image_model: str(s.imageModel).trim() } : {}),
    }));
  }
  if (s?.newPassword) {
    if (str(s.newPassword).length < 6) throw new ApiError('비밀번호는 6자 이상이어야 해요.');
    const { error } = await ctx.sb.auth.updateUser({ password: str(s.newPassword) });
    if (error) throw new ApiError('비밀번호를 바꾸지 못했어요: ' + error.message);
  }
  return settings(ctx);
}

const semesters = async ({ sb }: Ctx) => must(await sb.from('semesters').select('*').order('start_date')).map(M.semester);

export async function saveSemester(ctx: Ctx, s: Partial<M.Semester>) {
  if (!str(s?.name).trim() || !isDate(s.start) || !isDate(s.end)) throw new ApiError('학기 이름과 시작/종료일을 입력해 주세요.');
  if (s.start > s.end) throw new ApiError('종료일이 시작일보다 빨라요.');
  const rec = { name: str(s.name).trim(), start_date: s.start, end_date: s.end };
  if (s.id) {
    const rows = must(await ctx.sb.from('semesters').update(rec).eq('id', str(s.id)).select('id'));
    if (!rows.length) throw new ApiError('데이터를 찾을 수 없어요.');
  } else must(await ctx.sb.from('semesters').insert({ ...rec, id: uid('s_') }));
  return { semesters: await semesters(ctx), classes: await classesMeta(ctx) };
}

export async function deleteSemester(ctx: Ctx, id: unknown) {
  const used = must(await ctx.sb.from('classes').select('id').eq('semester_id', str(id)).limit(1));
  if (used.length) throw new ApiError('이 학기에 클래스가 있어 삭제할 수 없어요.');
  must(await ctx.sb.from('semesters').delete().eq('id', str(id)));
  return { semesters: await semesters(ctx) };
}

/** 여러 줄 텍스트 ('2026-03-01 삼일절')로 공휴일 전체 교체 */
export async function saveHolidays(ctx: Ctx, text: unknown) {
  const map = new Map<string, string>();
  str(text).split(/\r?\n/).forEach((l) => {
    const m = l.trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
    if (m) map.set(m[1], m[2] || '휴일');
  });
  must(await ctx.sb.from('holidays').delete().eq('owner_id', ctx.uid));
  if (map.size) must(await ctx.sb.from('holidays').insert([...map].map(([date, name]) => ({ date, name }))));
  const rows = must(await ctx.sb.from('holidays').select('*').order('date'));
  return { holidays: rows.map(M.holiday) };
}
