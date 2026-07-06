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
      expect(() => s.setData(fa([0, 1]), fa([10]))).toThrow('length mismatch');
    });

    it('com array vazio lança erro', () => {
      const s = new SeriesStore();
      expect(() => s.setData(fa([]), fa([]))).toThrow('must not be empty');
    });

    describe('ownership (copy vs borrowed)', () => {
      it('default = copy: mutação externa não afeta o store', () => {
        const s = new SeriesStore();
        const x = fa([0, 1, 2]);
        const y = fa([10, 20, 30]);
        s.setData(x, y);
        x[0] = 999;
        y[0] = 888;
        expect(s.xArr[0]).toBe(0);
        expect(s.yArr[0]).toBe(10);
      });

      it('borrowed: store reflete mutação externa (responsabilidade do caller)', () => {
        const s = new SeriesStore();
        const x = fa([0, 1, 2]);
        const y = fa([10, 20, 30]);
        s.setData(x, y, 'borrowed');
        x[0] = 999;
        expect(s.xArr[0]).toBe(999);
      });

      it('copy é thread-safe com a flag explícita', () => {
        const s = new SeriesStore();
        const x = fa([0, 1]);
        const y = fa([10, 20]);
        s.setData(x, y, 'copy');
        x[0] = 555;
        expect(s.xArr[0]).toBe(0);
      });
    });

    describe('validação de X', () => {
      it('rejeita Infinity em X com posição', () => {
        const s = new SeriesStore();
        const x = fa([0, 1, Infinity]);
        expect(() => s.setData(x, fa([10, 20, 30]))).toThrow('x[2]=Infinity is not finite');
      });

      it('rejeita -Infinity em X com posição', () => {
        const s = new SeriesStore();
        const x = fa([0, -Infinity, 2]);
        expect(() => s.setData(x, fa([10, 20, 30]))).toThrow('x[1]=-Infinity is not finite');
      });

      it('rejeita NaN em X com posição', () => {
        const s = new SeriesStore();
        const x = fa([0, NaN, 2]);
        expect(() => s.setData(x, fa([10, 20, 30]))).toThrow('x[1]=NaN is not finite');
      });

      it('rejeita X não monotônico com posição', () => {
        const s = new SeriesStore();
        const x = fa([0, 5, 3, 10]);
        expect(() => s.setData(x, fa([10, 20, 30, 40]))).toThrow(/x not monotonically increasing at index 2/);
      });

      it('rejeita X não finito no primeiro elemento', () => {
        const s = new SeriesStore();
        expect(() => s.setData(fa([Infinity, 1]), fa([10, 20]))).toThrow('x[0]=Infinity is not finite');
      });
    });

    describe('validação de Y', () => {
      it('rejeita Infinity em Y', () => {
        const s = new SeriesStore();
        expect(() => s.setData(fa([0, 1]), fa([10, Infinity]))).toThrow('y[1]=Infinity is not finite');
      });

      it('rejeita -Infinity em Y', () => {
        const s = new SeriesStore();
        expect(() => s.setData(fa([0, 1]), fa([-Infinity, 20]))).toThrow('y[0]=-Infinity is not finite');
      });

      it('aceita NaN em Y (reservado para gaps v1.6.0)', () => {
        const s = new SeriesStore();
        expect(() => s.setData(fa([0, 1, 2]), fa([10, NaN, 30]))).not.toThrow();
        expect(s.count).toBe(3);
      });

      it('NaN em Y é excluído do extent', () => {
        const s = new SeriesStore();
        s.setData(fa([0, 1, 2, 3]), fa([10, NaN, 100, NaN]));
        // extent should be [10, 100] (NaN skipped)
        expect(s.yMin).toBe(10);
        expect(s.yMax).toBe(100);
      });

      it('todos Y NaN produzem range degenerado seguro', () => {
        const s = new SeriesStore();
        s.setData(fa([0, 1, 2]), fa([NaN, NaN, NaN]));
        expect(s.yMin).toBe(-1);
        expect(s.yMax).toBe(1);
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

      it('append com x não finito lança erro', () => {
        const s = new SeriesStore();
        s.initRing(10);
        expect(() => s.append(Infinity, 10)).toThrow('append x=Infinity is not finite');
      });

      it('append com x menor que xLast lança erro (não mais console.warn)', () => {
        const s = new SeriesStore();
        s.initRing(10);
        s.append(5, 100);
        expect(() => s.append(3, 200)).toThrow('monotonically increasing');
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

      it('appendBatch valida batch inteiro antes de empurrar (x não finito)', () => {
        const s = new SeriesStore();
        s.initRing(10);
        s.append(0, 100); // estado inicial
        expect(() => s.appendBatch(fa([1, Infinity]), fa([10, 20]))).toThrow('xs[1]=Infinity is not finite');
        // O estado não deve ter sido corrompido
        expect(s.count).toBe(1);
      });

      it('appendBatch valida batch inteiro antes de empurrar (não monotônico)', () => {
        const s = new SeriesStore();
        s.initRing(10);
        s.append(0, 100);
        expect(() => s.appendBatch(fa([1, 3, 2]), fa([10, 20, 30]))).toThrow(/batch index 2/);
        expect(s.count).toBe(1);
      });

      it('appendBatch com batch vazio não faz nada', () => {
        const s = new SeriesStore();
        s.initRing(10);
        s.append(0, 100);
        s.appendBatch(fa([]), fa([]));
        expect(s.count).toBe(1);
      });

      it('append com y Infinity lança erro (paridade com snapshot)', () => {
        const s = new SeriesStore();
        s.initRing(10);
        expect(() => s.append(0, Infinity)).toThrow('append y=Infinity is not finite');
      });

      it('append com y -Infinity lança erro', () => {
        const s = new SeriesStore();
        s.initRing(10);
        expect(() => s.append(0, -Infinity)).toThrow('append y=-Infinity is not finite');
      });

      it('append aceita NaN em Y (não lança, excluído do extent)', () => {
        const s = new SeriesStore();
        s.initRing(10);
        s.append(0, 10);
        expect(() => s.append(1, NaN)).not.toThrow();
        s.append(2, 30);
        expect(s.count).toBe(3);
        expect(s.yMin).toBe(10);
        expect(s.yMax).toBe(30);
      });

      it('appendBatch com y Infinity lança erro e não corrompe estado', () => {
        const s = new SeriesStore();
        s.initRing(10);
        s.append(0, 100); // estado inicial
        expect(() => s.appendBatch(fa([1, 2]), fa([10, Infinity]))).toThrow('ys[1]=Infinity is not finite');
        expect(s.count).toBe(1);
      });

      it('appendBatch aceita NaN em Y (excluído do extent)', () => {
        const s = new SeriesStore();
        s.initRing(10);
        s.appendBatch(fa([0, 1, 2]), fa([50, NaN, 90]));
        expect(s.count).toBe(3);
        expect(s.yMin).toBe(50);
        expect(s.yMax).toBe(90);
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
});
