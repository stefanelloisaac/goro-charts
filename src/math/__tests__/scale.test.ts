import { describe, it, expect } from 'vitest';
import { xToPx, yToPx, pxToX } from '../scale';

const plot = { x: 50, y: 30, w: 400, h: 200 };

describe('xToPx', () => {
  it('mapeia xMin para plot.x', () => {
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    expect(xToPx(0, d, plot)).toBe(50);
  });

  it('mapeia xMax para plot.x + plot.w', () => {
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    expect(xToPx(100, d, plot)).toBe(450);
  });

  it('interpola linearmente', () => {
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    expect(xToPx(50, d, plot)).toBe(250);
  });

  it('range zero retorna plot.x', () => {
    const d = { xMin: 10, xMax: 10, yMin: 0, yMax: 100 };
    expect(xToPx(10, d, plot)).toBe(50);
  });
});

describe('yToPx', () => {
  it('mapeia yMin para plot.y + plot.h (y cresce para baixo)', () => {
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    expect(yToPx(0, d, plot)).toBe(230);
  });

  it('mapeia yMax para plot.y', () => {
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    expect(yToPx(100, d, plot)).toBe(30);
  });

  it('interpola linearmente', () => {
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    expect(yToPx(50, d, plot)).toBe(130);
  });

  it('range zero retorna plot.y', () => {
    const d = { xMin: 0, xMax: 100, yMin: 50, yMax: 50 };
    expect(yToPx(50, d, plot)).toBe(30);
  });
});

describe('pxToX', () => {
  it('inverso de xToPx', () => {
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    expect(pxToX(250, d, plot)).toBe(50);
  });

  it('range zero retorna xMin', () => {
    const d = { xMin: 42, xMax: 42, yMin: 0, yMax: 100 };
    expect(pxToX(250, d, plot)).toBe(42);
  });

  it('scaleType="time" produz o mesmo resultado que o padrão linear (epoch-ms é numérico)', () => {
    const d = { xMin: 1_700_000_000_000, xMax: 1_700_000_008_640_000, yMin: 0, yMax: 100 };
    const linear = pxToX(250, d, plot);
    const time = pxToX(250, d, plot, 'time');
    expect(time).toBe(linear);
  });

  it('scaleType="band" lança erro informativo', () => {
    const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    expect(() => pxToX(250, d, plot, 'band')).toThrow(/band scale is not implemented until v1\.9\.0/);
  });
});

describe('scaleType', () => {
  const d = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };

  it('xToPx com scaleType="time" é idêntico a linear (epoch-ms é contínuo)', () => {
    expect(xToPx(50, d, plot, 'time')).toBe(xToPx(50, d, plot));
    expect(xToPx(0, d, plot, 'time')).toBe(xToPx(0, d, plot));
    expect(xToPx(100, d, plot, 'time')).toBe(xToPx(100, d, plot));
  });

  it('xToPx com scaleType="band" lança erro informativo', () => {
    expect(() => xToPx(50, d, plot, 'band')).toThrow(/band scale is not implemented until v1\.9\.0/);
  });

  it('xToPx com scaleType omisso (undefined) usa linear sem erro', () => {
    expect(xToPx(50, d, plot, undefined)).toBe(250);
  });
});
