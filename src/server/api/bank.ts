import 'server-only';
import type { TablesInsert } from '@/lib/database.types';
import { all, ApiError, must, str, strArr, uid, uniq, type Ctx } from '../core';
import * as M from '../mappers';
import { hasOpenAI, openaiImage, openaiJson, type ChatMessage } from '../openai';
import { autoLinkConcepts } from './concepts';
import { conceptsLite } from './bootstrap';
import { getMisconceptions } from './misconceptions';

/* =================================================================
 *  문제은행 (legacy Code.js: 문제은행 섹션)
 * ================================================================= */

export async function bank({ sb }: Ctx) {
  const [f, q] = await Promise.all([
    all((a, b) => sb.from('folders').select('*').order('created_at').order('id').range(a, b)),
    all((a, b) => sb.from('questions').select('*').order('created_at').order('id').range(a, b)),
  ]);
  return { folders: f.map(M.folder), questions: q.map(M.question) };
}

export async function createFolder(ctx: Ctx, name: unknown, parentId: unknown) {
  must(await ctx.sb.from('folders').insert({
    id: uid('f_'), name: str(name).trim() || '새 폴더', parent_id: str(parentId) || null,
  }));
  return bank(ctx);
}

export async function renameFolder(ctx: Ctx, id: unknown, name: unknown) {
  const rows = must(await ctx.sb.from('folders').update({ name: str(name).trim() || '이름 없음' }).eq('id', str(id)).select('id'));
  if (!rows.length) throw new ApiError('데이터를 찾을 수 없어요.');
  return bank(ctx);
}

type Sel = { folderIds?: string[]; questionIds?: string[] };

/** 폴더(하위 폴더·문제 포함)와 문제 삭제 — 하위 항목은 DB의 on delete cascade로 함께 지워짐 */
export async function deleteItems(ctx: Ctx, sel: Sel) {
  const qids = strArr(sel?.questionIds), fids = strArr(sel?.folderIds);
  if (qids.length) must(await ctx.sb.from('questions').delete().in('id', qids));
  if (fids.length) must(await ctx.sb.from('folders').delete().in('id', fids));
  return bank(ctx);
}

function descendants(folders: M.Folder[], ids: string[]) {
  const set = new Set<string>();
  const stack = ids.slice();
  while (stack.length) {
    const id = stack.pop()!;
    if (set.has(id)) continue;
    set.add(id);
    folders.forEach((f) => f.parentId === id && stack.push(f.id));
  }
  return set;
}

export async function moveItems(ctx: Ctx, sel: Sel, target: unknown) {
  const to = str(target);
  const fids = strArr(sel?.folderIds), qids = strArr(sel?.questionIds);
  if (fids.length) {
    const { folders } = await bank(ctx);
    if (to && descendants(folders, fids).has(to)) throw new ApiError('폴더를 자기 자신(또는 하위 폴더) 안으로 옮길 수 없어요.');
    must(await ctx.sb.from('folders').update({ parent_id: to || null }).in('id', fids));
  }
  if (qids.length) must(await ctx.sb.from('questions').update({ folder_id: to || null }).in('id', qids));
  return bank(ctx);
}

