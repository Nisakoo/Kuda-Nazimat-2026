/** Random IDs in the PROTO ID alphabet `[A-Za-z0-9_-]`, at most 80 characters. */
export function randomId(prefix: string, random: (bytes: number) => Uint8Array = (bytes) => crypto.getRandomValues(new Uint8Array(bytes))): string {
  let value = '';
  for (const byte of random(16)) value += (byte % 36).toString(36);
  return `${prefix}_${value}`;
}
