export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  return { count: sorted.length, median: percentile(.5), p95: percentile(.95), p99: percentile(.99), min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
}
export function summarize(raw) {
  const samples = raw.measurement?.samples ?? [], submitted = samples.filter(sample => sample.submitted);
  const intervals = raw.submissions.slice(1).map((at, index) => at - raw.submissions[index]);
  const phases = [...new Set(samples.flatMap(sample => Object.keys(sample.cpu)))];
  return { durationMs: raw.durationMs, loopFps: raw.loops.length * 1000 / raw.durationMs, submittedFps: raw.submissions.length * 1000 / raw.durationMs,
    outerRenderCpuMs: distribution(raw.outerRenderCpu ?? []),
    submitted: raw.submissions.length, skipped: raw.loops.length - raw.submissions.length, intervals: distribution(intervals),
    cpu: Object.fromEntries(phases.map(phase => [phase, distribution(samples.map(sample => sample.cpu[phase]))])),
    gpuMs: distribution(submitted.map(sample => sample.gpuMs).filter(ms => ms !== null)),
    gpuShadowMs: distribution(submitted.map(sample => sample.gpuShadowMs).filter(ms => ms != null)),
    gpuMainMs: distribution(submitted.map(sample => sample.gpuMainMs).filter(ms => ms != null)),
    cpuShadowMs: distribution(submitted.map(sample => sample.cpuShadowMs).filter(ms => ms != null)),
    shadowCalls: distribution(submitted.map(sample => sample.shadowCalls).filter(count => count != null)),
    shadowTriangles: distribution(submitted.map(sample => sample.shadowTriangles).filter(count => count != null)),
    calls: distribution(submitted.map(sample => sample.calls)), triangles: distribution(submitted.map(sample => sample.triangles)),
    saturatedCalls: distribution(submitted.filter(sample => sample.at - raw.startedAt >= 9000 && sample.at - raw.startedAt < 10000).map(sample => sample.calls)),
  };
}
