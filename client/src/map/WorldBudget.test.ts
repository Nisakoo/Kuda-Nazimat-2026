import { describe, expect, it } from 'vitest';
import { BudgetExhausted, WorldBudget } from './WorldBudget';

describe('WorldBudget', () => {
  it('counts shared resources once until the last owner and enforces both caps', () => {
    const budget = new WorldBudget(1000, 200);
    const a = budget.reserve('a', 60, 120);
    const b = budget.reserve('a', 60, 120);
    expect(budget.stats).toMatchObject({ bytes: 60, memory: 120, resources: 1 });
    expect(() => budget.reserve('b', 41, 41)).toThrow(BudgetExhausted);
    expect(() => budget.reserve('b', 30, 81)).toThrow(BudgetExhausted);
    a.release(); a.release();
    expect(budget.stats.bytes).toBe(60);
    b.release();
    expect(budget.stats.bytes).toBe(0);
    expect(budget.epoch).toBe(1);
  });
  it('admits a whole chunk atomically and rejects conflicting metadata', () => {
    const budget = new WorldBudget(1000);
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
