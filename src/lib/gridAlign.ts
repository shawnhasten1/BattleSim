/**
 * Align grid (MAP_IMPORT_PLAN.md, Phase 3): lining the map's grid up with a
 * grid drawn on the image itself, for images that aren't VTT exports. All in
 * the image's own (source) pixels. Pure: no DOM.
 */

export interface SourcePoint {
  x: number;
  y: number;
}

/** A pin being aligned: px per square and where the grid's corner sits in the image. */
export interface AlignPin {
  pxPerSquare: number;
  originX: number;
  originY: number;
}

/** The smallest px per square nudging can reach. */
export const MIN_ALIGN_PX = 4;

/**
 * An origin, as the grid line nearest the image's top-left edge: `value` mod
 * `pxPerSquare`, except that a line a hair short of a whole square (measuring
 * error) counts as the edge itself, so a map whose grid starts at its edge
 * keeps its first column instead of losing it.
 */
export function normalizeOrigin(value: number, pxPerSquare: number): number {
  const remainder = ((value % pxPerSquare) + pxPerSquare) % pxPerSquare;
  const tolerance = Math.max(2, pxPerSquare * 0.03);
  return pxPerSquare - remainder < tolerance ? remainder - pxPerSquare : remainder;
}

/**
 * The pin a box drawn on the image gives: corners `a` and `b` are grid
 * corners of the image's own grid, `across` × `down` squares apart (either may
 * be 0 for two points on one line). Cells are square, so px per square comes
 * from both sides at once, the longer side counting for more.
 */
export function pinFromBox(a: SourcePoint, b: SourcePoint, across: number, down: number): AlignPin | null {
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  if (across < 0 || down < 0 || across + down < 1) return null;
  const measured = (across > 0 ? width : 0) + (down > 0 ? height : 0);
  const pxPerSquare = measured / (across + down);
  if (!(pxPerSquare >= MIN_ALIGN_PX)) return null;
  return {
    pxPerSquare,
    originX: normalizeOrigin(Math.min(a.x, b.x), pxPerSquare),
    originY: normalizeOrigin(Math.min(a.y, b.y), pxPerSquare)
  };
}

/**
 * What a new box spans until the DM says otherwise: one square (the usual way
 * to box a grid), or none along a side too thin to be one (two points on the
 * same grid line).
 */
export function defaultBoxCounts(a: SourcePoint, b: SourcePoint): { across: number; down: number } {
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  const longer = Math.max(width, height);
  return { across: width < longer * 0.25 ? 0 : 1, down: height < longer * 0.25 ? 0 : 1 };
}

/** Move the image by (dx, dy) source px under the grid: right and down are positive. */
export function nudgePin(pin: AlignPin, dx: number, dy: number): AlignPin {
  return { ...pin, originX: pin.originX - dx, originY: pin.originY - dy };
}

/** Change px per square by `delta`, keeping the grid's corner where it is in the image. */
export function resizePin(pin: AlignPin, delta: number): AlignPin {
  return { ...pin, pxPerSquare: Math.max(MIN_ALIGN_PX, Math.round((pin.pxPerSquare + delta) * 1000) / 1000) };
}

/** A grid found in an image's pixels, in those pixels. */
export interface DrawnGrid extends AlignPin {
  /** How far the grid lines stand out from the art between them: higher is surer. */
  contrast: number;
}

/** Px either side a line is compared against: lines up to about 6 px wide read as one ridge. */
const RIDGE_PX = 3;
/** Smoothing that takes the art's slow changes out of a profile, leaving sharp lines. */
const TREND_WINDOW = 15;
/** The tightest spacing looked for, and the fewest squares an image must show along a side. */
const MIN_PERIOD_PX = 8;
const MIN_SQUARES_SEEN = 4;
/** How far the lines must stand out (a tooth of the comb against the profile's average). */
const MIN_CONTRAST = 3;