/** 복사: target이 null/undefined면 원래 위치에 '(사본)' */
export async function copyItems(ctx: Ctx, sel: Sel, target?: string | null) {
  const { folders, questions } = await bank(ctx);
  const nf: TablesInsert<'folders'>[] = [], nq: TablesInsert<'questions'>[] = [];
  const copyQ = (q: M.Question, fid: string, suf = '') => {
    nq.push({
      id: uid('q_'), folder_id: fid || null, title: q.title + suf, subject: q.subject, type: q.type, stem: q.stem,
      choices: q.choices, answer: q.answer, explanation: q.explanation, image_url: q.imageUrl,
      concept_ids: q.conceptIds, misconceptions: q.choiceMisNames.map(M.joinNames), choice_mis_ids: q.choiceMis.map(M.joinIds),
      choice_images: q.choiceImages, analysis: q.analysis, code: q.code, figure: q.figure,   // 복제본은 교사 문항 (sample_key 없음)
    });
  };
  const copyF = (f: M.Folder, parent: string, suf = '') => {
    const id = uid('f_');
    nf.push({ id, name: f.name + suf, parent_id: parent || null });   // 상위 폴더가 먼저 들어감
    folders.filter((x) => x.parentId === f.id).forEach((x) => copyF(x, id));
    questions.filter((q) => q.folderId === f.id).forEach((q) => copyQ(q, id));
  };
  strArr(sel?.folderIds).forEach((id) => {
    const f = folders.find((x) => x.id === id);
    if (f) copyF(f, target == null ? f.parentId : str(target), ' (사본)');
  });
  strArr(sel?.questionIds).forEach((id) => {
    const q = questions.find((x) => x.id === id);
    if (q) copyQ(q, target == null ? q.folderId : str(target), ' (사본)');
  });
  if (nf.length) must(await ctx.sb.from('folders').insert(nf));
  if (nq.length) must(await ctx.sb.from('questions').insert(nq));
  return bank(ctx);
}

type QIn = Partial<M.Question> & {
  newConcepts?: string[];
  /** 아직 오개념 목록에 없는 선지별 오개념 이름 (AI가 제안한 것 등) — 저장할 때 목록에 추가 */
  pendingMis?: string[][];
};

export async function saveQuestion(ctx: Ctx, q: QIn, folderId?: string | null) {
  q = q || {};
  const subject = str(q.subject).trim();
  let conceptIds = strArr(q.conceptIds);
  // AI가 제안한 '새 개념'은 개념지도 노드로 자동 생성
  const newNames = strArr(q.newConcepts).map((n) => n.trim()).filter(Boolean);
  if (newNames.length && subject) {
    const exist = must(await ctx.sb.from('concepts').select('id, name').eq('subject', subject));
    const add: TablesInsert<'concepts'>[] = [];
    newNames.forEach((n) => {
      const hit = exist.find((c) => c.name === n) ?? add.find((c) => c.name === n);
      if (hit) return conceptIds.push(hit.id!);
      const c = { id: uid('c_'), subject, name: n, x: 200 + Math.round(Math.random() * 900), y: 150 + Math.round(Math.random() * 450) };
      add.push(c);
      conceptIds.push(c.id);
    });
    if (add.length) {
      must(await ctx.sb.from('concepts').insert(add));
      await autoLinkConcepts(ctx, subject, add.map((c) => c.id!));   // 새 개념: 관련 있는 기존 개념과 처음 연결
    }
  }
  conceptIds = uniq(conceptIds);
  const short = q.type === 'short';
  const choices = short ? [] : strArr(q.choices);
  const choiceImages = choices.map((_, i) => validImage(strArr(q.choiceImages)[i]));
  if (choices.some((c, i) => !c.trim() && !choiceImages[i])) throw new ApiError('빈 선지가 있어요. 내용을 입력하거나 그림을 넣어 주세요.');
  const answer = str(q.answer);
  const { names: misNames, ids: misIds } = await linkChoiceMis(ctx, subject, conceptIds, choices, answer, q.choiceMis, q.pendingMis);
  const rec = {
    folder_id: (folderId != null ? str(folderId) : str(q.folderId)) || null,
    title: str(q.title).trim() || str(q.stem).slice(0, 20) || '제목 없음',
    subject, type: short ? 'short' : 'mc', stem: str(q.stem),
    choices, answer,
    explanation: str(q.explanation), image_url: str(q.imageUrl), concept_ids: conceptIds,
    misconceptions: misNames, choice_mis_ids: misIds, choice_images: choiceImages,
    code: str(q.code).trim(), figure: str(q.figure),
    // 기본 세트 문항을 고치면 그때부터 이 교사의 문항 (나중에 기본 세트를 다시 넣어도 지워지지 않게)
    sample_key: null,
  };
  let saved = q.id
    ? must(await ctx.sb.from('questions').update(rec).eq('id', str(q.id)).select()).at(0)
    : undefined;
  if (!saved) saved = must(await ctx.sb.from('questions').insert({ ...rec, id: uid('q_') }).select().single());
  return { bank: await bank(ctx), question: M.question(saved), concepts: await conceptsLite(ctx), miscons: await getMisconceptions(ctx) };
}

