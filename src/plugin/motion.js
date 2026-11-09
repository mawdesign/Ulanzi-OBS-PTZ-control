// What a hold key (Move, Zoom) asks of the camera, worked out from its settings.
//
// SIGN CONVENTION (provisional): OBS-PTZ documents ptz_move speeds as "a positive speed increases the
// position": +pan = right, +tilt = up, +zoom = zoom in. That is written down in one place, here, and
// still has to be confirmed on a real camera (see TODO.md). If a direction is wrong, fix it here only.

/** [pan, tilt] unit direction for each compass direction. */
export const PAN_TILT = Object.freeze({
  n: [0, 1],
  ne: [1, 1],
  e: [1, 0],
  se: [1, -1],
  s: [0, -1],
  sw: [-1, -1],
  w: [-1, 0],
  nw: [-1, 1],
});
export const ZOOM_DIRECTIONS = Object.freeze({ in: 1, out: -1 });

export const HOLD_KINDS = new Set(['move', 'zoom']);
export const HOLD_DEFAULTS = Object.freeze({ speed: 0.5, watchdogSeconds: 10 });
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 1;
export const MIN_WATCHDOG_SECONDS = 1;
export const MAX_WATCHDOG_SECONDS = 600;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const number = (v, fallback) => (v === '' || v == null || !Number.isFinite(Number(v)) ? fallback : Number(v));
const round = (n) => Math.round(n * 1000) / 1000;

/**
 * @param {'move'|'zoom'} kind
 * @param {Record<string, any>} params the key's settings (anything missing or invalid gets its default)
 * @returns {{ direction: string, start: Record<string, number>, stop: Record<string, number>, watchdogMs: number, icon: string }}
 *   start: the speeds sent on key down. stop: the same axes at 0, sent on release; only axes this key
 *   moves are named, so releasing one key never stops an axis another held key is driving.
 */
export function holdSpec(kind, params = {}) {
  const speed = round(clamp(number(params.speed, HOLD_DEFAULTS.speed), MIN_SPEED, MAX_SPEED));
  const watchdogMs = Math.round(clamp(number(params.watchdog, HOLD_DEFAULTS.watchdogSeconds), MIN_WATCHDOG_SECONDS, MAX_WATCHDOG_SECONDS) * 1000);
  if (kind === 'zoom') {
    const direction = params.direction in ZOOM_DIRECTIONS ? params.direction : 'in';
    return {
      direction,
      start: { zoom: round(ZOOM_DIRECTIONS[direction] * speed) },
      stop: { zoom: 0 },
      watchdogMs,
      icon: `./resources/zoom-${direction}.svg`,
    };
  }
  const direction = params.direction in PAN_TILT ? params.direction : 'n';
  const [pan, tilt] = PAN_TILT[direction];
  const start = {};
  const stop = {};
  if (pan) (start.pan = round(pan * speed)), (stop.pan = 0);
  if (tilt) (start.tilt = round(tilt * speed)), (stop.tilt = 0);
  return { direction, start, stop, watchdogMs, icon: `./resources/move-${direction}.svg` };
}

/** The camera features a hold key needs, one per axis it drives. */
export const requiredHoldFeatures = (spec) => Object.keys(spec.start);
