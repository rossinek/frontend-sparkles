// The planned final frame. The viewport keeps the photo's size; the photo is scaled, turned,
// and moved inside it, and the camera eases there once the paper has covered the photo.
// Everything lives on a sheet WIDE times larger than the photo, and the one rule is that
// the transformed sheet must cover the whole viewport.
//
// Lengths are in viewport heights with y up, so the viewport is `aspect` wide and 1 tall.

export const MAX_SCALE = 2
export const MAX_ROTATION = 45

/** Smallest scale at which the sheet, turned by `degrees`, still covers the viewport. */
export function minScale(degrees, aspect, wide) {
  const angle = (degrees * Math.PI) / 180
  const c = Math.abs(Math.cos(angle))
  const s = Math.abs(Math.sin(angle))
  return Math.max((aspect * c + s) / (wide * aspect), (aspect * s + c) / wide)
}

/**
 * What can actually be shown for the settings the user asked for. The stored values are
 * never changed here: scale is held above the minimum for the rotation, and the pan is
 * pulled back only as far as needed, so both come back when there is room again.
 *
 * @param {{ rotation: number, scale: number, pan: [number, number] }} wanted pan is where
 *   the photo's center sits, relative to the viewport's center
 * @returns {{ rotation: number, scale: number, pan: [number, number], minScale: number, still: boolean }}
 */
export function effective(wanted, aspect, wide) {
  const least = minScale(wanted.rotation, aspect, wide)
  const scale = Math.min(MAX_SCALE, Math.max(least, wanted.scale))
  const angle = (wanted.rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // The viewport seen from the photo's own axes: its center and the half-size of its bounds.
  const dx = -(cos * wanted.pan[0] + sin * wanted.pan[1]) / scale
  const dy = -(-sin * wanted.pan[0] + cos * wanted.pan[1]) / scale
  const roomX = Math.max(0, (wide * aspect) / 2 - (aspect * Math.abs(cos) + Math.abs(sin)) / (2 * scale))
  const roomY = Math.max(0, wide / 2 - (aspect * Math.abs(sin) + Math.abs(cos)) / (2 * scale))
  const cx = Math.min(roomX, Math.max(-roomX, dx))
  const cy = Math.min(roomY, Math.max(-roomY, dy))
  const pan = [-scale * (cos * cx - sin * cy), -scale * (sin * cx + cos * cy)]
  const still = Math.abs(wanted.rotation) < 0.01 && Math.abs(scale - 1) < 0.001 && Math.hypot(pan[0], pan[1]) < 0.0005
  return { rotation: wanted.rotation, scale, pan, minScale: least, still }
}
