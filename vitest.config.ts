import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/__setup.ts',
        'src/index.ts',
        'src/presets.ts',
        'src/types.ts',
      ],
      // Branches sits lower than the others because chart-base.ts holds the
      // DOM interaction orchestration (mouse/resize/rAF, dual-Y, stacking)
      // whose many conditional paths aren't fully driven under happy-dom.
      // vitest 4's coverage-v8 counts branches more strictly than v3 did, so
      // the branch floor is calibrated to the current honest baseline.
      thresholds: {
        statements: 70,
        branches: 55,
        functions: 75,
        lines: 70,
      },
    },
  },
});
