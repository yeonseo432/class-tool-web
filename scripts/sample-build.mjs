#!/usr/bin/env node
/**
 * 기본 문항 세트 만들기: 내보낸 최종 세트 + 그림 → src/server/seed/physics-items.json · public/sample/*.svg
 *   npm run sample:build                 (data/sample-export.json 을 읽음)
 *   npm run sample:build -- --from 파일.json
 *   npm run sample:build -- --from 파일.json --provisional   임시 세트 (새 계정에만 들어가고, 이미 세트가 있는 계정은 그대로)
 *
 * - 그림은 scripts/sample-figures.mjs 에서 문항 번호별로 그려요 (상황 그림 + 그림 선지).
 *   그림 선지는 글을 지우고 그림만 남겨요 (글은 SVG 의 <title> 로 남아 화면 읽기 프로그램용 설명이 돼요).
 *   그림을 그릴 때 기준으로 삼은 선지 글이 지금 선지와 하나라도 다르면 그 문항은 그림 선지를 쓰지 않고 글 선지를 그대로 두고 경고해요
 *   (→ 그림을 고쳐 그려야 한다는 뜻). 그림 설명 글(data/physics-items.json 기준)이 바뀌어도 경고해요.
 * - 문항 · 오개념 · 개념이 바뀌면 version 을 1 올려요 → 교사가 다음에 접속할 때 기본 세트를 새로 넣어요
 *   (예전 기본 문항은 지우고 새로 넣음 · 교사가 직접 만들었거나 고친 문항은 그대로).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIGURES, slug } from './sample-figures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = path.resolve(ROOT, arg('from', 'data/sample-export.json'));
const SEED = path.join(ROOT, 'src/server/seed/physics-items.json');
const PROVISIONAL = process.argv.includes('--provisional');
const IMG_DIR = path.join(ROOT, 'public/sample');

const src = JSON.parse(readFileSync(FROM, 'utf8'));
/** 그림을 그릴 때 기준으로 삼은 그림 설명 글 (예전 원본) */
const BASIS = new Map(JSON.parse(readFileSync(path.join(ROOT, 'data/physics-items.json'), 'utf8')).questions.map((q) => [q.code, q.figure ?? '']));
/**
 * 내보낸 세트에서 선지에 오개념이 하나도 연결되지 않은 문항에만 넣는 연결 (문항 단위 오개념을 선지로 옮김).
 * { 문항 번호: { 선지 번호: [오개념 이름] } }
 */
const CHOICE_MIS_FIX = {
  '열 1-5': { 3: ['얼음의 온도는 항상 0도이다.'] },   // ③ 0°C
};
const own = (u) => (u && !String(u).startsWith('/sample/') ? u : '');
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const old = existsSync(SEED) ? JSON.parse(readFileSync(SEED, 'utf8')) : {};

/** 예전 세트들에 있던 이름 (교사 계정에서 예전 기본 문항 · 개념 · 오개념을 찾아 지울 때 사용) */
function previousOf(s) {
  if (!s.questions) return { codes: [], concepts: [], misconceptions: [] };
  if (s.version) return s.previous;   // v2 이상
  // v1 (예전 형식): 문항 번호 · 문항에 붙은 개념 + 단원 · 오개념 이름
  return {
    codes: s.questions.map((q) => q.code),
    concepts: [...new Set([...(s.units ?? []), ...s.questions.flatMap((q) => q.concepts ?? [])])],
    misconceptions: (s.misconceptions ?? []).map((m) => m.name),
  };
}
const uniq = (a) => [...new Set(a.filter(Boolean))];
const prev = previousOf(old);

