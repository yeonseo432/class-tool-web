#!/usr/bin/env node
/**
 * 문항 그림 피드백(문항그림피드백.pdf) 최소 수정 → public/sample/*-r1.svg 로 새로 저장 (원본은 그대로)
 *   node scripts/figure-fix-r1.mjs
 *  - 역학 1-6 낙하산 보기: 팔 그리기 · 화살표가 사람과 겹치지 않게 (위: 머리 위에서, 아래: 발아래에서, 길이 같음)
 * - 역학 3-5 · 3-6 · 3-7 자전거 보기: 핸들 (상황 그림처럼 앞쪽 세움대 + 손잡이), 3-6 · 3-7 ①은 힘 화살표 하나만
 *  - 역학 3-1 · 3-2 돌 보기: 점선 원 → 상황 그림과 같은 돌 모양 (가운데 점 · 화살표는 그대로)
 *  - 역학 4-2 잠수부 상황 그림: 같은 선 스타일로 몸 · 팔 · 공기통 · 물갈퀴를 다시 그림
 * - 역학 4-6 그네충돌구: 회색 화살표 · '속력 V' 글씨를 빼고 점선(공의 길)만 남김
 *  - 역학 1-4 진자: 글자 A 를 공에서 조금 떼어 놓음
 * 바꿀 부분을 찾지 못하면 멈춰요 (엉뚱한 곳이 바뀌지 않게).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample');
const read = (f) => readFileSync(path.join(DIR, f), 'utf8')
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')          // 서명 데이터(c2pa)는 새 파일에 넣지 않음
  .replace(/\s+xmlns:c2pa="[^"]*"/, '');
const out = (f) => f.replace(/\.svg$/, '-r1.svg');
const written = [];
function rep(s, from, to, label) {
  if (!s.includes(from)) throw new Error(`못 찾음 (${label}): ${from.slice(0, 80)}`);
  return s.split(from).join(to);
}
function save(f, svg) { writeFileSync(path.join(DIR, out(f)), svg); written.push(out(f)); }

/* ---------- 역학 1-6 낙하산 보기 ---------- */
const PERSON = `<g stroke="#6b7180" stroke-width="2"><circle cx="85" cy="59" r="9" fill="#fff"/><line x1="85" y1="68" x2="85" y2="94" /><line x1="85" y1="94" x2="77.5" y2="120" /><line x1="85" y1="94" x2="92.5" y2="120" /><line x1="85" y1="74" x2="68" y2="57" /><line x1="85" y1="74" x2="102" y2="57" /></g>`;
const UP = `<line x1="85" y1="48" x2="85" y2="23" stroke="#c2272d" stroke-width="3.2"/><polygon points="85,12 90,23 80.1,23" fill="#c2272d" stroke="#c2272d" stroke-width="1"/>`;
const DOWN = `<line x1="85" y1="124" x2="85" y2="149" stroke="#c2272d" stroke-width="3.2"/><polygon points="85,160 80.1,149 90,149" fill="#c2272d" stroke="#c2272d" stroke-width="1"/>`;
for (const [f, arrows] of [['mech-1-6-c1.svg', DOWN], ['mech-1-6-c2.svg', UP + DOWN], ['mech-1-6-c3.svg', '']]) {
  const s = read(f);
  const m = s.match(/^([\s\S]*?<g fill="none"[^>]*>)[\s\S]*(<\/g><\/svg>)\s*$/);
  if (!m) throw new Error('구조 다름: ' + f);
  save(f, m[1] + PERSON + arrows + m[2]);
}

/* ---------- 역학 3-5 · 3-6 · 3-7 자전거 보기: 핸들 ---------- */
const FORK = '<line x1="108" y1="88" x2="115" y2="110" />';
const HANDLE = FORK + '<line x1="108" y1="88" x2="110" y2="79" /><line x1="104" y1="79" x2="115" y2="79" />';
// 3-6 · 3-7 의 ① (힘이 점점 커진다/작아진다): 화살표 3개 · 글씨 → 3-5 ① 과 같은 화살표 하나만
const ONE_ARROW = '<line x1="115" y1="92" x2="154" y2="92" stroke="#c2272d" stroke-width="3"/><polygon points="165,92 154,97 154,87.1" fill="#c2272d" stroke="#c2272d" stroke-width="1"/>';
const RED = /<line [^>]*stroke="#c2272d"[^>]*\/><polygon [^>]*fill="#c2272d"[^>]*\/>/g;
for (const q of ['3-5', '3-6', '3-7']) for (let k = 1; k <= 5; k++) {
  const f = `mech-${q}-c${k}.svg`;
  let s = rep(read(f), FORK, HANDLE, f);
  if (k === 1 && q !== '3-5') {
    if ((s.match(RED) || []).length !== 3) throw new Error('화살표 3개가 아님: ' + f);
    s = s.replace(RED, '');
    s = s.replace(/<text [^>]*>점점 [^<]*<\/text>/, ONE_ARROW);   // '점점 커짐/작아짐' 글씨도 뺌
    if (s.includes('>점점 ')) throw new Error('글씨를 못 지움: ' + f);
  }
  save(f, s);
}

