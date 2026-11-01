// Unicode letter/script ranges pinned together with llm/local_common.py. This is
// a narrow Cyrillic guard, not language detection. Marks and digits are not letters.
const LATIN = '41-5a,61-7a,aa,ba,c0-d6,d8-f6,f8-2b8,2e0-2e4,1d00-1d25,1d2c-1d5c,1d62-1d65,1d6b-1d77,1d79-1dbe,1e00-1eff,2071,207f,2090-209c,212a-212b,2132,214e,2183-2184,2c60-2c7f,a722-a787,a78b-a7dc,a7f1-a7ff,ab30-ab5a,ab5c-ab64,ab66-ab69,fb00-fb06,ff21-ff3a,ff41-ff5a,10780-10785,10787-107b0,107b2-107ba,1df00-1df1e,1df25-1df2a';
const CYRILLIC = '400-481,48a-52f,1c80-1c8a,1d2b,1d78,a640-a66e,a67f-a69d,1e030-1e06d';
const ranges = (value: string) => value.split(',').map(part => {
  const [first, last = first] = part.split('-');
  return [parseInt(first!, 16), parseInt(last!, 16)] as const;
});
const latinRanges = ranges(LATIN), cyrillicRanges = ranges(CYRILLIC);
const contains = (point: number, values: readonly (readonly [number, number])[]) => values.some(([a, b]) => point >= a && point <= b);

export function hasObviousCyrillicReply(text: string): boolean {
  let latin = 0, cyrillic = 0, runs = 0, inRun = false;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    const isCyrillic = contains(point, cyrillicRanges);
    if (isCyrillic) { cyrillic++; if (!inRun) runs++; }
    else if (contains(point, latinRanges)) latin++;
    inRun = isCyrillic;
  }
  return (cyrillic > 0 && latin === 0) || (cyrillic >= 12 && runs >= 3 && cyrillic > latin);
}