const normName = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** 그림 주소: 기본 세트 그림(/sample/…) 또는 http(s) 주소만 */
const validImage = (u: unknown) => { const s = str(u).trim(); return /^(\/sample\/[\w.-]+|https?:\/\/\S+)$/.test(s) ? s : ''; };
const arr2 = (v: unknown, i: number) => {
  const a = Array.isArray(v) ? v[i] : undefined;
  return (Array.isArray(a) ? a : typeof a === 'string' && a ? [a] : []).map((x) => str(x).trim()).filter(Boolean);
};

/**
 * 선지별 오개념 정리 (선지 하나에 여러 개):
 *  - 연결된 id 는 그 과목 오개념 목록에 있는 것만 남기고 이름을 다시 채움
 *  - 이름만 있는 것(pending)은 목록에서 같은 이름을 찾아 연결하고, 없으면 문제의 개념에 딸린 새 오개념으로 추가
 *  - 정답 선지는 비움
 * 반환값은 DB 열 형식 (선지마다 ',' 로 이은 id · 줄바꿈으로 이은 이름)
 */
async function linkChoiceMis(ctx: Ctx, subject: string, conceptIds: string[], choices: string[], answer: string, idsIn: unknown, pendingIn: unknown) {
  if (!choices.length) return { names: [] as string[], ids: [] as string[] };
  const list = subject ? must(await ctx.sb.from('misconceptions').select('id, name').eq('subject', subject)) : [];
  const add: TablesInsert<'misconceptions'>[] = [];
  const ans = new Set(M.answerNos(answer));
  const ids: string[][] = [], names: string[][] = [];
  choices.forEach((_, i) => {
    const ci: string[] = [], cn: string[] = [];
    const put = (id: string, name: string) => { if (!ci.includes(id)) { ci.push(id); cn.push(name); } };
    if (!ans.has(i + 1)) {
      arr2(idsIn, i).forEach((id) => { const hit = list.find((m) => m.id === id); if (hit) put(hit.id, hit.name); });
      if (subject) {
        arr2(pendingIn, i).forEach((name) => {
          const hit = list.find((m) => normName(m.name) === normName(name)) ?? add.find((m) => normName(m.name) === normName(name));
          if (hit) return put(hit.id!, hit.name);
          const m = { id: uid('m_'), subject, name, description: '', concept_ids: conceptIds };
          add.push(m);
          put(m.id, m.name);
        });
      }
    }
    ids.push(ci); names.push(cn);
  });
  if (add.length) must(await ctx.sb.from('misconceptions').insert(add));
  return { names: names.map(M.joinNames), ids: ids.map(M.joinIds) };
}

/* ---------- 이미지 업로드 (기존: 구글 드라이브 → Supabase Storage) ---------- */
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

export async function uploadImage(ctx: Ctx, dataUrl: unknown) {
  const m = str(dataUrl).match(/^data:(.+?);base64,(.*)$/);
  if (!m || !EXT[m[1]]) throw new ApiError('이미지 형식이 올바르지 않아요. (jpg, png, gif, webp)');
  return storeImage(ctx, Buffer.from(m[2], 'base64'), m[1]);
}

