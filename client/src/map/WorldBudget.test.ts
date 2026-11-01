import { describe, expect, it } from 'vitest';
import { BudgetExhausted, WorldBudget } from './WorldBudget';

describe('WorldBudget', () => {
  it('admits resources above the old cap and rejects one byte beyond 128 MiB by default', () => {
    const budget = new WorldBudget();
    const first = budget.reserve('models', 0, 96 * 1024 * 1024);
    const last = budget.reserve('audio-and-chunks', 0, 32 * 1024 * 1024);
    expect(budget.stats.memory).toBe(128 * 1024 * 1024);
    expect(() => budget.reserve('overflow', 0, 1)).toThrow(BudgetExhausted);
    last.release(); first.release();
    expect(budget.stats.memory).toBe(0);
  });
  it('waits for pending decoder ownership before a new world starts reserving data', async () => {
    const budget = new WorldBudget(1000);
    const first = budget.reserve('a', 60, 100); const second = budget.reserve('a', 60, 100);
    let empty = false; const waiting = budget.whenEmpty().then(() => { empty = true; });
    first.release(); await Promise.resolve(); expect(empty).toBe(false);
    second.release(); await waiting; expect(empty).toBe(true);
  });
  it('counts shared resources once until the last owner and enforces the memory guard', () => {
    const budget = new WorldBudget(200);
    const a = budget.reserve('a', 60, 120);
    const b = budget.reserve('a', 60, 120);
    expect(budget.stats).toMatchObject({ bytes: 60, memory: 120, resources: 1 });
    expect(() => budget.reserve('b', 30, 81)).toThrow(BudgetExhausted);
    const extra = budget.reserve('b', 70, 70);
    expect(budget.stats).toMatchObject({ bytes: 130, memory: 190 });
    extra.release();
    a.release(); a.release();
    expect(budget.stats.bytes).toBe(60);
    b.release();
    expect(budget.stats.bytes).toBe(0);
    expect(budget.epoch).toBe(2);
  });
  it('admits a whole chunk atomically and rejects conflicting metadata', () => {
    const budget = new WorldBudget(100);
    const items = [{ key: 'a', bytes: 60, memory: 60 }, { key: 'b', bytes: 50, memory: 50 }];
    expect(() => budget.reserveAll(items)).toThrow(BudgetExhausted);
    expect(budget.stats).toMatchObject({ bytes: 0, peakBytes: 0 });
    expect(() => budget.reserveAll([items[0]!, { ...items[0]!, bytes: 1 }])).toThrow('conflicting');
    const lease = budget.reserveAll([items[0]!, items[0]!]);
    expect(budget.stats.bytes).toBe(60);
    lease.release();
    expect(budget.stats.bytes).toBe(0);
  });
});
