/*
 * 학생 화면 글자 번역 파일 만들기 — npm run i18n:student
 *   1) 학생 화면 · 학생 API 소스에서 한글이 든 '…' 글을 모아 (화면 글자 + 서버 오류 문구)
 *   2) src/lib/langs.ts 의 언어마다 public/i18n/student/<언어>.json 에 { "한국어": "번역" } 으로 저장
 *   이미 번역한 글은 그대로 두고 빠진 것만 OpenAI 로 번역해요 (소스에서 사라진 글은 지움).
 *   전부 다시 번역: npm run i18n:student -- --all     특정 언어만: npm run i18n:student -- en ja
 *   필요: .env.local 의 OPENAI_API_KEY (모델은 OPENAI_TRANSLATE_MODEL, 기본 gpt-6-luna)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const SOURCES = [
  'src/app/student/student-app.tsx',
  'src/app/student/i18n.tsx',
  'src/components/site-footer.tsx',
  'src/server/student.ts',
  'src/app/api/student/route.ts',
  'src/lib/rpc.ts',
  'src/lib/live.ts',
];
const OUT = 'public/i18n/student';
/** 짧아서 뜻이 헷갈리는 글의 쓰임 (번역할 때 함께 보내요) */
const NOTES = {
  '{n}번 틀림': 'badge: the student got this question wrong {n} times',
  '{n}문제': 'count: {n} questions in the list',
  '{n}번 문제': 'heading: question number {n}',
  '{n}번 보기 그림': 'image alt text: picture for answer choice number {n}',
  '보기': 'button to expand an item and show its details (not "answer choice")',
  '접기': 'button to collapse an expanded item',
  '정답': 'label: the correct answer',
  '내 답': 'small tag on the choice the student picked',
  '처음으로': 'link back to the first login step',
  '들어가기': 'login button: enter the class',
  '끝난 수업에서 틀린 문제가 없어요. 잘했어요!': 'shown when the list of wrongly answered questions from finished classes is empty',
  '틀린 문제 다시 보기': 'button: review the questions I got wrong',
  '정답 {n}개를 고르세요': 'instruction: choose {n} correct answer (here {n} is always 1)',
};
const HANGUL = /[가-힣]/;

// 주석은 빼고, 작은따옴표 글 중 한글이 든 것 (템플릿 문자열 `${}` 은 고정 글이 아니라 빼요)
const strings = new Set();
for (const f of SOURCES) {
  const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
    const s = m[1].replace(/\\'/g, "'");
    if (HANGUL.test(s)) strings.add(s);
  }
}
const all = [...strings].sort();

const langsSrc = readFileSync('src/lib/langs.ts', 'utf8');
const langs = [...langsSrc.matchAll(/\{ code: '([a-z-]+)', native: '[^']*', ko: '[^']*', en: '([^']*)'/g)]
  .map((m) => ({ code: m[1], en: m[2] })).filter((l) => l.code !== 'ko');

const args = process.argv.slice(2);
const redo = args.includes('--all');
const only = args.filter((a) => !a.startsWith('--'));
const key = String(process.env.OPENAI_API_KEY || '').trim().replace(/(\\[nr])+$/, '').trim();
if (!key) { console.error('OPENAI_API_KEY 가 없어요 (.env.local)'); process.exit(1); }
const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const model = process.env.OPENAI_TRANSLATE_MODEL || 'gpt-6-luna';

async function translate(langName, items) {
  const sys = [
    `You translate the user interface of a Korean classroom quiz app for secondary-school students into ${langName}.`,
    'The students are learning in a Korean school and may still be learning Korean. Use short, friendly, natural wording a teenager understands.',
    '- 학습코드 = the 4-digit class code the teacher gives; 학번 = student ID number (e.g. 30301); 선생님 = the teacher.',
    '- notes_by_index explains how some short items are used on screen; translate only the items, not the notes.',
    '- Keep placeholders like {n} and {no} exactly. Keep symbols such as ‹ ▲ ▼ · … and example numbers.',
    `Return JSON {"t": [...]} with exactly ${items.length} strings in the same order as the input.`,
  ].join('\n');
  for (let attempt = 1; ; attempt++) {
    try {
      const notes = Object.fromEntries(items.map((s, i) => [i, NOTES[s]]).filter(([, n]) => n));
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ items, notes_by_index: notes }) }], response_format: { type: 'json_object' } }),
        signal: AbortSignal.timeout(180_000),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || res.status);
      const t = JSON.parse(j.choices[0].message.content).t;
      if (!Array.isArray(t) || t.length !== items.length) throw new Error(`count ${t?.length}/${items.length}`);
      const bad = items.findIndex((s, i) => (s.match(/\{\w+\}/g) ?? []).some((p) => !String(t[i]).includes(p)));
      if (bad >= 0) throw new Error(`placeholder lost: ${items[bad]}`);
      return t.map(String);
    } catch (e) {
      if (attempt >= 3) throw e;
      console.warn(`  다시 시도 (${e.message})`);
    }
  }
}

mkdirSync(OUT, { recursive: true });
console.log(`화면 글자 ${all.length}개 · 언어 ${langs.length}개 · 모델 ${model}`);
await Promise.all(langs.filter((l) => !only.length || only.includes(l.code)).map(async (l) => {
  const file = `${OUT}/${l.code}.json`;
  const old = !redo && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const miss = all.filter((s) => !old[s]);
  const next = {};
  all.forEach((s) => old[s] && (next[s] = old[s]));
  for (let i = 0; i < miss.length; i += 40) {
    const part = miss.slice(i, i + 40);
    const t = await translate(l.en, part);
    part.forEach((s, k) => (next[s] = t[k]));
  }
  const sorted = Object.fromEntries(all.filter((s) => next[s]).map((s) => [s, next[s]]));
  writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`${l.code}: ${miss.length}개 새로 번역 (전체 ${Object.keys(sorted).length})`);
}));
