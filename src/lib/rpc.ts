/*
 * 브라우저 → 서버 호출 (기존 google.script.run 대체)
 *   teacherApi('bootstrap')            → POST /api/teacher
 *   studentApi('studentState', code)   → POST /api/student
 */
export class RpcError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function post<T>(url: string, fn: string, args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fn, args }),
      cache: 'no-store',
    });
  } catch {
    throw new RpcError('인터넷 연결을 확인해 주세요.', 0);
  }
  const j = await res.json().catch(() => null);
  if (!j || !j.ok) throw new RpcError(j?.error ?? `서버 오류 (${res.status})`, res.status, j?.code);
  return j.data as T;
}

export const teacherApi = <T = unknown>(fn: string, ...args: unknown[]) => post<T>('/api/teacher', fn, args);
export const studentApi = <T = unknown>(fn: string, ...args: unknown[]) => post<T>('/api/student', fn, args);
