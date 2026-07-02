# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

Initial stable release.

### Added

- **LineChart** — batched polyline with per-pixel-column min/max decimation.
- **AreaChart** — filled region below the line, same decimation path, separate fill/stroke.
- **ScatterChart** — stride-thinned scatter plot, one circle per sampled point.
- **Multi-series** — one chart, many series, each with its own colour, width, fill, dash, and Y-axis.
- **Dual Y-axis** — independent left and right domains, per-series axis assignment.
- **Stacked area** — series sharing a `stack` id render cumulatively (AreaChart),
  with the same per-pixel-column decimation as line/area so large windows stay
  cheap (flat draw cost regardless of window size).
- **Fixed Y range** — lock the grid globally with `yMin`/`yMax`, or per-series overrides.
- **Streaming ring mode** — O(1) append and O(1) sliding-window min/max via monotonic
  deques. The grid Y domain tracks the sliding window (grows and shrinks) so bands
  never drift past the frame; snapshot mode keeps the expand-only anchor.
- **Snapshot mode** — full-series replacement via `setData` with columnar `Float64Array` data.
- **Crosshair** — multi-series interpolated tooltip card, keyboard navigation, chart-to-chart sync.
- **Accessibility** — `role="img"`, dynamic `aria-label`, `aria-live` announcements,
  `prefers-reduced-motion`, `prefers-contrast`, and `forced-colors` support.
- **Rendering** — `devicePixelRatio`-aware, offscreen static layer with 1:1 blit,
  `ResizeObserver` auto-sizing, `rAF`-coalesced auto-draw.
- **DARK** / **LIGHT** colour presets.
- **PNG export** via `toImage()`.
