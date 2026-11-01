/** Bound JSON response bytes before decoding. HTTP adapters must not buffer arbitrary bodies. */
export async function readBoundedJson(response: Response, maxBytes = 4096): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Сервер вернул пустой ответ.');
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      length += item.value.length;
      if (length > maxBytes) throw new Error('Ответ сервера превышает допустимый размер.');
      chunks.push(item.value);
    }
  } finally { await reader.cancel(); }
  const data = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(data)); }
  catch { throw new Error('Сервер вернул некорректный ответ.'); }
}