async function storeImage(ctx: Ctx, bytes: Buffer, type: string) {
  if (bytes.length > 5 * 1024 * 1024) throw new ApiError('이미지가 너무 커요. (5MB 이하)');
  const path = `${ctx.uid}/${crypto.randomUUID()}.${EXT[type]}`;
  const { error } = await ctx.sb.storage.from('question-images').upload(path, bytes, { contentType: type });
  if (error) throw new ApiError('이미지 업로드 실패: ' + error.message, 500);
  return { url: ctx.sb.storage.from('question-images').getPublicUrl(path).data.publicUrl };
}

/**
 * 챗봇의 그림 만들기 ('AI로 이미지 만들기' 체크 또는 "그림도 만들어줘"): 문제 내용에 어울리는 그림을 만들어 저장소에 올림.
 * request = 교사가 채팅에 쓴 그림 요청 (예: "공이 올라가는 모습으로 그려줘")
 */
export async function aiImage(ctx: Ctx, q: Partial<M.Question>, request?: unknown) {
  if (!str(q?.stem).trim()) throw new ApiError('발문이 있어야 그림을 만들 수 있어요.');
  const choices = strArr(q?.choices).filter(Boolean);
  const ask = str(request).trim().slice(0, 300);
  const prompt = '한국 중·고등학교 시험지에 들어갈 깔끔한 교과서 삽화. 흰 배경, 단순한 선과 색, 글자·숫자·보기 번호는 넣지 마. ' +
    '정답을 드러내지 말고 문제 상황만 그려.\n과목: ' + (str(q?.subject) || '미정') + '\n문제: ' + str(q?.stem).slice(0, 1500) +
    (choices.length ? '\n선지: ' + choices.join(' / ').slice(0, 600) : '') + (ask ? '\n교사 요청: ' + ask : '');
  const im = must(await ctx.sb.from('teacher_settings').select('image_model').maybeSingle());
  const img = await openaiImage(prompt, im?.image_model || undefined);
  return { ...(await storeImage(ctx, img.bytes, img.type)), ...(img.note ? { note: img.note } : {}) };
}

/* ---------- 직접 입력한 문제 서식 정리 ---------- */
type RawQ = {
  title?: string; type?: string; subject?: string; stem?: string; choices?: string[]; answer?: unknown;
  explanation?: string; concepts?: string[]; misconceptions?: string[];
};

/** API 키 없이 직접 입력한 문제를 대략 정리 (legacy localParse_) */
export function localParse(text: string): RawQ {
  let lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const exp: string[] = [];
  lines.forEach((l) => {
    // 한 줄에 보기가 여러 개면 나눔 (단, '정답: ①, ③' 처럼 정답 줄은 그대로)
    if ((l.match(/[①②③④⑤]/g) || []).length >= 2 && !/^(?:정답|답)\s*[:：)]?/.test(l)) l.split(/(?=[①②③④⑤])/).forEach((p) => p.trim() && exp.push(p.trim()));
    else exp.push(l);
  });
  lines = exp;
  const choiceRe = /^(?:[①②③④⑤⑥]|\(?[1-6][\).]|[A-Fa-f][\).]|[ㄱ-ㅂ][\).])\s*/;
  const stem: string[] = [], choices: string[] = [];
  let answer = '', explanation = '', mode = 'stem';
  for (const l of lines) {
    let m;
    if ((m = l.match(/^(?:정답|답)\s*[:：)]?\s*(.+)$/))) { answer = m[1].trim(); mode = 'ans'; continue; }
    if ((m = l.match(/^(?:해설|풀이)\s*[:：)]?\s*(.*)$/))) { explanation = m[1].trim(); mode = 'exp'; continue; }
    if (mode === 'exp') { explanation += '\n' + l; continue; }
    if (choiceRe.test(l) && mode !== 'ans' && (stem.length || choices.length)) { choices.push(l.replace(choiceRe, '')); mode = 'ch'; continue; }
    if (mode === 'ch' && choices.length) { choices[choices.length - 1] += ' ' + l; continue; }
    stem.push(l);
  }
  if (/^[A-Fa-f]$/.test(answer)) answer = String('abcdef'.indexOf(answer.toLowerCase()) + 1);
  const st = stem.join('\n');
  return {
    title: st.replace(/^\d+[\.)]\s*/, '').slice(0, 20), type: choices.length ? 'mc' : 'short',
    stem: st.replace(/^\d+[\.)]\s*/, ''), choices, answer, explanation, concepts: [], misconceptions: [],
  };
}

