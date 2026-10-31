import { describe, expect, it } from 'vitest';
import { CHARACTER_MOTION, footTarget, legAngles, turnTowards } from './CharacterMotion';

describe('character contact and timing', () => {
  it('keeps the stance foot planted and solves the leg without changing the requested contact', () => {
    for (const phase of [.1,.5,1,2]) {
      const a=footTarget(phase,1);
      const b=footTarget(phase+.01,1);
      expect(b.lift).toBe(0);
      expect(b.forward-a.forward).toBeCloseTo(-.01*CHARACTER_MOTION.stride/(2*Math.PI),8);
      const pose=legAngles(a.forward,.69-a.lift);
      const z=-.38*Math.sin(pose.hip)-.38*Math.sin(pose.hip+pose.knee);
      const y=.38*Math.cos(pose.hip)+.38*Math.cos(pose.hip+pose.knee);
      expect(z).toBeCloseTo(a.forward,7);
      expect(y).toBeCloseTo(.69-a.lift,7);
      expect(pose.hip+pose.knee+pose.ankle).toBeCloseTo(0,10);
    }
  });
  it('converges to the same turn at 30 and 60 FPS, including the angular wrap', () => {
    const at=(fps:number)=>{let yaw=0;for(let i=0;i<fps*.2;i++)yaw=turnTowards(yaw,Math.PI,1/fps);return yaw;};
    expect(at(30)).toBeCloseTo(at(60),10);
    expect(Math.abs(at(30)-Math.PI)).toBeLessThan(5*Math.PI/180);
    const yaw=turnTowards(Math.PI-.05,-Math.PI+.05,1/60);
    expect(yaw).toBeGreaterThan(Math.PI-.05);
    expect(yaw).toBeLessThan(Math.PI+.05);
  });
  it('has continuous foot targets at stance/swing and cycle boundaries', () => {
    for(const phase of [0,Math.PI,2*Math.PI]) {
      const before=footTarget(phase-1e-7,1),after=footTarget(phase+1e-7,1);
      expect(Math.abs(before.forward-after.forward)).toBeLessThan(1e-6);
      expect(Math.abs(before.lift-after.lift)).toBeLessThan(1e-6);
    }
  });
});