/** Each column's and each row's ridge strength: how much it differs from the pixels either side. */
function ridgeProfiles(luma: ArrayLike<number>, width: number, height: number) {
  const columns = new Float64Array(width);
  const rows = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = RIDGE_PX; x < width - RIDGE_PX; x++) {
      columns[x] += Math.abs(2 * luma[row + x] - luma[row + x - RIDGE_PX] - luma[row + x + RIDGE_PX]);
    }
  }
  for (let y = RIDGE_PX; y < height - RIDGE_PX; y++) {
    const row = y * width;
    const above = (y - RIDGE_PX) * width;
    const below = (y + RIDGE_PX) * width;
    let sum = 0;
    for (let x = 0; x < width; x++) sum += Math.abs(2 * luma[row + x] - luma[above + x] - luma[below + x]);
    rows[y] = sum;
  }
  return { columns, rows };
}

/** A profile with its slow trend taken out and only what rises above it kept: the lines. */
function peaksOf(profile: Float64Array): Float64Array {
  const n = profile.length;
  const half = Math.floor(TREND_WINDOW / 2);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + profile[i];
  const peaks = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(n, i + half + 1);
    peaks[i] = Math.max(0, profile[i] - (prefix[to] - prefix[from]) / (to - from));
  }
  return peaks;
}

/** The signal at a fractional position, linearly interpolated. */
function sampleAt(signal: Float64Array, position: number): number {
  const i = Math.floor(position);
  if (i < 0 || i >= signal.length - 1) return i === signal.length - 1 ? signal[i] : 0;
  const f = position - i;
  return signal[i] * (1 - f) + signal[i + 1] * f;
}

/** The phase where a comb of `period` lands best on the lines, and the average height of its teeth there. */
function bestPhase(signal: Float64Array, period: number): { phase: number; tooth: number } {
  let best = { phase: 0, tooth: 0 };
  for (let phase = 0; phase < period; phase += 0.25) {
    let sum = 0;
    let teeth = 0;
    for (let at = phase; at < signal.length - 1; at += period) {
      sum += sampleAt(signal, at);
      teeth++;
    }
    const tooth = teeth ? sum / teeth : 0;
    if (tooth > best.tooth) best = { phase, tooth };
  }
  return best;
}

/** The spacing a profile repeats at, if it clearly does: autocorrelation, then a comb across the whole length. */
function repeatOf(signal: Float64Array): { period: number; phase: number; contrast: number } | null {
  const n = signal.length;
  const maxPeriod = Math.floor(n / MIN_SQUARES_SEEN);
  if (maxPeriod < MIN_PERIOD_PX) return null;
  let energy = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    energy += signal[i] * signal[i];
    total += signal[i];
  }
  if (energy === 0) return null;
  const correlation = new Float64Array(maxPeriod + 2);
  for (let lag = MIN_PERIOD_PX - 1; lag <= maxPeriod + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += signal[i] * signal[i + lag];
    correlation[lag] = sum / energy;
  }
  let strongest = 0;
  for (let lag = MIN_PERIOD_PX; lag <= maxPeriod; lag++) strongest = Math.max(strongest, correlation[lag]);
  if (strongest <= 0) return null;
  // The first clear peak: multiples of the spacing repeat it too, nearly as strongly.
  let lag = -1;
  for (let candidate = MIN_PERIOD_PX; candidate <= maxPeriod; candidate++) {
    const value = correlation[candidate];
    if (value >= 0.75 * strongest && value >= correlation[candidate - 1] && value >= correlation[candidate + 1]) {
      lag = candidate;
      break;
    }
  }
  if (lag < 0) return null;
  // Closer: across the whole length a slightly wrong spacing drifts off the lines.
  let best = { period: lag, phase: 0, tooth: 0 };
  for (let period = lag - 1; period <= lag + 1; period += 0.02) {
    const { phase, tooth } = bestPhase(signal, period);
    if (tooth > best.tooth) best = { period, phase, tooth };
  }
  const contrast = best.tooth / (total / n);
  if (contrast < MIN_CONTRAST) return null;
  // Exact: where each line really is, fitted with a straight line.
  let fit = { period: best.period, phase: best.phase };
  for (let pass = 0; pass < 2; pass++) fit = fitLines(signal, fit.period, fit.phase);
  return { ...fit, contrast };
}

