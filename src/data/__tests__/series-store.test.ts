import { describe, it, expect } from 'vitest';
import { SeriesStore } from '../series-store';

function fa(values: number[]): Float64Array<ArrayBufferLike> {
  return new Float64Array(values) as unknown as Float64Array<ArrayBufferLike>;
}

describe('SeriesStore', () => {
  describe('setData (snapshot mode)', () => {
    it('preenche corretamente', () => {
      const s = new SeriesStore();
      s.setData(fa([0, 1, 2, 3]), fa([10, 20, 30, 40]));
      expect(s.count).toBe(4);
      expect(s.head).toBe(0);
      expect(s.xMin).toBe(0);
      expect(s.xMax).toBe(3);
      expect(s.yMin).toBe(10);
      expect(s.yMax).toBe(40);
    });

    it('com tamanhos diferentes lança erro', () => {
      const s = new SeriesStore();
      expect(() => s.setData(fa([0, 1]), fa([10]))).toThrow('must have same length');
    });

    it('com array vazio lança erro', () => {
      const s = new SeriesStore();
      expect(() => s.setData(fa([]), fa([]))).toThrow('must not be empty');
    });
  });

  describe('ring mode (append/appendBatch)', () => {
    it('append sem ring lança erro', () => {
      const s = new SeriesStore();
      expect(() => s.append(1, 10)).toThrow('maxPoints');
    });

    it('appendBatch sem ring lança erro', () => {
      const s = new SeriesStore();
      expect(() => s.appendBatch(fa([1]), fa([10]))).toThrow('maxPoints');
    });

    it('append funciona após initRing', () => {
      const s = new SeriesStore();
      s.initRing(10);
      s.append(0, 100);
      s.append(1, 200);
      expect(s.count).toBe(2);
      expect(s.lastValue).toBe(200);
    });

    it('appendBatch com arrays de tamanhos diferentes lança erro', () => {
      const s = new SeriesStore();
      s.initRing(10);
      expect(() => s.appendBatch(fa([1, 2]), fa([10]))).toThrow('same length');
    });

    it('appendBatch funciona', () => {
      const s = new SeriesStore();
      s.initRing(10);
      s.appendBatch(fa([0, 1, 2]), fa([10, 20, 30]));
      expect(s.count).toBe(3);
      expect(s.lastValue).toBe(30);
    });

    it('wrap-around no ring buffer preserva últimos N pontos', () => {
      const s = new SeriesStore();
      s.initRing(5);
      for (let i = 0; i < 10; i++) s.append(i, i * 10);
      expect(s.count).toBe(5);
      expect(s.lastValue).toBe(90);
      expect(s.yMin).toBe(50);
      expect(s.yMax).toBe(90);
    });
  });

  describe('setMaxPoints', () => {
    it('cria ring se não existir', () => {
      const s = new SeriesStore();
      s.setMaxPoints(10);
      s.append(0, 100);
      expect(s.count).toBe(1);
    });

    it('redimensiona ring existente', () => {
      const s = new SeriesStore();
      s.initRing(10);
      for (let i = 0; i < 10; i++) s.append(i, i);
      s.setMaxPoints(5);
      expect(s.count).toBe(5);
      expect(s.lastValue).toBe(9);
    });
  });

  describe('clear', () => {
    it('em snapshot mode', () => {
      const s = new SeriesStore();
      s.setData(fa([0, 1]), fa([10, 20]));
      s.clear();
      expect(s.count).toBe(0);
    });

    it('em ring mode', () => {
      const s = new SeriesStore();
      s.initRing(10);
      s.append(0, 100);
      s.clear();
      expect(s.count).toBe(0);
    });
  });

  describe('lastValue', () => {
    it('retorna NaN quando vazio', () => {
      const s = new SeriesStore();
      expect(s.lastValue).toBeNaN();
    });

    it('retorna último valor no ring', () => {
      const s = new SeriesStore();
      s.initRing(10);
      s.append(0, 100);
      s.append(1, 200);
      expect(s.lastValue).toBe(200);
    });
  });

  describe('bracketLogical', () => {
    it('encontra o bracket exato', () => {
      const s = new SeriesStore();
      s.setData(fa([10, 20, 30, 40]), fa([1, 2, 3, 4]));
      expect(s.bracketLogical(10)).toBe(0);
      expect(s.bracketLogical(25)).toBe(1);
      expect(s.bracketLogical(30)).toBe(2);
      expect(s.bracketLogical(50)).toBe(3);
    });

    it('clampa para [0, count-1]', () => {
      const s = new SeriesStore();
      s.setData(fa([10, 20, 30]), fa([1, 2, 3]));
      expect(s.bracketLogical(5)).toBe(0);
      expect(s.bracketLogical(100)).toBe(2);
    });
  });

  describe('physOf', () => {
    it('sem wrap', () => {
      const s = new SeriesStore();
      s.setData(fa([0, 1, 2]), fa([10, 20, 30]));
      expect(s.physOf(0)).toBe(0);
      expect(s.physOf(1)).toBe(1);
      expect(s.physOf(2)).toBe(2);
    });

    it('com wrap (ring mode)', () => {
      const s = new SeriesStore();
      s.initRing(3);
      s.append(0, 10);
      s.append(1, 20);
      s.append(2, 30);
      s.append(3, 40); // head = 1
      expect(s.physOf(0)).toBe(1);
      expect(s.physOf(1)).toBe(2);
      expect(s.physOf(2)).toBe(0);
    });
  });

  describe('degenerate y (flat)', () => {
    it('expande range ±1 quando todos os y são iguais', () => {
      const s = new SeriesStore();
      s.setData(fa([0, 1, 2]), fa([50, 50, 50]));
      expect(s.yMin).toBe(49);
      expect(s.yMax).toBe(51);
    });
  });

  describe('isRing', () => {
    it('retorna false em snapshot mode', () => {
      const s = new SeriesStore();
      s.setData(fa([0, 1]), fa([10, 20]));
      expect(s.isRing).toBe(false);
    });

    it('retorna true em ring mode', () => {
      const s = new SeriesStore();
      s.initRing(10);
      expect(s.isRing).toBe(true);
    });
  });
});
