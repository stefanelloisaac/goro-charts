import { describe, it, expect } from 'vitest';
import { roundedRect } from '../shape';
import { createMockCtx } from './ctx-mock';

describe('roundedRect', () => {
  it('traça o caminho arredondado', () => {
    const mc = createMockCtx();
    mc.beginPath();
    roundedRect(mc, 10, 20, 100, 50, 8);
    expect(mc.calls.moveTo.length).toBe(1);
    expect(mc.calls.closePath).toBe(1);
    // 4x arcTo + 1x moveTo + 1x closePath
    // moveTo + 4 arcTo + closePath ...
  });

  it('w ou h zero ou negativo: retorna sem chamar nada', () => {
    const mc = createMockCtx();
    roundedRect(mc, 0, 0, 0, 0, 5);
    expect(mc.calls.moveTo.length).toBe(0);
  });
});
