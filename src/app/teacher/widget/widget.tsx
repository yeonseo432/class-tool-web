'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import QuestionImage from '@/components/question-image';
import { CIRC, DONT_KNOW_LABEL, type Phase } from '@/lib/live';
import { RpcError, teacherApi } from '@/lib/rpc';
import { useLiveChannel } from '@/lib/use-live-channel';
import s from './widget.module.css';

type Q = {
  id: string; title: string; type: 'mc' | 'short'; stem: string; choices: string[]; answer: string;
  explanation: string; imageUrl: string; choiceImages?: string[];
  /** 선지별 오개념 이름 */
  choiceMisNames?: string[][];
};
type Stats = {
  code: string; channel: string; lessonId: string; title: string; phase: Phase; idx: number; total: number;
  questions: { id: string; title: string; type: string }[]; q: Q | null; joined: number; n: number; correctN: number;
  counts: number[]; unknownN: number; shorts: { text: string; count: number; c: boolean }[];
  submitted: { name: string; c: boolean; nos: number[]; unknown: boolean }[];
  rosterN: number; hasRoster: boolean; missing: { name: string; joined: boolean }[];
};

const PH: Partial<Record<Phase, string>> = {
  waiting: '학생 화면: 빈 화면 (아직 문제를 내지 않았어요)',
  open: '학생들이 푸는 중 · 한 번 제출한 답은 바꿀 수 없어요',
  reveal: '학생 화면과 크게 보기 창에 정답을 표시해요',
};
const isAns = (answer: string, no: number) => String(answer).split('|').map((x) => x.trim()).includes(String(no));

export default function Widget() {
  const params = useSearchParams();
  const bigCode = params.get('big');
  if (bigCode) return <BigQuestion code={bigCode} />;
  if (params.get('qr') != null) return <QrWindow />;
  return <WidgetMain lesson={params.get('lesson') ?? ''} />;
}