/**
 * Spacing and phase from the lines themselves: each line's position is where
 * its ridge's weight sits (above the window's own average, so noise around a
 * line doesn't pull it toward the guess) near where the comb put it, and
 * position = phase + k × spacing is fitted to them by least squares, weighted
 * by how strong each line is (art over a line leaves it out). With `period`
 * fixed, only the phase is fitted.
 */
function fitLines(signal: Float64Array, period: number, phase: number, fixedPeriod = false): { period: number; phase: number } {
  const half = Math.min(10, Math.max(4, period / 4));
  let sw = 0;
  let sk = 0;
  let sp = 0;
  let skk = 0;
  let skp = 0;
  let lines = 0;
  for (let k = 0; phase + k * period < signal.length; k++) {
    const expected = phase + k * period;
    const from = Math.ceil(expected - half);
    const to = Math.floor(expected + half);
    // A line at the image's very edge has only part of its ridge, which would skew it: leave it out.
    if (from < RIDGE_PX || to > signal.length - 1 - RIDGE_PX) continue;
    let baseline = 0;
    for (let i = from; i <= to; i++) baseline += signal[i];
    baseline /= Math.max(1, to - from + 1);
    let weight = 0;
    let moment = 0;
    for (let i = from; i <= to; i++) {
      const above = signal[i] - baseline;
      if (above <= 0) continue;
      weight += above;
      moment += above * i;
    }
    if (weight <= 0) continue;
    const position = moment / weight;
    sw += weight;
    sk += weight * k;
    sp += weight * position;
    skk += weight * k * k;
    skp += weight * k * position;
    lines++;
  }
  if (lines === 0) return { period, phase };
  if (fixedPeriod || lines < 3) return { period, phase: (sp - period * sk) / sw };
  const slope = (sw * skp - sk * sp) / (sw * skk - sk * sk);
  if (!Number.isFinite(slope) || Math.abs(slope - period) > 1) return { period, phase };
  return { period: slope, phase: (sp - slope * sk) / sw };
}

/**
 * Find a grid drawn on an image: dark or light lines at a fixed spacing, from
 * its luma (0–255, row by row). Lines show as ridges, so each column's and
 * row's ridge strength makes a profile; the spacing is where a profile best
 * repeats, refined to a fraction of a pixel by how well a comb of that spacing
 * lands on the lines across the whole image. Cells are square, so one spacing
 * serves both sides (the surer side's, if they disagree). Null when nothing
 * clearly repeats. Deterministic: no randomness and no training.
 */
export function findDrawnGrid(luma: ArrayLike<number>, width: number, height: number): DrawnGrid | null {
  if (width <= 2 * RIDGE_PX || height <= 2 * RIDGE_PX || luma.length < width * height) return null;
  const profiles = ridgeProfiles(luma, width, height);
  const columns = peaksOf(profiles.columns);
  const rows = peaksOf(profiles.rows);
  const across = repeatOf(columns);
  const down = repeatOf(rows);
  if (!across && !down) return null;
  let pxPerSquare: number;
  if (across && down) {
    const agree = Math.abs(across.period - down.period) / across.period <= 0.02;
    pxPerSquare = agree ? (across.period + down.period) / 2 : across.contrast >= down.contrast ? across.period : down.period;
  } else {
    pxPerSquare = (across ?? down)!.period;
  }
  // Each side's lines, at the shared spacing. Profiles are indexed by pixel, and pixel i covers [i, i + 1):
  // + 0.5 puts the grid line through the middle of the drawn one.
  const phaseOf = (signal: Float64Array, found: { phase: number }) =>
    normalizeOrigin(fitLines(signal, pxPerSquare, found.phase, true).phase + 0.5, pxPerSquare);
  return {
    pxPerSquare,
    originX: across ? phaseOf(columns, across) : 0,
    originY: down ? phaseOf(rows, down) : 0,
    contrast: Math.max(across?.contrast ?? 0, down?.contrast ?? 0)
  };
}
