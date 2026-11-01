/** Separate local ports let isolated worktrees run without using another session's server. */
function port(value: string | undefined, fallback: number): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error('Invalid Playwright server port');
  return result;
}
export const browserTestPort = port(process.env.PLAYWRIGHT_PORT, 4173);
export const browserTestOrigin = `http://127.0.0.1:${browserTestPort}`;
export const renderTestPort = port(process.env.PLAYWRIGHT_RENDER_PORT, 5174);
export const renderTestOrigin = `http://127.0.0.1:${renderTestPort}`;