function WidgetMain({ lesson }: { lesson: string }) {
  const [st, setSt] = useState<Stats | null>(null);
  const [fatal, setFatal] = useState('');
  const [ended, setEnded] = useState(false);
  const [toast, setToast] = useState('');
  const [big, setBig] = useState<'q' | 'qr' | null>(null);
  /** 선지를 누르면 그 선지를 고른 학생 이름 (-1 = 모르겠어요) */
  const [pick, setPick] = useState<number | null>(null);
  const [qr, setQr] = useState('');
  const busy = useRef(false);
  const code = st?.code;
  const studentLink = code && typeof window !== 'undefined' ? `${location.origin}/student` : '';

  // 수업 시작 (진행 중이면 이어서)
  useEffect(() => {
    if (!lesson) return;
    teacherApi<Stats>('startLive', lesson)
      .then(setSt)
      .catch((e: RpcError) => setFatal(e.status === 401 ? '로그인이 풀렸어요. 교사 화면에서 다시 로그인해 주세요.' : e.message));
  }, [lesson]);

  useEffect(() => {
    if (studentLink) QRCode.toDataURL(studentLink, { width: 480, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [studentLink]);

  const refresh = useCallback(async () => {
    if (!code || busy.current) return;
    try {
      const x = await teacherApi<Stats>('liveStats', code);
      if (!busy.current) setSt(x);
    } catch { /* 다음 신호·폴링 때 다시 */ }
  }, [code]);
  // 학생 접속 · 제출 · 단계 변경 신호마다 새로 불러옴 (놓쳐도 5초마다 따라잡음)
  useLiveChannel(ended ? null : st?.channel, () => refresh(), 5000);

  async function ctl(action: 'goto' | 'open' | 'close' | 'reveal' | 'end', idx?: number) {
    if (!st) return;
    busy.current = true;
    try {
      const r = await teacherApi<Stats | { phase: 'ended' }>('liveControl', st.code, action, idx);
      if (r.phase === 'ended') setEnded(true);
      else setSt(r as Stats);
    } catch (e) {
      setToast((e as Error).message);
      setTimeout(() => setToast(''), 3000);
    } finally {
      busy.current = false;
    }
  }

  if (!lesson) return <Shell title="수업 위젯"><div className={s.err}>차시가 지정되지 않았어요. 교사 화면에서 [수업 시작]을 눌러 주세요.</div></Shell>;
  if (fatal) return <Shell title="수업 위젯"><div className={s.err}>{fatal}<br /><br />교사 화면에서 다시 [수업 시작]을 눌러 주세요.</div></Shell>;
  if (ended) {
    return (
      <Shell title="수업 종료">
        <div className={s.card} style={{ textAlign: 'center', padding: 30 }}>
          수업을 종료했어요.<br />학생 응답은 통계 메뉴에서 볼 수 있어요.<br /><br />
          <button className={s.plain} onClick={() => window.close()}>창 닫기</button>
        </div>
      </Shell>
    );
  }
  if (!st) return <Shell title="수업 준비 중…"><div className={s.tip}>수업을 여는 중…</div></Shell>;

  const q = st.q;
  const rate = st.n ? Math.round((st.correctN / st.n) * 100) : 0;
  const max = Math.max(1, ...st.counts, st.unknownN ?? 0);

  const misOf = (i: number) => (q?.choiceMisNames?.[i] ?? []).filter(Boolean);
  const who = pick == null ? [] : st.submitted.filter((x) => (pick === -1 ? x.unknown : x.nos.includes(pick + 1)));
  const openWin = (url: string, name: string, feat: string, fallback: () => void) => { if (!window.open(url, name, feat)) fallback(); };

  return (
    <Shell title={st.title}>
      {toast && <div className={s.err}>{toast}</div>}
      {!st.hasRoster && (
        <div className={s.err}>
          이 클래스에 학생 명단(학년·반)이 연결되지 않아 학생이 들어올 수 없어요. 교사 화면의 [수업하기 › 클래스 수정]에서 명단을 연결해 주세요.
        </div>
      )}

      {!st.total ? (
        <div className={s.card} style={{ textAlign: 'center', color: 'var(--sub)', padding: 24 }}>
          이 차시에 추가된 문제가 없어요.<br />교사 화면의 차시 문제 구성에서 문제를 추가한 뒤 위젯을 다시 열어 주세요.
        </div>
      ) : q && (
        <>
          <div className={s.card}>
            <div className={s.nav}>
              <button disabled={st.idx <= 0} onClick={() => { setPick(null); ctl('goto', st.idx - 1); }}>‹</button>
              <div className={s.no}>{st.idx + 1} / {st.total}</div>
              <button disabled={st.idx >= st.total - 1} onClick={() => { setPick(null); ctl('goto', st.idx + 1); }}>›</button>
            </div>
            <div className={s.qt}>{q.title}</div>
            <div className={s.stem}>{q.stem}</div>
            <div className={`${s.phase} ${s.phase2}`}>
              <button className={`${s.send} ${st.phase === 'open' ? s.on : ''}`} onClick={() => ctl('open')}>문제 출제하기</button>
              <button className={`${s.reveal} ${st.phase === 'reveal' ? s.on : ''}`} onClick={() => ctl('reveal')}>정답 공개</button>
            </div>
            <div className={s.phLabel}>{PH[st.phase] ?? ''}</div>
          </div>

          <div className={s.card}>
            <div className={s.nums}>
              <div className={s.num}><b>{st.joined}</b><span>접속{st.hasRoster ? ` / ${st.rosterN}명` : '명'}</span></div>
              <div className={s.num}><b>{st.n}</b><span>제출 / {st.joined}명</span></div>
              <div className={s.num}>
                <b style={{ color: st.n ? (rate >= 70 ? '#16a34a' : rate >= 40 ? '#e8702a' : '#e5484d') : '#999' }}>{st.n ? rate + '%' : '-'}</b>
                <span>정답률</span>
              </div>
            </div>
            <div className={s.bars}>
              {q.type === 'mc' ? (
                <>
                  {st.counts.map((c, i) => (
                    <div key={i} className={`${s.barBox} ${pick === i ? s.picked : ''}`}>
                      <button className={`${s.barRow} ${isAns(q.answer, i + 1) ? s.ansRow : ''}`} onClick={() => setPick(pick === i ? null : i)} title="눌러서 이 선지를 고른 학생 보기">
                        <span className={s.lb}>{CIRC[i]}</span>
                        <div className={s.tr}><b style={{ width: `${(c / max) * 100}%` }} /></div>
                        <span className={s.ct}>{c}명 {st.n ? `(${Math.round((c / st.n) * 100)}%)` : ''}</span>
                      </button>
                      {misOf(i).length > 0 && <div className={s.mis}>{misOf(i).map((m) => <span key={m}>{m}</span>)}</div>}
                      {pick === i && <Names list={who} />}
                    </div>
                  ))}
                  <div className={`${s.barBox} ${pick === -1 ? s.picked : ''}`}>
                    <button className={`${s.barRow} ${s.dunnoRow}`} onClick={() => setPick(pick === -1 ? null : -1)} title="눌러서 모르겠어요를 고른 학생 보기">
                      <span className={s.lb}>?</span>
                      <div className={s.tr}><b style={{ width: `${(st.unknownN / max) * 100}%` }} /></div>
                      <span className={s.ct}>{st.unknownN}명 {DONT_KNOW_LABEL}</span>
                    </button>
                    {pick === -1 && <Names list={who} />}
                  </div>
                </>
              ) : st.shorts.length ? st.shorts.slice(0, 8).map((x) => (
                <div key={x.text} className={`${s.short} ${x.c ? s.ok : ''}`}><span>{x.text}</span><b>{x.count}명</b></div>
              )) : <div className={s.none}>아직 제출한 답이 없어요</div>}
            </div>
            {st.hasRoster && st.missing.length > 0 && (
              <div className={s.names} style={{ marginTop: 6 }}>
                <span style={{ background: 'none', color: '#888', paddingLeft: 0 }}>아직 안 낸 학생 {st.missing.length}명:</span>
                {st.missing.map((x) => (
                  <span key={x.name} style={{ opacity: x.joined ? 1 : 0.45 }} title={x.joined ? '접속함' : '접속 안 함'}>{x.name}</span>
                ))}
              </div>
            )}
            <div className={s.tip}>초록 막대 = 정답{q.type === 'mc' && String(q.answer).includes('|') ? ' (정답 여러 개 · 모두 골라야 정답)' : ''} · 선지를 누르면 고른 학생 · 막대 아래 = 그 선지의 오개념</div>
          </div>
        </>
      )}

      <div className={s.foot}>
        <button onClick={() => q && openWin(`/teacher/widget?big=${encodeURIComponent(st.code)}`, 'qc_big_' + st.code, 'width=1280,height=800', () => setBig('q'))}>문제 크게 보기</button>
        <button onClick={() => openWin('/teacher/widget?qr=1', 'qc_qr', 'width=900,height=900', () => setBig('qr'))}>접속 QR코드 보기</button>
      </div>
      <div className={s.foot} style={{ marginTop: 6 }}>
        <button className={s.end} onClick={() => confirm('수업을 종료할까요? 학생 화면도 종료돼요.') && ctl('end')}>수업 종료</button>
      </div>
      <div className={s.tip}>이 창을 PPT 슬라이드쇼 옆(또는 다른 모니터)에 두고 사용하세요.</div>

      {big && (
        <div className={s.big}>
          <button className={s.close} onClick={() => setBig(null)}>닫기</button>
          {big === 'q' && q ? (
            <>
              <div style={{ color: '#888', marginBottom: 10 }}>{st.idx + 1} / {st.total}</div>
              <div className={s.bq}>{q.stem}</div>
              <QuestionImage src={q.imageUrl} />
              <div className={q.choiceImages?.some(Boolean) ? s.bcPics : ''}>
                {q.choices.map((c, i) => (
                  <div key={i} className={`${s.bc} ${st.phase === 'reveal' && isAns(q.answer, i + 1) ? s.bcAns : ''}`}>
                    {CIRC[i]} {q.choiceImages?.[i] && <QuestionImage className={s.bcImg} src={q.choiceImages[i]} alt={`${i + 1}번 보기 그림`} />} {c}
                  </div>
                ))}
              </div>
              {st.phase === 'reveal' && q.type === 'short' && <div className={`${s.bc} ${s.bcAns}`}>정답: {q.answer.split('|')[0]}</div>}
            </>
          ) : <QrBody qr={qr} link={studentLink} />}
        </div>
      )}
    </Shell>
  );
}

/** 선지를 고른 학생 이름 */
function Names({ list }: { list: { name: string; c: boolean }[] }) {
  return (
    <div className={s.names}>
      {list.length ? list.map((x) => <span key={x.name}>{x.name}</span>) : <span style={{ background: 'none', color: '#888' }}>이 선지를 고른 학생이 없어요</span>}
    </div>
  );
}

function QrBody({ qr, link }: { qr: string; link: string }) {
  return (
    <div style={{ textAlign: 'center', marginTop: 20 }}>
      <div style={{ fontSize: 22, color: '#555' }}>태블릿으로 QR을 찍고 학년 · 반 · 번호 · 이름으로 로그인하세요</div>
      {/* eslint-disable-next-line @next/next/no-img-element -- 브라우저에서 만든 data: QR 이미지 */}
      {qr && <img src={qr} alt="학생 접속 QR" style={{ width: 'min(60vh, 80vw)' }} />}
      <div style={{ color: '#555', fontSize: 24, fontWeight: 700, wordBreak: 'break-all' }}>{link}</div>
      <div style={{ color: '#888' }}>처음 로그인은 선생님이 나눠 준 6자리 비밀번호로 → 자기 비밀번호를 정하고 들어가요</div>
    </div>
  );
}

/** 접속 QR코드 (새 창) — /teacher/widget?qr */
function QrWindow() {
  const [qr, setQr] = useState('');
  const [link, setLink] = useState('');   // 서버 렌더와 맞추려고 브라우저에서 정함
  useEffect(() => { setLink(`${location.origin}/student`); }, []);
  useEffect(() => { if (link) QRCode.toDataURL(link, { width: 640, margin: 1 }).then(setQr).catch(() => setQr('')); }, [link]);
  return <div className={s.bigWin} style={{ overflow: 'auto' }}><QrBody qr={qr} link={link} /></div>;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.page}>
      <div className={s.top}><span className={s.live}>LIVE</span><span className={s.t}>{title}</span></div>
      <div className={s.wrap}>{children}</div>
    </div>
  );
}

/**
 * 문제 크게 보기 (새 창) — /teacher/widget?big=<수업 코드>
 * 위젯에서 문제를 넘기거나 정답을 공개하면 이 창도 따라 바뀌어요.
 * 창 크기에 맞춰 글자 · 그림 크기를 줄여 스크롤 없이 한 화면에 보여요 (그림 선지는 개수만큼 한 줄).
 */
function BigQuestion({ code }: { code: string }) {
  const [st, setSt] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try { setSt(await teacherApi<Stats>('liveStats', code)); setErr(''); }
    catch (e) { setErr((e as RpcError).status === 401 ? '로그인이 풀렸어요. 교사 화면에서 다시 로그인해 주세요.' : (e as Error).message); }
  }, [code]);
  useEffect(() => { refresh(); }, [refresh]);
  useLiveChannel(st?.channel ?? null, () => refresh(), 5000);

  const q = st?.q ?? null;
  const reveal = st?.phase === 'reveal';
  // 문제가 바뀌거나 창 크기가 바뀌면 처음 크기부터 다시 맞춤
  useEffect(() => { setScale(1); }, [q?.id, reveal]);
  useEffect(() => {
    const on = () => setScale(1);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight > el.clientHeight + 1 && scale > 0.35) setScale((x) => Math.round(x * 0.92 * 1000) / 1000);
  });

  if (err) return <div className={s.bigWin}><div className={s.err}>{err}</div></div>;
  if (!st) return <div className={s.bigWin}><div className={s.tip}>불러오는 중…</div></div>;
  if (st.phase === 'ended') return <div className={s.bigWin}><div className={s.tip} style={{ fontSize: 20 }}>수업이 끝났어요.</div></div>;
  if (!q) return <div className={s.bigWin}><div className={s.tip} style={{ fontSize: 20 }}>아직 문제가 없어요.</div></div>;
  const pics = !!q.choiceImages?.some(Boolean);
  const shortTexts = !pics && q.choices.every((c) => c.length <= 16);
  return (
    <div className={s.bigWin} ref={box} style={{ fontSize: `${scale}em` }}>
      <div className={s.bigNo}>{st.idx + 1} / {st.total}</div>
      <div className={s.bq}>{q.stem}</div>
      <QuestionImage className={s.bigImg} src={q.imageUrl} />
      {q.type === 'mc' && (
        <div className={pics ? s.bcRow : shortTexts ? s.bcRowText : ''}
          style={pics || shortTexts ? { gridTemplateColumns: `repeat(${q.choices.length}, minmax(0, 1fr))` } : undefined}>
          {q.choices.map((c, i) => (
            <div key={i} className={`${s.bc} ${reveal && isAns(q.answer, i + 1) ? s.bcAns : ''}`}>
              <span>{CIRC[i]}</span>
              {q.choiceImages?.[i] && <QuestionImage className={s.bcImgRow} src={q.choiceImages[i]} alt={`${i + 1}번 보기 그림`} />}
              {c && <span>{c}</span>}
            </div>
          ))}
        </div>
      )}
      {reveal && q.type === 'short' && <div className={`${s.bc} ${s.bcAns}`}>정답: {q.answer.split('|')[0]}</div>}
    </div>
  );
}