/** AI/규칙으로 만든 문제를 저장 형식으로 (legacy normalizeAiQ_) */
export async function normalizeQ(ctx: Ctx, q: RawQ, subject: string) {
  q = q || {};
  const type = q.type === 'short' || !q.choices || !q.choices.length ? 'short' : 'mc';
  const choices = type === 'mc' ? strArr(q.choices).map((c) => c.replace(/^\s*(?:[①②③④⑤⑥]|\(?[1-6][\).])\s*/, '')) : [];
  let answer = str(q.answer).trim();
  if (type === 'mc') {
    // '③', '3', '1, 3', '①③', '1|3' → '3' 또는 '1|3' (정답이 여러 개면 모두 골라야 정답)
    const nos = (answer.replace(/[①②③④⑤⑥⑦⑧]/g, (c) => ' ' + ('①②③④⑤⑥⑦⑧'.indexOf(c) + 1) + ' ').match(/\d+/g) ?? [])
      .map(Number).filter((n) => n >= 1 && n <= choices.length);
    answer = M.answerNos(nos.join('|')).join('|');
  }
  const subj = str(q.subject || subject);
  const nodes = subj ? must(await ctx.sb.from('concepts').select('id, name').eq('subject', subj)) : [];
  const conceptIds: string[] = [], newConcepts: string[] = [];
  strArr(q.concepts).forEach((name) => {
    name = name.trim();
    if (!name) return;
    const hit = nodes.find((c) => c.name === name);
    if (hit) conceptIds.push(hit.id);
    else newConcepts.push(name);
  });
  const ans = new Set(M.answerNos(answer));
  const mis = choices.map((_, i) => (ans.has(i + 1) ? '' : str(strArr(q.misconceptions)[i]).trim()));
  const list = subj && type === 'mc' ? must(await ctx.sb.from('misconceptions').select('id, name').eq('subject', subj)) : [];
  const hitOf = (n: string) => (n ? list.find((m) => normName(m.name) === normName(n)) : undefined);
  return {
    id: '', title: str(q.title).slice(0, 40), subject: subj, type, stem: str(q.stem), choices, answer,
    explanation: str(q.explanation), imageUrl: '', conceptIds, newConcepts,
    choiceMis: mis.map((n) => (hitOf(n) ? [hitOf(n)!.id] : [])),
    pendingMis: mis.map((n) => (n && !hitOf(n) ? [n] : [])),
  };
}

/* ---------- OpenAI 문제 만들기 · 정리 (legacy Code.js 프롬프트 그대로) ---------- */
const Q_FORMAT =
  '{"title":"문제 제목(20자 이내)","type":"mc 또는 short","stem":"문항 본문",' +
  '"choices":["선지1","선지2",...] (객관식은 4~5개, 단답형은 []),' +
  '"answer":"객관식은 정답 번호(1부터 시작하는 숫자, 정답이 여러 개면 1|3 처럼 | 로 구분하고 학생은 모두 골라야 정답), 단답형은 정답 텍스트(여러 개 허용 시 | 로 구분)",' +
  '"explanation":"해설",' +
  '"concepts":["이 문제와 관련된 핵심 개념 이름 1~3개"],' +
  '"misconceptions":["각 선지를 고른 학생이 가질 법한 오개념 (선지 순서와 동일, 정답 선지는 빈 문자열)"]}';