/* ---------- 역학 3-1 · 3-2 돌 보기: 점선 원 → 돌 ---------- */
// 상황 그림(mech-3-1.svg)의 돌 윤곽을 보기 크기에 맞게 줄여 가운데(85,85)로 옮김
const STONE_SRC = 'M150 150 Q 152 136 172 138 Q 190 128 206 142 Q 214 160 204 176 Q 186 190 164 184 Q 146 174 150 150 Z';
const K = 0.72, CX = 180, CY = 159;
const STONE_D = STONE_SRC.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) =>
  `${+(85 + (x - CX) * K).toFixed(1)} ${+(85 + (y - CY) * K).toFixed(1)}`);
const DASHED = '<circle cx="85" cy="85" r="24" stroke-dasharray="6 6" stroke-width="1.8"/>';
const STONE = `<path d="${STONE_D}" fill="#e6e1d8"/>`;
for (const [q, n] of [['3-1', 5], ['3-2', 4]]) for (let k = 1; k <= n; k++) {
  const f = `mech-${q}-c${k}.svg`;
  save(f, rep(read(f), DASHED, STONE, f));
}

/* ---------- 역학 4-2 잠수부 ---------- */
{
  const f = 'mech-4-2.svg';
  let s = read(f);
  const start = s.indexOf('<circle cx="160" cy="130" r="13"');
  const end = s.indexOf('<circle cx="140" cy="100" r="4"');   // 공기방울부터는 그대로
  if (start < 0 || end < 0) throw new Error('구조 다름: ' + f);
  const DIVER = [
    // 공기통 (등 위에 붙음) + 띠
    '<rect x="186" y="108" width="62" height="15" rx="7.5" fill="#f2c94c"/>',
    '<line x1="204" y1="109" x2="204" y2="122" stroke-width="1.6"/><line x1="230" y1="109" x2="230" y2="122" stroke-width="1.6"/>',
    // 몸통 (잠수복)
    '<rect x="170" y="123" width="96" height="15" rx="7.5" fill="#3c4656"/>',
    // 호스: 공기통 → 입
    '<path d="M188 114 Q 166 106 154 131" stroke-width="1.8"/>',
    // 머리 · 물안경 · 끈
    '<circle cx="160" cy="129" r="12" fill="#fff"/>',
    '<rect x="141" y="121" width="13" height="10" rx="3" fill="#7fb3d8"/><line x1="154" y1="123" x2="170" y2="122" stroke-width="1.6"/>',
    // 팔: 앞으로 뻗은 팔 · 몸 옆으로 붙인 팔
    '<polyline points="182,136 162,152 142,153" /><polyline points="196,137 214,152 234,151" />',
    // 다리 · 물갈퀴
    '<line x1="264" y1="128" x2="312" y2="118" /><line x1="264" y1="134" x2="314" y2="146" />',
    '<path d="M312 118 l 26 -9 l -5 15 Z" fill="#333"/><path d="M314 146 l 26 7 l -12 10 Z" fill="#333"/>',
  ].join('');
  s = s.slice(0, start) + DIVER + s.slice(end);
  save(f, s);
}

/* ---------- 역학 4-6 그네충돌구: 회색 화살표 · '속력 V' 글씨 빼고 점선만 ---------- */
{
  const f = 'mech-4-6.svg';
  let s = read(f);
  s = rep(s, '<line x1="110" y1="205" x2="118.2" y2="200.4" stroke="#8a90a0" stroke-width="2"/>', '', f);
  s = rep(s, '<polygon points="126,196 120.1,203.9 116.2,196.9" fill="#8a90a0" stroke="#8a90a0" stroke-width="1"/>', '', f);
  s = s.replace(/<text [^>]*>속력 V<\/text>/, (m) => (m ? '' : m));
  if (s.includes('속력 V')) throw new Error('글씨를 못 지움: ' + f);
  save(f, s);
}

/* ---------- 역학 1-4 진자: 글자 A ---------- */
{
  const f = 'mech-1-4.svg';
  save(f, rep(read(f), '<text x="61.9" y="191.5"', '<text x="52" y="191.5"', f));
}

console.log(`새 그림 ${written.length}개:\n  ` + written.join('\n  '));