const warn = [];
mkdirSync(IMG_DIR, { recursive: true });
const written = new Set();
/** 고친 그림(scripts/figure-fix-r1.mjs 가 만든 *-r1.svg)이 있으면 그 그림을 쓰고 지우지 않음 */
const useR1 = (f) => {
  const r1 = f.replace(/\.svg$/, '-r1.svg');
  if (!existsSync(path.join(IMG_DIR, r1))) return f;
  written.add(r1);
  return r1;
};
function fixMis(q) {
  const fix = CHOICE_MIS_FIX[q.code];
  if (!fix || q.choiceMis.some((a) => a.length)) return q.choiceMis;
  return q.choiceMis.map((a, i) => fix[i + 1] ?? a);
}
const questions = src.questions.map((q) => {
  const fig = FIGURES[q.code];
  const out = {
    folder: q.folder, code: q.code, title: q.title, subject: q.subject, type: q.type, stem: q.stem,
    choices: q.choices.slice(), answer: q.answer, explanation: q.explanation ?? '', concepts: q.concepts,
    choiceMis: fixMis(q),
    // 교사가 직접 올린 그림은 그대로 (예전에 이 스크립트가 만든 /sample/ 그림은 다시 그림)
    image: own(q.image), choiceImages: q.choices.map((_, i) => own(q.choiceImages?.[i])),
  };
  /** i번 선지 글 (이미 그림 선지로 바뀐 세트를 다시 내보낸 경우엔 그 그림의 기준 글) */
  const textOf = (i) => q.choices[i] || (fig?.choices?.[i] && q.choiceImages?.[i] === `/sample/${slug(q.code)}-c${i + 1}.svg` ? fig.choices[i].forText : q.choices[i]);
  for (const n of new Set(fixMis(q).flat())) if (!src.misconceptions.some((m) => m.subject === q.subject && m.name === n)) warn.push(`${q.code}: 선지에 연결된 오개념 '${n}' 이 오개념 목록에 없어요 (빠짐)`);
  if (q.questionMis?.length && !fixMis(q).some((a) => a.length)) warn.push(`${q.code}: 문항 단위 오개념만 있고 선지에는 연결되지 않았어요`);
  if (!fig) {
    if (q.figure?.trim()) warn.push(`${q.code}: 그림 설명이 있는데 그림이 없어요 → scripts/sample-figures.mjs 에 추가 필요`);
    return out;
  }
  if (BASIS.has(q.code) && q.figure?.trim() && norm(q.figure) !== norm(BASIS.get(q.code))) warn.push(`${q.code}: 그림 설명 글이 바뀌었어요 → 그림 확인 필요\n      지금: ${norm(q.figure)}`);
  if (fig.figure) {
    const f = `${slug(q.code)}.svg`;
    writeFileSync(path.join(IMG_DIR, f), fig.figure);
    written.add(f);
    out.image = '/sample/' + useR1(f);
  }
  if (fig.choices) {
    const changed = fig.choices.length !== q.choices.length || fig.choices.some((c, i) => norm(c.forText) !== norm(textOf(i)));
    if (changed) {
      warn.push(`${q.code}: 선지 글이 그림 기준과 달라 그림 선지 없이 글 선지로 넣었어요 → 그림 선지를 고쳐 그려야 해요`);
      fig.choices.forEach((c, i) => { if (norm(c.forText) !== norm(textOf(i))) warn.push(`      ${i + 1}번: 그림 기준 "${c.forText}" → 지금 "${textOf(i) ?? '(없음)'}"`); });
      if (q.choices.length > fig.choices.length) warn.push(`      선지 ${q.choices.length}개 (그림 ${fig.choices.length}개)`);
      out.choices = q.choices.map((_, i) => textOf(i) ?? '');
      return out;
    }
    fig.choices.forEach((c, i) => {
      const f = `${slug(q.code)}-c${i + 1}.svg`;
      writeFileSync(path.join(IMG_DIR, f), c.svg);
      written.add(f);
      out.choiceImages[i] = '/sample/' + useR1(f);
      out.choices[i] = '';   // 그림 선지는 글을 지움 (설명은 SVG <title>)
    });
  }
  return out;
});
// 쓰지 않는 예전 그림 파일 정리
for (const f of readdirSync(IMG_DIR)) if (f.endsWith('.svg') && !written.has(f)) rmSync(path.join(IMG_DIR, f));

/*
 * 임시 개념 (data/extra-concepts.json): 다른 과목 · 물리학의 다른 단원에도 개념 지도를 미리 만들어 둠.
 * 단원 노드는 위쪽 한 줄, 개념은 단원 아래 두 줄로. 같은 이름 개념이 이미 있으면 그대로 둠.
 */
