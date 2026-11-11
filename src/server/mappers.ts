import 'server-only';
import type { Json, Tables } from '@/lib/database.types';

/*
 * DB 행(snake_case) → API 객체.
 * 화면 코드(legacy Index.html)를 옮기기 쉽도록 기존 시트 열 이름(camelCase)과
 * 값 형식(시각 = epoch ms, 빈 값 = '')을 그대로 유지해요.
 */

const ms = (t: string | null) => (t ? new Date(t).getTime() : 0);

export type Folder = { id: string; name: string; parentId: string; createdAt: number };
export const folder = (r: Tables<'folders'>): Folder => ({
  id: r.id, name: r.name, parentId: r.parent_id ?? '', createdAt: ms(r.created_at),
});

/**
 * 선지별 오개념 (선지 하나에 여러 개):
 *   questions.choice_mis_ids[i] = 오개념 id 들을 ',' 로 이은 문자열, questions.misconceptions[i] = 같은 순서의 이름들을 줄바꿈으로 이은 문자열
 */
export const splitIds = (s: string | null | undefined) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
export const splitNames = (s: string | null | undefined) => String(s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
export const joinIds = (a: string[]) => a.filter(Boolean).join(',');
export const joinNames = (a: string[]) => a.map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n');

export type Question = {
  id: string; folderId: string; title: string; subject: string; type: 'mc' | 'short'; stem: string;
  choices: string[]; answer: string; explanation: string; imageUrl: string; conceptIds: string[];
  /** 선지별 오개념 id 목록 (choices 와 같은 순서) */
  choiceMis: string[][];
  /** 선지별 오개념 이름 목록 (저장 당시 이름 · 학생 응답 기록용) */
  choiceMisNames: string[][];
  /** 선지별 그림 주소 (없으면 '') — 그림 선지는 글이 비어 있을 수 있어요 */
  choiceImages: string[];
  /** 기본 문항 세트에서 온 문항이면 원본 문항 번호 */
  sampleKey: string;
  code: string; figure: string; createdAt: number; updatedAt: number; analysis: Json | null;
};
export const question = (r: Tables<'questions'>): Question => ({
  id: r.id, folderId: r.folder_id ?? '', title: r.title, subject: r.subject, type: r.type === 'short' ? 'short' : 'mc',
  stem: r.stem, choices: r.choices, answer: r.answer, explanation: r.explanation, imageUrl: r.image_url,
  conceptIds: r.concept_ids,
  choiceMis: r.choices.map((_, i) => splitIds((r.choice_mis_ids ?? [])[i])),
  choiceMisNames: r.choices.map((_, i) => splitNames((r.misconceptions ?? [])[i])),
  choiceImages: r.choices.map((_, i) => (r.choice_images ?? [])[i] ?? ''),
  sampleKey: r.sample_key ?? '',
  code: r.code ?? '', figure: r.figure ?? '', createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
  analysis: r.analysis,
});

/** 객관식 정답 번호 목록 ('1|3' → [1, 3]) */
export const answerNos = (answer: string) =>
  [...new Set(String(answer).split('|').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);

export type Semester = { id: string; name: string; start: string; end: string };
export const semester = (r: Tables<'semesters'>): Semester => ({ id: r.id, name: r.name, start: r.start_date, end: r.end_date });

export type Holiday = { date: string; name: string };
export const holiday = (r: Tables<'holidays'>): Holiday => ({ date: r.date, name: r.name });

export type Slot = { day: number; start: string; end: string };
export type Class = {
  id: string; semesterId: string; name: string; subject: string; schedule: Slot[]; intro: string; createdAt: number;
  homeroomId: string;
};
export const klass = (r: Tables<'classes'>): Class => ({
  id: r.id, semesterId: r.semester_id, name: r.name, subject: r.subject,
  schedule: (Array.isArray(r.schedule) ? r.schedule : []) as unknown as Slot[], intro: r.intro, createdAt: ms(r.created_at),
  homeroomId: r.homeroom_id ?? '',
});

export type Lesson = {
  id: string; classId: string; no: number; date: string; day: string; time: string; title: string;
  questionIds: string[]; done: string;
};
export const lesson = (r: Tables<'lessons'>): Lesson => ({
  id: r.id, classId: r.class_id, no: r.no, date: r.date, day: r.day, time: r.time, title: r.title,
  questionIds: r.question_ids, done: r.done ?? '',
});

export type Concept = { id: string; subject: string; kind: 'concept' | 'unit'; unit: string; name: string; x: number; y: number; desc: string };
export const concept = (r: Tables<'concepts'>): Concept => ({
  id: r.id, subject: r.subject, kind: r.kind === 'unit' ? 'unit' : 'concept', unit: r.unit ?? '', name: r.name, x: r.x, y: r.y, desc: r.description,
});

/** weight: 두 개념이 관련된 정도 0~1 (AI가 이은 선) · null = 교사가 직접 이은 선 */
export type Link = { id: string; subject: string; from: string; to: string; weight: number | null };
export const link = (r: Tables<'links'>): Link => ({ id: r.id, subject: r.subject, from: r.from_id, to: r.to_id, weight: r.weight ?? null });

export type Misconception = { id: string; subject: string; name: string; desc: string; conceptIds: string[] };
export const misconception = (r: Tables<'misconceptions'>): Misconception => ({
  id: r.id, subject: r.subject, name: r.name, desc: r.description, conceptIds: r.concept_ids,
});