async function conceptHint(ctx: Ctx, subject: string) {
  if (!subject) return '';
  const [c, m] = await Promise.all([
    ctx.sb.from('concepts').select('name').eq('subject', subject),
    ctx.sb.from('misconceptions').select('name').eq('subject', subject),
  ]);
  const names = must(c).map((x) => x.name), mis = must(m).map((x) => x.name);
  return (names.length ? '\n개념(concepts)은 가능하면 다음 목록의 이름을 그대로 사용해: ' + JSON.stringify(names) : '') +
    (mis.length ? '\n선지별 오개념(misconceptions)은 가능하면 다음 오개념 목록의 문장을 그대로 사용해: ' + JSON.stringify(mis.slice(0, 200)) : '');
}

type ChatTurn = { role?: string; content?: unknown };

/**
 * 출제 챗봇: 대화 기록(최근 12개)을 보내고 {reply, mode, question|null} 을 받음.
 * current = 교사가 편집 창에서 보고 있는 문제 → 고쳐 달라고 하면 mode 'edit' 로 고친 전체 문제를 돌려줌
 */
export async function aiChat(ctx: Ctx, history: ChatTurn[], subjectIn: unknown, current?: RawQ | null, hintIn?: unknown) {
  const hint = str(hintIn);   // 화면이 말에서 판단한 의도: 'new' | 'edit' | ''
  const subject = str(subjectIn);
  const cur = current && str(current.stem) ? {
    title: str(current.title), type: current.type === 'short' ? 'short' : 'mc', stem: str(current.stem),
    choices: strArr(current.choices), answer: str(current.answer), misconceptions: strArr(current.misconceptions),
  } : null;
  const sys = '너는 한국 중·고등학교 교사의 수업용 문항 출제를 돕는 조수야. 반드시 JSON 객체 하나로만 답해.\n' +
    '형식: {"reply":"교사에게 하는 짧은 한국어 답변","mode":"new 또는 edit","image":true 또는 false,"question": null 또는 ' + Q_FORMAT + '}\n' +
    '교사가 문제를 만들어 달라고 하면 mode "new"로 question을 채우고(한 번에 1문제), 그 외의 대화면 question은 null.\n' +
    '교사가 그림(이미지 · 삽화)을 만들어 달라거나 넣어 달라고 하면 image 를 true 로 해. 그림은 이 앱이 따로 그려서 문제에 넣으니 ' +
    '"그림을 만들 수 없다"고 하지 말고 reply 에 "그림을 만들어 넣을게요"처럼 답해. 그림만 요청했으면 question 은 null.\n' +
    (cur ? '교사가 지금 편집 창에서 보고 있는 문제(current): ' + JSON.stringify(cur) + '\n' +
      '교사가 이 문제(선지·발문·정답 등)를 고쳐 달라고 하면 mode "edit"로 하고 question에 고친 "전체" 문제를 넣어. 바꾸라고 하지 않은 부분은 그대로 둬. ' +
      '"새 문제", "하나 더", "다른 문제"처럼 새로 만들어 달라는 말일 때만 mode "new" 야.\n' +
      (hint === 'edit' ? '이번 말은 지금 보고 있는 문제(current)를 고쳐 달라는 요청이야. 반드시 mode "edit".\n' : hint === 'new' ? '이번 말은 새 문제를 만들어 달라는 요청이야. mode "new".\n' : '') : '') +
    '수식은 일반 텍스트로(예: v = 2t + 3, x², ½mv²) 작성. 과목: ' + (subject || '미정') + (await conceptHint(ctx, subject));
  const msgs: ChatMessage[] = [
    { role: 'system', content: sys },
    ...(Array.isArray(history) ? history : []).slice(-12).map((m): ChatMessage => ({
      role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.content).slice(0, 8000),
    })),
  ];
  const r = await openaiJson<{ reply?: string; mode?: string; image?: unknown; question?: RawQ | null }>(ctx, msgs);
  return {
    reply: str(r.reply), mode: cur && r.mode === 'edit' ? 'edit' : 'new', image: r.image === true || r.image === 'true',
    question: r.question ? await normalizeQ(ctx, r.question, subject) : null,
  };
}