const concepts = src.concepts.map((c) => ({ ...c })), links = src.links.slice(), subjects = src.subjects.slice();
const EXTRA_FILE = path.join(ROOT, 'data/extra-concepts.json');
if (existsSync(EXTRA_FILE)) {
  const extra = JSON.parse(readFileSync(EXTRA_FILE, 'utf8'));
  for (const s of extra.subjects) {
    if (!subjects.includes(s.subject)) subjects.push(s.subject);
    Object.entries(s.units).forEach(([unit, names], k) => {
      const ux = s.x0 + 100 + k * 440;
      const u = concepts.find((c) => c.subject === s.subject && c.name === unit);
      if (u) Object.assign(u, { kind: 'unit', x: ux, y: 110 });
      else concepts.push({ subject: s.subject, name: unit, kind: 'unit', unit: '', x: ux, y: 110, desc: '' });
      names.forEach((name, i) => {
        if (concepts.some((c) => c.subject === s.subject && c.name === name)) return;
        concepts.push({ subject: s.subject, name, kind: 'concept', unit, x: ux - 100 + (i % 2) * 200, y: 300 + Math.floor(i / 2) * 140 + (i % 2) * 30, desc: extra.desc ?? '' });
        if (!links.some((l) => l.subject === s.subject && l.from === unit && l.to === name)) links.push({ subject: s.subject, from: unit, to: name });
      });
    });
  }
}

/*
 * 개념 ↔ 개념 연결 (data/concept-links.json): 있으면 단원 → 개념 연결선은 빼고(단원 소속은 지도에 옅은 점선) 개념끼리 이어요.
 */
const LINKS_FILE = path.join(ROOT, 'data/concept-links.json');
if (existsSync(LINKS_FILE)) {
  const cl = JSON.parse(readFileSync(LINKS_FILE, 'utf8')).subjects;
  const kindOf = new Map(concepts.map((c) => [c.subject + '\u0000' + c.name, c.kind]));
  const isUnit = (s, n) => kindOf.get(s + '\u0000' + n) === 'unit';
  for (let i = links.length - 1; i >= 0; i--) if (cl[links[i].subject] && (isUnit(links[i].subject, links[i].from) || isUnit(links[i].subject, links[i].to))) links.splice(i, 1);
  for (const [subject, pairs] of Object.entries(cl)) {
    for (const [from, to] of pairs) {
      const bad = [from, to].filter((n) => kindOf.get(subject + '\u0000' + n) !== 'concept');
      if (bad.length) { warn.push(`개념 연결 ${subject}: '${bad.join("', '")}' 개념이 없어요 (${from} → ${to} 빠짐)`); continue; }
      if (!links.some((l) => l.subject === subject && ((l.from === from && l.to === to) || (l.from === to && l.to === from)))) links.push({ subject, from, to });
    }
  }
}

const body = {
  subjects,
  rootFolder: src.folders[0][0],
  folders: src.folders,
  concepts,
  links,
  misconceptions: src.misconceptions,
  questions,
};
const same = old.version && JSON.stringify({ ...body }) === JSON.stringify({
  subjects: old.subjects, rootFolder: old.rootFolder, folders: old.folders, concepts: old.concepts, links: old.links, misconceptions: old.misconceptions, questions: old.questions,
});
const version = same ? old.version : (old.version ?? 1) + 1;
const seed = {
  _about: '모든 교사 계정에 들어가는 기본 문항 세트 — scripts/sample-build.mjs 로 만든 파일이에요 (직접 고치지 말고 다시 만들어 주세요). ' + (PROVISIONAL ? '임시 세트 (예전 기본 세트 내용 + 그림, 최종 계정에서 내보내기 전) — npm run sample:update 로 바꿔 주세요.' : String(src._about ?? '').replace(/[^\s'"]+@[^\s'"]+ 계정/g, '기준 교사 계정')),   // 공개 저장소: 이메일은 넣지 않음
  version,
  ...(PROVISIONAL ? { provisional: true } : {}),
  ...body,
  previous: {
    codes: uniq([...prev.codes, ...(old.version ? old.questions.map((q) => q.code) : [])]),
    concepts: uniq([...prev.concepts, ...(old.version ? old.concepts.map((c) => c.name) : [])]),
    misconceptions: uniq([...prev.misconceptions, ...(old.version ? old.misconceptions.map((m) => m.name) : [])]),
  },
};
writeFileSync(SEED, JSON.stringify(seed, null, 1) + '\n');
console.log(`✔ 기본 세트 v${version}${PROVISIONAL ? ' (임시)' : ''}${same ? ' (바뀐 내용 없음)' : ''}: 과목 ${subjects.length}개 · 개념 ${concepts.length}개 · 문항 ${questions.length}개 · 상황 그림 ${questions.filter((q) => q.image).length}개 · 그림 선지 ${questions.reduce((a, q) => a + q.choiceImages.filter(Boolean).length, 0)}개`);
warn.forEach((w) => console.log('  ⚠ ' + w));
