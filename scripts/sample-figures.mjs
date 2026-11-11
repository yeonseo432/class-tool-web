/**
 * 기본 문항 세트의 그림 (SVG) — scripts/sample-build.mjs 가 public/sample/ 에 파일로 써요.
 *   FIGURES['역학 1-1'] = { figure: 상황 그림 SVG, choices: [{ forText: 그림을 그릴 때 기준으로 삼은 선지 글, svg }] }
 * 선 그림 · 한 가지 색 화살표로, 시험지처럼 단순하게 그려요. 그림 선지의 설명 글은 <title> 로 넣어요 (화면 읽기 프로그램용).
 */

/* ---------------- 기본 도구 ---------------- */
const INK = '#1f2430', SOFT = '#f3f4f7', ARROW = '#c2272d', SKY = '#eef4fb', WATER = '#dcecf7';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (v) => Math.round(v * 10) / 10;
export const slug = (code) => code.replace('역학', 'mech').replace('열', 'heat').replace(/\s+/g, '-');

function svg(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="'Noto Sans KR','Malgun Gothic',sans-serif">` +
    (title ? `<title>${esc(title)}</title>` : '') + `<rect width="${w}" height="${h}" fill="#fff"/>` +
    `<g fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>\n`;
}
const line = (x1, y1, x2, y2, a = '') => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${a}/>`;
const circle = (cx, cy, r, a = '') => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${a}/>`;
const pathD = (d, a = '') => `<path d="${d}" ${a}/>`;
const text = (x, y, s, a = '') => `<text x="${n(x)}" y="${n(y)}"${/\bfill=/.test(a) ? '' : ` fill="${INK}"`} stroke="none"${/font-size=/.test(a) ? '' : ' font-size="15"'} ${a}>${esc(s)}</text>`;
const dashed = 'stroke-dasharray="6 6"';
/** 힘 화살표 (끝에 채운 삼각형) */
function arrow(x1, y1, x2, y2, { color = ARROW, w = 3, head = 11 } = {}) {
  const a = Math.atan2(y2 - y1, x2 - x1), L = Math.hypot(x2 - x1, y2 - y1);
  const bx = x2 - Math.cos(a) * head, by = y2 - Math.sin(a) * head;
  const px = Math.cos(a + Math.PI / 2) * head * 0.45, py = Math.sin(a + Math.PI / 2) * head * 0.45;
  if (L < 1) return '';
  return line(x1, y1, bx, by, `stroke="${color}" stroke-width="${w}"`) +
    `<polygon points="${n(x2)},${n(y2)} ${n(bx + px)},${n(by + py)} ${n(bx - px)},${n(by - py)}" fill="${color}" stroke="${color}" stroke-width="1"/>`;
}
/** 움직임을 나타내는 짧은 선들 */
const motion = (x, y, dir, k = 3, len = 18, gap = 9) => Array.from({ length: k }, (_, i) => {
  const o = (i - (k - 1) / 2) * gap;
  return dir === 'down' ? line(x + o, y - len, x + o, y, 'stroke="#8a90a0" stroke-width="2"') :
    dir === 'right' ? line(x - len, y + o, x, y + o, 'stroke="#8a90a0" stroke-width="2"') :
      line(x + len, y + o, x, y + o, 'stroke="#8a90a0" stroke-width="2"');
}).join('');
const ground = (x1, x2, y) => line(x1, y, x2, y) + Array.from({ length: Math.floor((x2 - x1) / 14) }, (_, i) => line(x1 + 8 + i * 14, y, x1 + i * 14, y + 8, 'stroke-width="1.4"')).join('');
const ceiling = (x1, x2, y) => line(x1, y, x2, y) + Array.from({ length: Math.floor((x2 - x1) / 14) }, (_, i) => line(x1 + i * 14, y, x1 + 8 + i * 14, y - 8, 'stroke-width="1.4"')).join('');
const ball = (x, y, r = 11) => circle(x, y, r, `fill="${SOFT}"`);

/** 막대 사람. x, y = 발 가운데, s = 크기, arms: [[어깨에서 손까지 dx, dy] 왼팔, 오른팔], lean: 뒤로 젖힘(도) */
function person(x, y, { s = 1, arms = [[-14, 22], [14, 22]], legs = [[-10, 0], [10, 0]], lean = 0, face = 0 } = {}) {
  const hip = [x, y - 42 * s], neck = [x, y - 78 * s];
  const rot = (px, py) => { const a = (lean * Math.PI) / 180, dx = px - x, dy = py - y; return [x + dx * Math.cos(a) - dy * Math.sin(a), y + dx * Math.sin(a) + dy * Math.cos(a)]; };
  const [hx, hy] = rot(...hip), [nx, ny] = rot(...neck), [cx, cy] = rot(x + face * 2 * s, y - 92 * s);
  let b = circle(cx, cy, 12 * s, 'fill="#fff"') + line(nx, ny, hx, hy);
  legs.forEach(([dx, dy]) => { b += line(hx, hy, x + dx * s, y + dy * s); });
  const sh = rot(x, y - 70 * s);
  arms.forEach(([dx, dy]) => { b += line(sh[0], sh[1], sh[0] + dx * s, sh[1] + dy * s); });
  return b;
}
/** 줄 · 보기용 '물체(점선 윤곽 + 가운데 점)' */
const dotBody = (x, y, r = 22) => circle(x, y, r, `${dashed} stroke-width="1.8"`) + circle(x, y, 3.5, `fill="${INK}"`);

/* ---------------- 보기(선지) 그림: 물체 하나 + 힘 화살표 ---------------- */
const CW = 170, CH = 170;
/** 화살표 묶음: 'down' | 'up' | 'right' | 'left' | [dx, dy] — len 은 길이 */
function forces(x, y, list, r = 12) {
  return list.map((f) => {
    const [dx, dy, len, from] = typeof f === 'string'
      ? { down: [0, 1, 52], up: [0, -1, 52], right: [1, 0, 52], left: [-1, 0, 52] }[f] : f;
    const L = len ?? 52, ox = from?.[0] ?? 0, oy = from?.[1] ?? 0;
    return arrow(x + ox + dx * r, y + oy + dy * r, x + ox + dx * (r + L), y + oy + dy * (r + L));
  }).join('');
}
const choice = (forText, body) => ({ forText, svg: svg(CW, CH, body, forText) });
const ballChoice = (t, list, extra = '') => choice(t, extra + ball(85, 85, 13) + forces(85, 85, list, 13));
const NOFORCE = '화살표 없음 (힘이 없다)';

/* ---------------- 장면 ---------------- */
function throwUp(phase) {   // 역학 1-1 ~ 1-3: 수직으로 던진 공
  const by = phase === 'top' ? 40 : 95;
  let b = ground(30, 330, 270) + person(150, 270, { arms: [[30, -18], [-14, 24]] });
  b += line(180, 182, 180, 50, `stroke="#9aa0ac" stroke-width="1.5" ${dashed}`);
  b += ball(180, by, 12);
  if (phase === 'up') b += arrow(205, 140, 205, 100, { color: '#8a90a0', w: 2, head: 9 }) + text(214, 125, '올라가는 중', 'font-size="13" fill="#555"');
  if (phase === 'down') b += arrow(205, 100, 205, 140, { color: '#8a90a0', w: 2, head: 9 }) + text(214, 125, '내려오는 중', 'font-size="13" fill="#555"');
  if (phase === 'top') b += text(200, 45, '최고점', 'font-size="13" fill="#555"');
  return svg(360, 290, b);
}
const BALL_UPDOWN = [
  ['공에 아래 방향 화살표 하나', ['down']],
  ['공에 위 방향 화살표 하나', ['up']],
  [NOFORCE, []],
  ['공에 위 방향 화살표와 아래 방향 화살표', ['up', 'down']],
];

function pendulum(at) {   // 역학 1-4, 1-5
  const px = 210, py = 40, L = 190, ang = (40 * Math.PI) / 180;
  const pos = { A: [px - L * Math.sin(ang), py + L * Math.cos(ang)], B: [px, py + L], C: [px + L * Math.sin(ang), py + L * Math.cos(ang)] };
  let b = ceiling(130, 290, py) + pathD(`M${n(pos.A[0])} ${n(pos.A[1])} A ${L} ${L} 0 0 0 ${n(pos.C[0])} ${n(pos.C[1])}`, `stroke="#9aa0ac" stroke-width="1.6" ${dashed}`);
  const [bx, by] = pos[at];
  b += line(px, py, bx, by) + circle(bx, by, 14, `fill="${SOFT}"`);
  for (const [k, [x, y]] of Object.entries(pos)) b += text(x + (k === 'A' ? -26 : k === 'C' ? 14 : -5), y + (k === 'B' ? 36 : 6), k, 'font-size="17" font-weight="700"');
  if (at === 'B') b += arrow(px + 24, py + L + 26, px + 70, py + L + 26, { color: '#8a90a0', w: 2, head: 9 }) + text(px + 76, py + L + 31, '운동 방향', 'font-size="13" fill="#555"');
  return svg(420, 290, b);
}
/** 진자 보기: 추 위치에서 줄 방향 · 아래 · 원호 방향 화살표 */
function bobChoice(t, at, list) {
  const x = 85, y = 95;
  const ang = at === 'A' ? (40 * Math.PI) / 180 : 0;
  const ux = Math.sin(ang), uy = -Math.cos(ang);   // 줄 방향(추 → 고정점)
  let b = line(x, y, x + ux * 80, y + uy * 80) + circle(x, y, 13, `fill="${SOFT}"`);
  const vec = { string: [ux, uy, 48], down: [0, 1, 48], tangentB: [Math.cos(ang), Math.sin(ang), 48], right: [1, 0, 48] };
  b += list.map((k) => { const [dx, dy, L] = vec[k]; return arrow(x + dx * 13, y + dy * 13, x + dx * (13 + L), y + dy * (13 + L)); }).join('');
  return choice(t, b);
}

function parachute() {   // 역학 1-6
  let b = `<rect x="0" y="0" width="360" height="300" fill="${SKY}" stroke="none"/>`;
  b += pathD('M95 110 Q180 10 265 110 Z', `fill="#fff"`) + pathD('M95 110 Q137 92 180 110 Q222 92 265 110', 'stroke-width="2"');
  b += line(95, 110, 168, 196) + line(137, 103, 172, 196) + line(222, 103, 188, 196) + line(265, 110, 192, 196);
  b += person(180, 280, { s: 0.95, arms: [[-12, -20], [12, -20]], legs: [[-8, 0], [8, 0]] });
  b += arrow(310, 120, 310, 200, { color: '#8a90a0', w: 2, head: 9 }) + text(284, 112, '일정한 속력', 'font-size="12" fill="#555"');
  return svg(360, 300, b);
}
/** 낙하산 보기: 앞에서 본 사람 + 화살표 */
function chuteChoice(t, list) {
  let b = `<g stroke="#6b7180" stroke-width="2">${person(85, 128, { s: 0.75, arms: [[-12, -22], [12, -22]] })}</g>`;
  b += list.map(([y1, y2]) => arrow(85, y1, 85, y2, { w: 3.2 })).join('');
  return choice(t, b);
}

function tugOfWar() {   // 역학 1-8
  let b = ground(20, 460, 250);
  b += person(110, 250, { lean: -18, arms: [[48, 4], [44, 10]], legs: [[-18, 0], [16, 0]] }) + text(85, 285, '영철', 'font-size="14"');
  b += person(370, 250, { lean: 18, arms: [[-48, 4], [-44, 10]], legs: [[-16, 0], [18, 0]] }) + text(352, 285, '수길', 'font-size="14"');
  b += line(134, 190, 346, 190, 'stroke="#7a5a2a" stroke-width="3"');
  b += line(240, 180, 240, 200, 'stroke-width="2"');
  return svg(480, 300, b);
}

function throwCatch(where) {   // 역학 2-1 ~ 2-3
  const x0 = 95, y0 = 178, x1 = 395, y1 = 178;
  const pt = (t) => [x0 + (x1 - x0) * t, y0 - 4 * 120 * t * (1 - t)];
  let b = ground(20, 470, 260) + person(70, 260, { arms: [[34, -16], [-14, 24]] }) + person(420, 260, { arms: [[-30, -12], [14, 24]] });
  b += pathD(`M${x0} ${y0} Q ${(x0 + x1) / 2} ${y0 - 240} ${x1} ${y1}`, `stroke="#9aa0ac" stroke-width="1.6" ${dashed}`);
  const t = { up: 0.24, top: 0.5, down: 0.76 }[where];
  const [bx, by] = pt(t);
  b += ball(bx, by, 11);
  return svg(490, 280, b);
}
/** 비스듬한 화살표 (운동 방향) */
const DIAG_UP = [0.75, -0.66, 54], DIAG_DN = [0.75, 0.66, 54];

function comet() {   // 역학 2-6
  let b = `<rect x="0" y="0" width="460" height="260" fill="#0f1430" stroke="none"/>`;
  for (const [x, y] of [[40, 30], [120, 210], [210, 40], [330, 30], [420, 120], [380, 220], [60, 160]]) b += circle(x, y, 1.6, 'fill="#fff" stroke="none"');
  const W = 'stroke="#fff"';
  b += line(50, 90, 250, 90, `${W}`) + pathD('M250 90 Q 340 90 380 220', `${W} ${dashed}`);
  b += circle(250, 90, 4, 'fill="#fff" stroke="#fff"') + circle(50, 90, 4, 'fill="#fff" stroke="#fff"');
  b += text(42, 76, 'P', 'fill="#fff" font-size="17" font-weight="700"') + text(244, 76, 'Q', 'fill="#fff" font-size="17" font-weight="700"') + text(388, 226, 'R', 'fill="#fff" font-size="17" font-weight="700"');
  b += circle(150, 90, 10, 'fill="#d9dde8" stroke="#fff"') + motion(130, 90, 'right', 3, 26, 7).replaceAll('#8a90a0', '#9aa6c8');
  return svg(460, 260, b);
}
function cometChoice(t, list) {
  let b = line(10, 85, 160, 85, 'stroke="#9aa0ac" stroke-width="1.6"') + text(8, 75, 'P', 'font-size="14" font-weight="700"') + text(150, 75, 'Q', 'font-size="14" font-weight="700"');
  b += ball(85, 85, 12) + forces(85, 85, list, 12);
  return choice(t, b);
}

function rockPull() {   // 역학 2-9
  let b = ground(20, 460, 250);
  b += person(110, 250, { lean: -20, arms: [[50, 6], [46, 12]], legs: [[-20, 0], [16, 0]] }) + text(90, 285, '영철', 'font-size="14"');
  b += pathD('M300 250 Q 296 170 350 160 Q 420 150 432 210 L 436 250 Z', `fill="#e6e1d8"`);
  b += line(134, 193, 305, 205, 'stroke="#7a5a2a" stroke-width="3"');
  return svg(480, 300, b);
}

function skydiver() {   // 역학 2-10
  let b = `<rect x="0" y="0" width="420" height="260" fill="${SKY}" stroke="none"/>`;
  // 엎드린 자세(배가 아래)로 떨어지는 사람 + 등의 낙하산 가방
  b += circle(140, 150, 13, 'fill="#fff"') + line(153, 152, 245, 152) + line(245, 152, 290, 130) + line(245, 152, 292, 168);
  b += line(175, 152, 160, 115) + line(175, 152, 155, 190) + `<rect x="190" y="128" width="40" height="20" rx="5" fill="#f2c94c"/>`;
  b += [165, 195, 225, 255].map((x) => line(x, 70, x, 105, 'stroke="#8a90a0" stroke-width="2"')).join('');   // 위로 남는 공기 흐름 선
  b += arrow(345, 70, 345, 200, { color: '#8a90a0', w: 2, head: 10 }) + text(355, 140, '떨어짐', 'font-size="13" fill="#555"');
  return svg(420, 260, b);
}

function hangingStone(kind) {   // 역학 3-1 (한 줄에 매달려 정지) · 3-2 (떨어짐)
  let b = '';
  if (kind === 'hang') b += ceiling(110, 250, 30) + line(180, 30, 180, 140);
  b += pathD('M150 150 Q 152 136 172 138 Q 190 128 206 142 Q 214 160 204 176 Q 186 190 164 184 Q 146 174 150 150 Z', `fill="#e6e1d8"`);
  if (kind === 'fall') b += motion(180, 120, 'down', 3, 26, 14) + text(222, 170, '떨어지는 중', 'font-size="13" fill="#555"');
  if (kind === 'hang') b += text(222, 170, '정지', 'font-size="13" fill="#555"');
  return svg(360, 220, b);
}
const stoneChoice = (t, list) => choice(t, dotBody(85, 85, 24) + forces(85, 85, list, 0));

function bicycle(mode) {   // 역학 3-5 ~ 3-7
  let b = ground(10, 470, 240);
  const wheel = (x) => circle(x, 205, 33) + circle(x, 205, 3, `fill="${INK}"`);
  b += wheel(150) + wheel(300) + line(150, 205, 205, 160) + line(205, 160, 300, 205) + line(205, 160, 280, 160) + line(280, 160, 300, 205) + line(215, 205, 205, 160) + line(150, 205, 215, 205) + line(280, 160, 288, 140);
  b += circle(225, 82, 12, 'fill="#fff"') + line(225, 94, 210, 150) + line(210, 150, 232, 180) + line(232, 180, 215, 205) + line(222, 105, 285, 140);
  const label = { constant: '일정한 속도', faster: '점점 빨라짐', slower: '점점 느려짐' }[mode];
  b += arrow(340, 110, 410, 110, { color: '#8a90a0', w: 2, head: 9 }) + text(340, 98, label, 'font-size="13" fill="#555"');
  return svg(480, 260, b);
}
/** 자전거 보기: 작은 자전거 + 화살표 (점점 커지는/작아지는 힘은 화살표 세 개) */
function bikeChoice(t, list) {
  const x = 85, y = 92;
  let b = circle(55, 110, 16) + circle(115, 110, 16) + line(55, 110, 80, 88) + line(80, 88, 115, 110) + line(80, 88, 108, 88) + line(108, 88, 115, 110) + line(55, 110, 88, 110) + line(88, 110, 80, 88);
  const V = { up: [[x, y - 14], [x, y - 66]], down: [[x, y + 14], [x, y + 66]], right: [[x + 30, y], [x + 80, y]], left: [[x - 30, y], [x - 80, y]] };
  for (const k of list) {
    if (k === 'grow' || k === 'shrink') {
      const lens = k === 'grow' ? [20, 32, 46] : [46, 32, 20];
      lens.forEach((L, i) => { b += arrow(x + 30, y - 22 + i * 14, x + 30 + L, y - 22 + i * 14, { w: 2.4, head: 9 }); });
      b += text(x + 50, y - 34, k === 'grow' ? '점점 커짐' : '점점 작아짐', 'font-size="10" fill="#555" text-anchor="middle"');
    } else b += arrow(V[k][0][0], V[k][0][1], V[k][1][0], V[k][1][1]);
  }
  return choice(t, b);
}

function carts(kind) {   // 역학 3-9 (생쥐 · 코끼리), 4-9 (어린이 · 바위)
  const cart = (x, w) => `<rect x="${x}" y="200" width="${w}" height="22" rx="3" fill="${SOFT}"/>` + circle(x + 18, 232, 10) + circle(x + w - 18, 232, 10);
  let b = ground(10, 490, 242) + cart(40, 130) + cart(290, 170);
  if (kind === 'animals') {
    // 생쥐: 작은 몸통 · 귀 · 꼬리
    b += pathD('M80 200 Q 78 176 104 172 Q 128 172 132 196 L 132 200 Z', `fill="#ddd"`) + circle(132, 172, 8, `fill="#ddd"`) + circle(126, 162, 5, `fill="#fff"`) + pathD('M80 192 Q 60 186 66 170', 'stroke-width="1.6"') + text(84, 274, '생쥐', 'font-size="14"');
    // 코끼리: 큰 몸통 · 다리 · 머리 · 코
    b += `<rect x="330" y="118" width="110" height="62" rx="26" fill="#cfd3dc"/>` + [338, 360, 400, 422].map((x) => `<rect x="${x}" y="170" width="14" height="30" fill="#cfd3dc"/>`).join('');
    b += circle(322, 134, 26, `fill="#cfd3dc"`) + pathD('M304 146 Q 290 170 300 186', 'stroke-width="5"') + pathD('M330 116 Q 352 126 340 152', 'stroke-width="1.8"') + text(354, 274, '코끼리', 'font-size="14"');
    b += line(132, 178, 302, 182, 'stroke="#7a5a2a" stroke-width="3"');
  } else {
    b += person(105, 200, { s: 0.8, arms: [[44, 6], [40, 12]], lean: -8 }) + text(80, 274, '어린이', 'font-size="14"');
    b += pathD('M320 200 Q 316 140 370 130 Q 440 124 450 176 L 452 200 Z', `fill="#e6e1d8"`) + text(352, 274, '바위', 'font-size="14"');
    b += line(140, 148, 322, 168, 'stroke="#7a5a2a" stroke-width="3"');
  }
  return svg(500, 285, b);
}

function astronaut() {   // 역학 3-10
  let b = `<rect x="0" y="0" width="460" height="280" fill="#0f1430" stroke="none"/>`;
  for (const [x, y] of [[30, 30], [90, 240], [200, 20], [300, 250], [430, 40], [420, 200], [250, 140]]) b += circle(x, y, 1.6, 'fill="#fff" stroke="none"');
  b += pathD('M-40 300 A 200 200 0 0 1 160 260', 'fill="#3d78c9" stroke="#9cc0f0"') + pathD('M10 290 Q 40 260 90 270', 'stroke="#6fbf73" stroke-width="5"');
  b += `<rect x="250" y="60" width="130" height="46" rx="20" fill="#d9dde8" stroke="#fff"/>` + `<rect x="380" y="70" width="40" height="26" fill="#9aa6c8" stroke="#fff"/>` + `<rect x="210" y="74" width="40" height="18" fill="#9aa6c8" stroke="#fff"/>`;
  b += pathD('M300 106 Q 280 170 230 168', 'stroke="#fff" stroke-width="1.6"');
  b += circle(215, 170, 14, 'fill="#fff" stroke="#fff"') + `<rect x="192" y="182" width="30" height="40" rx="10" fill="#fff" stroke="#fff"/>` + line(195, 192, 175, 205, 'stroke="#fff" stroke-width="7"') + line(220, 192, 240, 182, 'stroke="#fff" stroke-width="7"') + line(200, 220, 190, 250, 'stroke="#fff" stroke-width="8"') + line(214, 220, 222, 250, 'stroke="#fff" stroke-width="8"');
  b += text(120, 246, '지구', 'fill="#9cc0f0" font-size="14"');
  return svg(460, 280, b);
}

function diver() {   // 역학 4-2
  let b = `<rect x="0" y="0" width="460" height="260" fill="${WATER}" stroke="none"/>` + pathD('M0 26 Q 40 18 80 26 T 160 26 T 240 26 T 320 26 T 400 26 T 480 26', 'stroke="#7fb3d8"');
  b += circle(160, 130, 13, 'fill="#fff"') + `<rect x="140" y="118" width="18" height="12" rx="4" fill="#7fb3d8"/>` + line(173, 130, 270, 132) + `<rect x="190" y="112" width="50" height="14" rx="7" fill="#f2c94c"/>`;
  b += line(270, 132, 320, 118) + line(270, 132, 322, 146) + pathD('M320 118 l 18 -8 l -4 14 Z', 'fill="#333"') + pathD('M322 146 l 18 6 l -12 10 Z', 'fill="#333"') + line(190, 132, 175, 165) + line(205, 132, 225, 100);
  for (const [x, y, r] of [[140, 100, 4], [132, 80, 5], [140, 58, 6]]) b += circle(x, y, r, 'stroke="#5f99c6" stroke-width="1.6"');
  const fish = (x, y, s) => pathD(`M${x} ${y} q ${14 * s} -10 ${28 * s} 0 q ${-14 * s} 10 ${-28 * s} 0 Z M${x + 28 * s} ${y} l ${10 * s} -7 l 0 14 Z`, 'fill="#fff" stroke="#5f99c6" stroke-width="1.6"');
  b += fish(360, 70, 1) + fish(80, 210, 0.8) + fish(380, 210, 0.7);
  return svg(460, 260, b);
}

function cradle() {   // 역학 4-6
  let b = `<rect x="80" y="30" width="300" height="10" fill="${SOFT}"/>` + line(90, 40, 90, 250) + line(370, 40, 370, 250) + ground(60, 400, 250);
  const xs = [150, 190, 230, 270, 310];
  xs.forEach((x, i) => {
    if (i === 0) { const a = (-40 * Math.PI) / 180, L = 150, bx = x + L * Math.sin(a), by = 40 + L * Math.cos(a); b += line(x, 40, bx, by) + circle(bx, by, 20, `fill="${SOFT}"`); }
    else b += line(x, 40, x, 190) + circle(x, 190, 20, `fill="${SOFT}"`);
  });
  b += pathD('M66 160 Q 100 205 124 196', `stroke="#9aa0ac" stroke-width="1.6" ${dashed}`) + arrow(110, 205, 126, 196, { color: '#8a90a0', w: 2, head: 9 }) + text(84, 230, '속력 V', 'font-size="13" fill="#555"');
  return svg(440, 270, b);
}

function rod(marks) {   // 역학 4-8 (marks: [['•', dy], ['∘', dy]])
  let b = ground(40, 200, 250) + `<rect x="100" y="30" width="40" height="220" rx="4" fill="${SOFT}"/>` + pathD('M100 34 Q 120 22 140 34', 'stroke-width="1.6"');
  for (const [m, dy] of marks) b += m === '•' ? circle(120, 140 + dy, 5, `fill="${INK}"`) : circle(120, 140 + dy, 6, 'fill="#fff" stroke-width="2"');
  return b;
}

function coffeeRoom() {   // 열 1-1
  let b = pathD('M40 90 L 230 30 L 420 90', `fill="${SOFT}"`) + `<rect x="60" y="90" width="340" height="170" fill="#fff"/>`;
  b += `<rect x="190" y="200" width="80" height="12" fill="${SOFT}"/>` + line(230, 212, 230, 258) + line(205, 258, 255, 258);
  b += pathD('M210 200 L 214 170 L 246 170 L 250 200 Z', `fill="#fff"`) + pathD('M250 178 q 12 2 10 12 q -2 8 -12 6', 'stroke-width="2"');
  b += pathD('M222 160 q -6 -10 0 -18 q 6 -8 0 -18', 'stroke="#9aa0ac" stroke-width="1.8"') + pathD('M236 160 q -6 -10 0 -18 q 6 -8 0 -18', 'stroke="#9aa0ac" stroke-width="1.8"');
  b += text(84, 120, '방 안의 공기', 'font-size="13" fill="#555"') + text(272, 192, '커피', 'font-size="13" fill="#555"');
  return svg(460, 280, b);
}

function basement() {   // 열 1-6
  let b = `<rect x="0" y="120" width="460" height="200" fill="#efe9dd" stroke="none"/>` + line(0, 120, 460, 120);
  b += `<rect x="230" y="120" width="190" height="150" fill="#fff"/>` + ground(230, 420, 270);
  b += ball(120, 106, 14) + text(80, 70, '위치에너지는 0', 'font-size="14"');
  b += ball(325, 256, 14) + text(280, 230, '위치에너지는?', 'font-size="14"');
  b += arrow(440, 124, 440, 266, { color: '#8a90a0', w: 2, head: 9 }) + arrow(440, 266, 440, 124, { color: '#8a90a0', w: 2, head: 9 }) + text(412, 200, '3 m', 'font-size="14" text-anchor="end"');
  b += text(20, 112, '지면', 'font-size="13" fill="#555"') + text(240, 140, '지하실', 'font-size="13" fill="#555"');
  return svg(460, 290, b);
}

function droppingBall() {   // 열 2-6
  let b = ground(60, 300, 280) + ball(180, 40, 14) + text(204, 46, '높은 곳', 'font-size="13" fill="#555"');
  [[64, 22], [100, 34], [150, 48]].forEach(([y, L]) => { b += arrow(180, y, 180, y + L, { color: '#8a90a0', w: 2.4, head: 9 }); });
  b += ball(180, 255, 14) + text(204, 260, '낮은 곳', 'font-size="13" fill="#555"');
  b += text(210, 140, '점점 빨라짐', 'font-size="13" fill="#555"');
  return svg(360, 300, b);
}

function manBag() {   // 열 3-9
  let b = ground(60, 300, 200) + person(160, 200, { s: 1.4, arms: [[-20, 40], [22, 46]] });
  b += `<rect x="168" y="150" width="46" height="36" rx="5" fill="#c9a26b"/>` + pathD('M178 150 q 13 -14 26 0', 'stroke-width="2"');
  b += text(226, 186, '가만히 서 있음', 'font-size="13" fill="#555"');
  return svg(360, 215, b);
}

/* ---------------- 문항별 ---------------- */
export const FIGURES = {
  '역학 1-1': { figure: throwUp('up'), choices: BALL_UPDOWN.map(([t, f]) => ballChoice(t, f)) },
  '역학 1-2': { figure: throwUp('top'), choices: BALL_UPDOWN.map(([t, f]) => ballChoice(t, f)) },
  '역학 1-3': { figure: throwUp('down'), choices: BALL_UPDOWN.map(([t, f]) => ballChoice(t, f)) },
  '역학 1-4': {
    figure: pendulum('A'),
    choices: [
      bobChoice('추에 원호를 따라 B 쪽(비스듬히 아래)으로 향하는 화살표 하나', 'A', ['tangentB']),
      bobChoice('추에 아래 방향 화살표와 B 쪽(비스듬히 아래) 화살표', 'A', ['down', 'tangentB']),
      bobChoice('추에 줄을 따라 위로 향하는 화살표(장력)와 아래 방향 화살표(중력)', 'A', ['string', 'down']),
      bobChoice('추에 줄을 따라 위로 향하는 화살표, 아래 방향 화살표, B 쪽 화살표 세 개', 'A', ['string', 'down', 'tangentB']),
      bobChoice(NOFORCE, 'A', []),
    ],
  },
  '역학 1-5': {
    figure: pendulum('B'),
    choices: [
      bobChoice('추에 운동 방향(C 쪽, 수평)으로 향하는 화살표 하나', 'B', ['right']),
      bobChoice('추에 아래 방향 화살표와 수평 방향(C 쪽) 화살표', 'B', ['down', 'right']),
      bobChoice('추에 위 방향 화살표(장력)와 아래 방향 화살표(중력)', 'B', ['string', 'down']),
      bobChoice('추에 위 방향, 아래 방향, 수평 방향(C 쪽) 화살표 세 개', 'B', ['string', 'down', 'right']),
      bobChoice(NOFORCE, 'B', []),
    ],
  },
  '역학 1-6': {
    figure: parachute(),
    choices: [
      chuteChoice('사람에게 아래 방향 화살표 하나', [[98, 160]]),
      chuteChoice('사람에게 위 방향 화살표와 아래 방향 화살표 (길이가 같음)', [[98, 36], [98, 160]]),
      chuteChoice(NOFORCE, []),
    ],
  },
  '역학 1-8': { figure: tugOfWar() },
  '역학 2-1': {
    figure: throwCatch('up'),
    choices: [
      ballChoice('공에 아래 방향 화살표(중력) 하나', ['down']),
      ballChoice('공에 운동 방향(비스듬히 위) 화살표(던진힘) 하나', [DIAG_UP]),
      ballChoice('공에 수평 방향 화살표(던진힘)와 아래 방향 화살표(중력)', ['right', 'down']),
      ballChoice('공에 비스듬히 위 방향 화살표(던진힘)와 아래 방향 화살표(중력)', [DIAG_UP, 'down']),
      ballChoice(NOFORCE, []),
    ],
  },
  '역학 2-2': {
    figure: throwCatch('top'),
    choices: [
      ballChoice('공에 아래 방향 화살표(중력) 하나', ['down']),
      ballChoice('공에 수평 방향 화살표(던진힘) 하나', ['right']),
      ballChoice('공에 수평 방향 화살표(던진힘)와 아래 방향 화살표(중력)', ['right', 'down']),
      ballChoice(NOFORCE, []),
    ],
  },
  '역학 2-3': {
    figure: throwCatch('down'),
    choices: [
      ballChoice('공에 아래 방향 화살표(중력) 하나', ['down']),
      ballChoice('공에 운동 방향(비스듬히 아래) 화살표(던진힘) 하나', [DIAG_DN]),
      ballChoice('공에 비스듬히 아래 방향 화살표(던진힘)와 아래 방향 화살표(중력)', [DIAG_DN, 'down']),
      ballChoice('공에 수평 방향 화살표(던진힘)와 아래 방향 화살표(중력)', ['right', 'down']),
      ballChoice(NOFORCE, []),
    ],
  },
  '역학 2-6': {
    figure: comet(),
    choices: [
      cometChoice('공에 Q 방향(운동 방향) 화살표 하나', ['right']),
      cometChoice('공에 P 방향(운동 반대 방향) 화살표 하나', ['left']),
      cometChoice('공에 Q 쪽 비스듬히 아래 방향 화살표 하나', [DIAG_DN]),
      cometChoice('공에 Q 방향 화살표와 아래 방향 화살표', ['right', 'down']),
      cometChoice(NOFORCE, []),
    ],
  },
  '역학 2-9': { figure: rockPull() },
  '역학 2-10': { figure: skydiver() },
  '역학 3-1': {
    figure: hangingStone('hang'),
    choices: [
      stoneChoice('돌에 위 방향 화살표 하나', [[0, -1, 56]]),
      stoneChoice('돌에 아래 방향 화살표 하나', [[0, 1, 56]]),
      stoneChoice('돌에 위 방향 화살표와 아래 방향 화살표 (길이가 같음)', [[0, -1, 56], [0, 1, 56]]),
      stoneChoice('돌에 위 방향 화살표와 아래 방향 화살표 (길이가 다름)', [[0, -1, 34], [0, 1, 62]]),
      stoneChoice(NOFORCE, []),
    ],
  },
  '역학 3-2': {
    figure: hangingStone('fall'),
    choices: [
      stoneChoice('돌에 위 방향 화살표 하나', [[0, -1, 56]]),
      stoneChoice('돌에 아래 방향 화살표 하나', [[0, 1, 56]]),
      stoneChoice('돌에 위 방향 화살표와 아래 방향 화살표 (길이가 같음)', [[0, -1, 56], [0, 1, 56]]),
      stoneChoice('돌에 위 방향 화살표와 아래 방향 화살표 (길이가 다름)', [[0, -1, 34], [0, 1, 62]]),
    ],
  },
  '역학 3-5': {
    figure: bicycle('constant'),
    choices: [
      bikeChoice('오른쪽(운동 방향) 화살표 하나', ['right']),
      bikeChoice('위 방향 화살표와 아래 방향 화살표', ['up', 'down']),
      bikeChoice('오른쪽 화살표와 아래 방향 화살표', ['right', 'down']),
      bikeChoice('위 방향, 아래 방향, 오른쪽 화살표 세 개', ['up', 'down', 'right']),
      bikeChoice(NOFORCE, []),
    ],
  },
  '역학 3-6': {
    figure: bicycle('faster'),
    choices: [
      bikeChoice('오른쪽(운동 방향) 화살표 하나 - 힘이 점점 커진다', ['grow']),
      bikeChoice('위 방향 화살표와 아래 방향 화살표', ['up', 'down']),
      bikeChoice('오른쪽 화살표와 아래 방향 화살표', ['right', 'down']),
      bikeChoice('위 방향, 아래 방향, 오른쪽 화살표 세 개', ['up', 'down', 'right']),
      bikeChoice(NOFORCE, []),
    ],
  },
  '역학 3-7': {
    figure: bicycle('slower'),
    choices: [
      bikeChoice('오른쪽(운동 방향) 화살표 하나 - 힘이 점점 작아진다', ['shrink']),
      bikeChoice('왼쪽(운동 반대 방향) 화살표 하나', ['left']),
      bikeChoice('왼쪽 화살표와 아래 방향 화살표', ['left', 'down']),
      bikeChoice('왼쪽 화살표와 위 방향, 아래 방향 화살표 세 개', ['left', 'up', 'down']),
      bikeChoice(NOFORCE, []),
    ],
  },
  '역학 3-9': { figure: carts('animals') },
  '역학 3-10': { figure: astronaut() },
  '역학 4-2': { figure: diver() },
  '역학 4-6': { figure: cradle() },
  '역학 4-8': {
    figure: svg(240, 270, rod([['•', 0]]) + text(150, 146, '질량중심(•)', 'font-size="13"')),
    choices: [
      choice('중력의 중심(∘)이 질량중심(•)보다 조금 위에 있다', svgSmallRod([['•', 0], ['∘', -24]])),
      choice('중력의 중심(∘)이 질량중심(•)보다 조금 아래에 있다', svgSmallRod([['•', 0], ['∘', 24]])),
      choice('두 중심은 같다', svgSmallRod([['•', 0], ['∘', 0]])),
    ],
  },
  '역학 4-9': { figure: carts('child') },
  '열 1-1': { figure: coffeeRoom() },
  '열 1-6': { figure: basement() },
  '열 2-6': { figure: droppingBall() },
  '열 3-9': { figure: manBag() },
};
/** 4-8 보기용 작은 막대 (선지 그림 크기에 맞춤) */
function svgSmallRod(marks) {
  let b = `<rect x="68" y="12" width="34" height="146" rx="4" fill="${SOFT}"/>`;
  for (const [m, dy] of marks) {
    if (m === '•') b += circle(85, 85 + dy, 4.5, `fill="${INK}"`);
    else b += dy === 0 ? circle(85, 85, 8.5, 'fill="none" stroke-width="2"') : circle(85, 85 + dy, 6, 'fill="#fff" stroke-width="2"');
  }
  return b;
}
