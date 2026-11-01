import { parseGameRuntimeConfig } from '../../../shared/protocol/npcTiming.ts';

/** Fetch only the public timing setting, with a bounded response and deadline. */
export async function requestRuntimeConfig(serverUrl: string, signal: AbortSignal): Promise<number> {
  const controller = new AbortController();
  let rejectAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => { controller.abort(); rejectAbort(new Error('Runtime configuration request cancelled')); };
  if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 5000);
  const load = async (): Promise<number> => {
    const response = await fetch(new URL(`${serverUrl.replace(/\/$/, '')}/api/game-config`), {
      signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
    });
    if (!response.ok || !response.body) throw new Error('Runtime configuration unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024) throw new Error('Runtime configuration too large');
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseGameRuntimeConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))).npcTimeoutMs;
  };
  try { return await Promise.race([load(), aborted]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); controller.abort(); }
}
