import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { LIVE_EVENT, liveTopic, type LiveChange } from '@/lib/live';

/**
 * 수업 화면들에 "바뀌었어요" 신호를 보냄 (구독 없이 HTTP 한 번).
 * 신호가 실패해도 화면의 느린 폴링이 따라잡으므로, 원래 동작은 실패시키지 않음.
 */
export async function notifyLive(sessionId: string, kind: LiveChange['kind']) {
  try {
    const sb = createAdminClient();
    const ch = sb.channel(liveTopic(sessionId));
    try {
      await ch.httpSend(LIVE_EVENT, { kind } satisfies LiveChange);
    } finally {
      await sb.removeChannel(ch);
    }
  } catch (e) {
    console.warn('[realtime] notify failed', sessionId, kind, e);
  }
}
