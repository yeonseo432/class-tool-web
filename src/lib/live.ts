/*
 * 실시간 수업 공통 (서버 · 브라우저 모두 사용)
 * 기존: 학생 2.5초 · 위젯 2초 폴링
 * 지금: 서버가 바뀔 때마다 Supabase Realtime Broadcast 로 'changed' 신호 → 화면이 새로 불러옴
 *       (신호를 놓칠 때를 대비해 느린 폴링은 그대로 둠)
 */

/** 수업 세션별 채널 이름 (세션 uuid라 코드만으로는 추측 불가) */
export const liveTopic = (sessionId: string) => `live-${sessionId}`;
export const LIVE_EVENT = 'changed';

/** phase: 교사가 문제·단계를 바꿈 / response: 학생 제출 / join: 학생 접속 */
export type LiveChange = { kind: 'phase' | 'response' | 'join' };

/** closed(제출 마감)는 더 이상 쓰지 않아요 — 예전 수업 기록에만 남아 있을 수 있음 */
export type Phase = 'waiting' | 'open' | 'closed' | 'reveal' | 'ended';

/** 모든 객관식 문항에 자동으로 붙는 '모르겠어요' 선지 — 학생 답은 '0' 으로 저장 (오답 · 오개념 없음) */
export const DONT_KNOW = '0';
export const DONT_KNOW_LABEL = '모르겠어요';

export const CIRC = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
