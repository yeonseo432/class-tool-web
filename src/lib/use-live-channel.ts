'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LIVE_EVENT, liveTopic, type LiveChange } from '@/lib/live';

/**
 * 수업 채널을 구독해서 신호가 오면 onChange 를 부름.
 * - 신호를 놓쳐도 따라잡도록 fallbackMs 마다 한 번씩도 부름
 * - 탭이 다시 보이거나 다시 연결될 때도 부름
 * channel 이 없으면(아직 참여 전 · 수업 종료) 아무것도 하지 않음.
 */
export function useLiveChannel(channel: string | null | undefined, onChange: (c: LiveChange | null) => void, fallbackMs = 15000) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  useEffect(() => {
    if (!channel) return;
    const sb = createClient();
    const ch = sb
      .channel(liveTopic(channel))
      .on('broadcast', { event: LIVE_EVENT }, (m) => cb.current((m.payload as LiveChange) ?? null))
      .subscribe((status) => {
        // 구독이 연결되는 순간(처음 · 재연결)마다 한 번 새로 불러옴:
        // 화면을 처음 불러온 뒤 ~ 구독 완료 사이, 또는 끊긴 동안 온 신호를 놓치지 않도록
        if (status === 'SUBSCRIBED') cb.current(null);
      });
    const t = setInterval(() => cb.current(null), fallbackMs);
    const onVis = () => document.visibilityState === 'visible' && cb.current(null);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      sb.removeChannel(ch);
    };
  }, [channel, fallbackMs]);
}