/** 선지 추가: 교사가 선지마다 정해 둔 오개념을 가진 학생이 고를 법한 오답 선지를 AI가 만듦 */
export async function aiChoices(ctx: Ctx, q: RawQ, targetsIn: unknown) {
  const targets = (Array.isArray(targetsIn) ? targetsIn : [])
    .map((t: { index?: unknown; mis?: unknown }) => ({ index: Number(t?.index), mis: str(t?.mis).trim() }))
    .filter((t) => Number.isInteger(t.index) && t.index >= 0);
  if (!targets.length) throw new ApiError('내용을 만들 빈 선지가 없어요.');
  const sys = '너는 한국 중·고등학교 객관식 문항의 오답 선지를 만드는 출제 전문가야. 반드시 JSON 객체 하나로만 답해.\n' +
    '주어진 문제의 빈 선지 자리(index, 0부터)마다, 지정된 오개념(mis)을 가진 학생이 정답이라고 믿고 고를 만한 오답 선지를 한 문장으로 만들어. ' +
    '오개념이 비어 있으면 그럴듯한 오답을 만들어. 다른 선지와 길이·말투를 맞추고, 번호(①, 1.)는 붙이지 마.\n' +
    '형식: {"choices":[{"index":0,"text":"선지"}]}';
  const input = {
    subject: str(q?.subject), stem: str(q?.stem),
    choices: strArr(q?.choices).map((c, i) => ({ index: i, text: c, correct: str(q?.answer).split('|').includes(String(i + 1)) })),
    targets,
  };
  const r = await openaiJson<{ choices?: { index?: unknown; text?: unknown }[] }>(ctx, [
    { role: 'system', content: sys }, { role: 'user', content: JSON.stringify(input) },
  ]);
  const want = new Set(targets.map((t) => t.index));
  return (Array.isArray(r.choices) ? r.choices : [])
    .map((c) => ({ index: Number(c?.index), text: str(c?.text).replace(/^\s*(?:[①②③④⑤⑥]|\(?[1-6][\).])\s*/, '').trim() }))
    .filter((c, i, arr) => want.has(c.index) && c.text && arr.findIndex((x) => x.index === c.index && x.text) === i);   // 자리마다 하나만
}

/** 직접 입력한 문제 정리: 키가 있으면 AI, 없으면 규칙 기반 (legacy aiFormat_) */
export async function aiFormat(ctx: Ctx, textIn: unknown, subjectIn: unknown) {
  const text = str(textIn), subject = str(subjectIn);
  if (!hasOpenAI()) {
    return {
      question: await normalizeQ(ctx, localParse(text), subject),
      note: 'API 키가 없어 기본 규칙으로 정리했어요. (Vercel 환경변수 OPENAI_API_KEY 를 설정하면 AI가 더 정확히 정리해요)',
    };
  }
  const sys = '너는 교사가 직접 입력한 문제를 정해진 서식으로 정리하는 도우미야. 문항 내용은 바꾸지 말고 구조만 정리해. ' +
    '정답이 명시되지 않았다면 가장 타당한 정답을 추정해 넣고, 해설과 선지별 오개념도 채워줘. 반드시 JSON 객체 하나로만 답해.\n' +
    '형식: {"reply":"짧은 안내","question":' + Q_FORMAT + '}\n과목: ' + (subject || '미정') + (await conceptHint(ctx, subject));
  const r = await openaiJson<{ reply?: string; question?: RawQ } & RawQ>(ctx, [
    { role: 'system', content: sys }, { role: 'user', content: text.slice(0, 12000) },
  ]);
  return { question: await normalizeQ(ctx, r.question || r, subject), note: str(r.reply) };
}
