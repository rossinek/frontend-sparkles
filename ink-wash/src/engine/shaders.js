export const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export const LUMA = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
void main() {
  float l = dot(texture(uSource, vUv).rgb, vec3(0.299, 0.587, 0.114));
  outColor = vec4(l, l, l, 1.0);
}`

export const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uStep;
uniform float uSigma;
void main() {
  float sum = 0.0;
  float weight = 0.0;
  for (int i = -18; i <= 18; i++) {
    float x = float(i);
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    sum += texture(uSource, vUv + uStep * x).r * w;
    weight += w;
  }
  outColor = vec4(vec3(sum / weight), 1.0);
}`

// R: pencil line, G: smoothed luminance, B: edge strength (slows the ink), A: unused.
export const SKETCH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFine, uMid, uCoarse, uMatte;
uniform vec2 uTexel;
uniform float uDetail;
void main() {
  float fine = texture(uFine, vUv).r;
  float mid = texture(uMid, vUv).r;
  float coarse = texture(uCoarse, vUv).r;
  // A stroke sits on the darker side of an edge, relative to local brightness.
  float thinEdge = (mid - fine) / (mid + 0.14);
  float broadEdge = (coarse - mid) / (coarse + 0.14);
  // Detail scales the sensitivity tenfold end to end; 0.5 is neutral.
  float gain = pow(0.1, uDetail - 0.5);
  float thin = smoothstep(0.013 * gain, 0.075 * gain, thinEdge);
  float broad = smoothstep(0.03 * gain, 0.14 * gain, broadEdge);
  vec2 d = uTexel * 1.5;
  float mx = textureLod(uMatte, vUv + vec2(d.x, 0.0), 1.0).r - textureLod(uMatte, vUv - vec2(d.x, 0.0), 1.0).r;
  float my = textureLod(uMatte, vUv + vec2(0.0, d.y), 1.0).r - textureLod(uMatte, vUv - vec2(0.0, d.y), 1.0).r;
  float outline = smoothstep(0.25, 0.7, length(vec2(mx, my)));
  float line = clamp(max(thin + broad * 0.45, outline * 0.75), 0.0, 1.0);
  // The ink's resistance uses neutral sensitivity, so the pour does not change with the slider.
  float neutral = clamp(max(smoothstep(0.013, 0.075, thinEdge) + smoothstep(0.03, 0.14, broadEdge) * 0.45, outline * 0.75), 0.0, 1.0);
  float edge = clamp(abs(fine - coarse) * 5.0 + neutral * 0.6, 0.0, 1.0);
  outColor = vec4(line, fine, edge, 1.0);
}`

export const PROBE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSketch, uMatte;
void main() {
  vec4 s = texture(uSketch, vUv);
  outColor = vec4(texture(uMatte, vUv).r, s.g, s.b, 1.0);
}`

// Pencil: model contours plus procedural hatching, steered by where the viewer looks.
// R: all graphite, G: contours alone. Mirrors prototype/sketch_reference.py; the guide
// textures come from guides.js. Lengths are in pixels at a 1400px long side, times uUnit.
export const HATCH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uLine, uMatte, uTone, uField, uSide, uSheet;
uniform vec2 uSize;
uniform float uUnit, uHatching, uFocus, uSeed, uPad, uWide, uFade;

const float PI = 3.14159265;

float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(vec3(i, uSeed));
  float b = hash(vec3(i + vec2(1.0, 0.0), uSeed));
  float c = hash(vec3(i + vec2(0.0, 1.0), uSeed));
  float d = hash(vec3(i + vec2(1.0, 1.0), uSeed));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// One family of parallel hand strokes at a fixed angle. Each level halves the stroke
// length, so a long stroke breaks cleanly into shorter ones where the level rises.
float strokes(vec2 px, float angle, float spacing, float len, float seed, float coverage, float level, float focus, float wobble) {
  float c = cos(angle);
  float s = sin(angle);
  float u = px.x * c + px.y * s;
  float v = -px.x * s + px.y * c + wobble;
  float row = floor(v / spacing);
  float segLen = len * (0.55 + 0.9 * hash(vec3(row, seed, 1.0)));
  float along = (u + hash(vec3(row, seed, 2.0)) * 999.0) / segLen * exp2(level);
  float seg = floor(along);
  float w = along - seg;
  vec3 key = vec3(row, seg + level * 7919.0, seed);
  float tilt = (hash(key + vec3(0.0, 0.0, 0.17)) - 0.5) * 0.55 * spacing;
  float offset = (hash(vec3(row, seed, 3.0)) - 0.5) * 0.4 * spacing;
  float d = abs((v / spacing - row - 0.5) * spacing - offset - (w - 0.5) * tilt);
  float pressure = (0.5 + 0.15 * focus) + (0.5 - 0.15 * focus) * hash(key + vec3(0.0, 0.0, 0.41));
  float taper = smoothstep(0.0, 0.1, w) * smoothstep(1.0, 0.82, w);
  // Nothing may exist at zero coverage, or faint strokes rain over the bare paper.
  float exists = smoothstep(0.0, 0.08, coverage - hash(key + vec3(0.0, 0.0, 0.73)));
  float width = (0.78 - 0.16 * focus) * max(uUnit, 0.7);
  float x = d / width;
  return exp(-x * x) * pressure * taper * exists;
}

void main() {
  // uPad > 1 draws a wider sheet around the frame. Lookups past the frame clamp to its edge,
  // so the hatching carries on at its own angle and is faded out a short way beyond.
  vec2 fuv = (vUv - 0.5) * uPad + 0.5;
  vec2 px = vec2(fuv.x, 1.0 - fuv.y) * uSize; // image coordinates, y down, as the guides use
  float beyond = length(max(max(-fuv, fuv - 1.0), 0.0) * vec2(uSize.x / uSize.y, 1.0));
  float inset = min(min(fuv.x, 1.0 - fuv.x) * uSize.x / uSize.y, min(fuv.y, 1.0 - fuv.y));
  float rim = beyond - max(inset, 0.0); // signed distance to the photo's edge, in frame heights
  float ragged = noise(px / uUnit / 70.0 + 5.0) - 0.5;
  // The drawing gives out gradually, starting inside the photo, so nothing stops on its edge.
  // Where contours crowd the photo's edge, the drawing stops sooner, deeper inside.
  float busy = texture(uSheet, (fuv - 0.5) / uWide + 0.5).a;
  float trail = mix(1.0, 1.0 - smoothstep(-0.05 - 0.1 * busy, 0.13 - 0.07 * busy, rim + ragged * 0.1), uFade);
  float subject = smoothstep(0.3, 0.7, texture(uMatte, fuv).r) * trail;
  vec4 tone = texture(uTone, fuv);
  vec4 field = texture(uField, fuv);
  vec4 side = texture(uSide, fuv);
  float dark = tone.r;
  float shade = tone.g;
  float focus = tone.b * uFocus;

  // One-sided contour band: a contour lies just behind this pixel, looking back along the
  // shading side. Darkest at the line, fading with distance.
  vec2 back = normalize(side.gb + 1e-6) * vec2(1.0, -1.0) * 32.0 * uUnit / uSize;
  float band = 0.0;
  for (int i = 1; i <= 14; i++) {
    float t = float(i) / 14.0;
    vec2 at = fuv - back * t;
    float line = textureLod(uLine, at, 0.8).r * smoothstep(0.3, 0.7, textureLod(uMatte, at, 1.0).r);
    band = max(band, line * (1.0 - 0.5 * t));
  }
  band = smoothstep(0.05, 0.32, band);
  float nearContour = band * shade;

  // Stroke direction: around the form away from the focus, off the contours inside it.
  float pull = focus * smoothstep(0.15, 0.6, side.r);
  vec2 heading = field.rg * (1.0 - pull) + field.ba * pull * 2.0;
  float theta = 0.5 * atan(heading.y, heading.x);

  vec2 q = px / uUnit;
  float wobble = (noise(q / 48.0) - 0.5) * 3.0 * uUnit;
  float patchTurn = (noise(q / 95.0 + 31.0) - 0.5) * 1.6;
  float cluster = clamp(0.5 + (noise(q / 60.0 + 77.0) - 0.5) * 2.4, 0.0, 1.0);
  float level = clamp(floor(focus * 3.999 + (noise(q / 20.0 + 13.0) - 0.5) * 0.06), 0.0, 3.0);

  const float TURN[5] = float[5](0.0, 0.0, 0.6632, -0.2443, 1.0821);
  const float SPACING[5] = float[5](13.0, 9.0, 7.2, 5.4, 4.0);
  const float LENGTH[5] = float[5](220.0, 190.0, 160.0, 130.0, 110.0);
  const float LOW[5] = float[5](0.12, 0.3, 0.48, 0.62, 0.78);
  const float HIGH[5] = float[5](0.42, 0.58, 0.74, 0.88, 1.0);

  // Tone is carried by stroke density alone: five passes switch on one after another.
  float driver = mix(clamp(dark + 0.14, 0.0, 1.0), nearContour, focus) * 2.0 * uHatching;
  float paper = 1.0;
  for (int i = 0; i < 5; i++) {
    float coverage = clamp((driver - LOW[i]) / (HIGH[i] - LOW[i]), 0.0, 1.0);
    if (i < 2) coverage *= 0.65 + 0.6 * cluster * (1.0 - focus) + 0.35 * focus;
    coverage *= subject;
    float angle = theta + TURN[i] * (1.0 - 0.85 * focus) + patchTurn * 0.35 * (1.0 - focus);
    float k = mod(floor(angle / (PI / 8.0) + 0.5), 8.0);
    float layer = strokes(px, k * PI / 8.0, SPACING[i] * uUnit, LENGTH[i] * uUnit, 17.0 * float(i) + k, coverage, level, focus, wobble);
    paper *= 1.0 - 0.42 * layer;
  }

  float edge = smoothstep(0.25, 0.6, textureLod(uMatte, fuv, 1.5).r);
  // Contours cannot be invented past the frame; they run straight on and die out quickly.
  float contour = pow(clamp(texture(uLine, fuv).r * 1.6, 0.0, 1.0), 0.85) * edge * mix(1.0, 1.0 - smoothstep(-0.08 - 0.17 * busy, 0.015 - 0.05 * busy, rim + ragged * 0.06), uFade);
  outColor = vec4(1.0 - (1.0 - 0.9 * contour) * paper, 0.9 * contour, 0.0, 1.0);
}`

export const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPhoto, uSketch, uPencil, uPencilWide, uMatte, uField, uField2, uSheet;
uniform vec2 uAspect;
uniform vec2 uSize;
// Each front: x = start (s), y = duration (s), z = easing exponent.
uniform vec3 uPaper, uInk, uAccent;
uniform float uTint, uSeed, uStage, uTime, uSketchOnly, uPad;
// The camera: where the photo's centre sits in the viewport, and the rows of the matrix
// that takes a viewport point (in viewport heights) back onto the photo.
uniform vec2 uPan, uCamX, uCamY;
uniform float uGuides; // 0…1: thirds drawn over the photo while the final frame is planned
// uPull runs 0…1 as the camera moves to the planned frame; uPullStart is when it begins (s).
uniform float uPull, uPullStart;
uniform vec2 uLevels;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v / 0.96875;
}

vec3 agedPaper(vec2 p, vec2 uv, float tooth) {
  vec3 col = vec3(0.92, 0.83, 0.66);
  float clouds = fbm(p * 2.4 + uSeed);
  float mottle = fbm(p * 7.0 + uSeed * 1.7 + 40.0);
  col *= 0.86 + 0.26 * clouds;
  col = mix(col, vec3(0.67, 0.55, 0.39), smoothstep(0.52, 0.85, mottle) * 0.4);
  col = mix(col, vec3(0.93, 0.87, 0.74), smoothstep(0.55, 0.9, fbm(p * 3.3 - uSeed)) * 0.3);
  float fibre = noise(vec2(p.x * 260.0, p.y * 9.0)) * noise(vec2(p.x * 14.0, p.y * 330.0));
  col *= 0.96 + 0.06 * tooth + 0.025 * fibre;
  float speck = smoothstep(0.985, 1.0, noise(p * 150.0 + uSeed)) * smoothstep(0.5, 0.8, noise(p * 9.0));
  col *= 1.0 - 0.45 * speck;
  vec2 v = uv - 0.5;
  col *= 1.0 - 0.2 * pow(dot(v, v) * 2.0, 1.4);
  return col;
}

// The paper front starts slowly and bursts; ink surges and then creeps to a stop.
float easeIn(float field, vec3 front) {
  return front.x + front.y * pow(clamp(field, 0.0, 1.0), 1.0 / front.z);
}
float easeOut(float field, vec3 front) {
  return front.x + front.y * (1.0 - pow(1.0 - clamp(field, 0.0, 1.0), 1.0 / front.z));
}
// Past the photo the paper is dry and the ink front crawls. Arrival values beyond 1 are
// spread over a slow tail, so the wash keeps finishing after the frame has pulled back
// instead of all landing in the same instant.
float inkArrival(float field) {
  return easeOut(field, uInk) + 2.6 * (1.0 - exp(-max(field - 1.0, 0.0) * 0.5));
}

// Blots dropped on the bare sheet around the photo. They are summed into one field
// before the outline is taken, so drops that touch run together like wet ink: one pool,
// one wandering scalloped outline, one darker dried rim around the whole of it.
float blots(vec2 p) {
  vec2 corner = (0.5 - 0.5 * uPad) * uAspect;
  vec2 warp = (vec2(fbm(p * 5.0 + 3.0), fbm(p * 5.0 + 11.0)) - 0.5) * 0.11
    + (vec2(fbm(p * 19.0 + 5.0), fbm(p * 19.0 + 17.0)) - 0.5) * 0.025;
  float field = 0.0;
  float tone = 0.0;
  for (int i = 0; i < 10; i++) {
    float k = float(i) + uSeed * 5.3;
    vec2 centre = corner + vec2(hash(vec2(k, 2.1)), hash(vec2(k, 8.7))) * uPad * uAspect;
    float radius = mix(0.1, 0.26, pow(hash(vec2(k, 5.5)), 1.3));
    // Each drop lands at its own moment after the pull-back begins and spreads from a point.
    float born = uPullStart + 0.4 + 2.8 * hash(vec2(k, 6.6));
    float grown = smoothstep(0.0, 1.0, (uTime - born) / 1.8);
    if (grown <= 0.0) continue;
    float d = length(p - centre + warp) / (radius * (0.25 + 0.75 * grown));
    float reach = exp(-2.2 * d * d) * smoothstep(0.0, 0.25, grown); // at full size: the threshold below at the drop's own radius
    field += reach;
    tone += reach * mix(0.04, 0.1, hash(vec2(k, 3.9)));
  }
  const float EDGE = 0.111;
  float pool = smoothstep(EDGE, EDGE * 1.3, field);
  float rim = pool * (1.0 - smoothstep(EDGE * 1.2, EDGE * 2.4, field));
  float dried = smoothstep(uPullStart + 2.0, uPullStart + 4.6, uTime); // the rim shows as the pool dries
  return tone / max(field, 1e-4) * (pool * 0.55 + rim * 0.5 * (0.25 + 0.75 * dried));
}

// Hard-edged droplets flicked off the brush once the ink is flowing: mostly specks, a few heavy drops.
float splatter(vec2 p) {
  float sum = 0.0;
  for (int i = 0; i < 14; i++) {
    float k = float(i) + uSeed * 3.1;
    vec2 c = vec2(hash(vec2(k, 1.3)), hash(vec2(k, 7.9))) * uAspect;
    float r = mix(0.0014, 0.017, pow(hash(vec2(k, 4.2)), 5.0));
    float born = uInk.x + uInk.y * (0.12 + 0.6 * hash(vec2(k, 9.4)));
    float grow = smoothstep(born, born + 0.07, uTime);
    float wobble = 1.0 + 0.25 * (noise(p * 220.0 + k) - 0.5);
    sum += smoothstep(r * grow, r * grow * 0.75, length(p - c) * wobble) * grow;
  }
  return min(sum, 1.0);
}

void main() {
  vec2 view = (vUv - 0.5) * uAspect - uPan;
  vec2 uv = vec2(dot(uCamX, view), dot(uCamY, view)) / uAspect + 0.5;
  vec2 p = uv * uAspect;
  vec3 photo = texture(uPhoto, uv).rgb;
  if (uStage < 0.5) {
    outColor = vec4(photo, 1.0);
    return;
  }

  // When the camera leaves the photo, uv leaves 0…1. "beyond" is the distance past the photo's
  // edge in frame heights; the fronts live on a sheet uPad times larger than the photo.
  float beyond = length(max(max(-uv, uv - 1.0), 0.0) * uAspect);
  float past = step(1e-5, beyond);
  float inset = min(min(uv.x, 1.0 - uv.x) * uAspect.x, min(uv.y, 1.0 - uv.y));
  float rimDistance = beyond - max(inset, 0.0); // signed distance to the photo's edge, in frame heights
  float soft = fbm(p * 3.0 + uSeed * 6.0) - 0.5;
  // Detail gives way to plain wash across the edge, starting inside the photo, so the old
  // rectangle leaves neither a seam nor a line.
  vec2 sheet = (uv - 0.5) / uPad + 0.5;
  // What lies past the photo: its tones spread outwards with a blur that grows with
  // distance (subject, background, matte), and how busy the nearby edge is.
  vec4 far = texture(uSheet, sheet);
  // Where contours crowd the edge, detail lets go sooner and deeper inside.
  // The edge starts to let go just before the frame pulls back, so the extension is already
  // under way when it comes into view; until then the picture is whole to its edge.
  float edging = smoothstep(uPullStart - 0.3, uPullStart + 0.4, uTime);
  float dissolve = smoothstep(-0.08 - 0.15 * far.a, 0.1 - 0.07 * far.a, rimDistance + soft * 0.09) * edging;

  vec2 wobble = vec2(fbm(p * 9.0 + uSeed), fbm(p * 9.0 + uSeed + 31.7)) - 0.5;
  vec4 field = texture(uField, sheet + wobble * 0.014 / uAspect / uPad);
  float fine = fbm(p * 60.0 + uSeed) - 0.5;
  float tooth = noise(uv * uSize * 0.55);
  float pores = noise(uv * uSize * 0.21 + 9.0);

  // --- Paper: a bleached, wet-looking cloud eats the photograph, then ages.
  // Ages are seconds since each front reached this pixel.
  float paperAge = uTime - easeIn(field.r + fine * 0.03, uPaper);
  // While a sketch slider is dragged, show the finished drawing alone on dry paper.
  if (uSketchOnly > 0.5) paperAge = 10.0;
  // Past the photo the sheet ages in step with the last paper to arrive at the photo's edge;
  // otherwise fresh paper inside and aged paper outside draw the old frame as a pale band.
  if (past > 0.5) paperAge = uTime - (uPaper.x + uPaper.y) + 0.2;
  float paperMask = smoothstep(0.0, 0.035, paperAge);
  float fresh = exp(-max(paperAge, 0.0) / 0.6);
  vec3 freshPaper = vec3(0.99, 0.955, 0.875) * (1.0 - 0.2 * field.a) * (0.97 + 0.03 * tooth);
  vec3 paper = mix(agedPaper(p, vUv, tooth), freshPaper, fresh * 0.92);
  float glow = smoothstep(-0.18, 0.0, paperAge);
  vec3 film = mix(photo, vec3(0.99, 0.95, 0.86), glow * glow * 0.5);

  // --- Pencil: contours and hatching of the subject, drawn as the paper arrives.
  vec4 sketch = texture(uSketch, uv);
  vec4 lead = mix(texture(uPencil, uv), texture(uPencilWide, sheet), max(past, edging * smoothstep(-0.16, -0.03, rimDistance)));
  float matteSharp = texture(uMatte, uv).r;
  float matteSoft = textureLod(uMatte, uv, 3.0).r;
  // A figure cut by the frame carries on a little past it, with a ragged end.
  float carry = 1.0 - smoothstep(0.02, 0.45, beyond + soft * 0.12 * past);
  float subject = mix(smoothstep(0.2, 0.55, mix(matteSharp, matteSoft, 0.5)), smoothstep(0.3, 0.6, far.b), dissolve) * carry;
  float drawn = smoothstep(0.03, 0.4, paperAge);
  // Past the edge the pencil is already on the sheet when the frame pulls back to show it.
  drawn = mix(drawn, 1.0, past);
  float graphite = 0.68 + 0.32 * smoothstep(0.25, 0.75, tooth * 0.6 + pores * 0.4);
  float pencil = lead.r * subject * drawn * graphite;

  // --- Ink: arrives blurred and pale, then settles into the tones of the photograph.
  float feather = fbm(p * 24.0 + uSeed * 4.0) - 0.5;
  // Ink may follow closely behind the paper front, but never overtakes it.
  float inkAge = min(uTime - inkArrival(field.g + feather * 0.022), paperAge - 0.12);
  if (uSketchOnly > 0.5) inkAge = -10.0;
  // Past the edge the front has no crisp line: the wash soaks in slowly.
  float cover = smoothstep(0.0, mix(0.035, 0.45, smoothstep(0.0, 0.14, beyond)), inkAge);
  float settle = smoothstep(0.0, 1.1, inkAge);
  float lod = max(4.5 * (1.0 - settle) * (1.0 - settle), 3.0 * dissolve);
  float luma = mix(dot(textureLod(uPhoto, uv, lod).rgb, vec3(0.299, 0.587, 0.114)), far.r, dissolve);
  float lumaWash = mix(textureLod(uSketch, uv, 2.5).g, far.g, dissolve);
  float low = fbm(p * 3.1 + uSeed * 2.3);
  float bleed = textureLod(uMatte, uv + wobble * 0.03 / uAspect, 1.5 + 2.5 * (1.0 - settle)).r;
  float inkMatte = smoothstep(0.28, 0.62, mix(bleed, far.b, dissolve) + (low - 0.5) * 0.22) * carry;

  // Levels are stretched to the subject so backlit or flat photos still get a full tonal range.
  float inkTone = 1.0 - clamp((luma - uLevels.x) / (uLevels.y - uLevels.x), 0.0, 1.0);
  float bodyDensity = 0.05 + 1.6 * pow(inkTone, 1.4);
  // The first wash is thin; the darks flood in afterwards as their own, smaller blots.
  vec4 second = texture(uField2, sheet + wobble * 0.014 / uAspect / uPad);
  float accentAge = min(uTime - easeOut(second.r + feather * 0.03, uAccent), inkAge - 0.1);
  // Past the edge the darks come with the wash itself, so they are there as it is revealed.
  accentAge = mix(accentAge, inkAge - 0.1, past);
  float accentCover = smoothstep(0.0, 0.04, accentAge);
  float accentSettle = smoothstep(0.0, 0.9, accentAge);
  float deepTone = smoothstep(0.3, 0.75, inkTone);
  bodyDensity *= mix(1.0, mix(0.42, 1.0, accentCover * (0.55 + 0.45 * accentSettle)), deepTone);
  bodyDensity += deepTone * accentCover * (exp(-max(accentAge, 0.0) / 0.18) * 0.25 + second.g * 0.18 * accentSettle);
  float washMask = smoothstep(0.32, 0.72, fbm(p * 2.1 + uSeed * 1.3));
  float washDensity = (0.03 + 0.5 * pow(1.0 - lumaWash, 1.3)) * mix(0.25, 1.0, washMask) * 0.55;
  float density = mix(washDensity, bodyDensity, inkMatte);
  float flow = 0.8 + 0.4 * fbm(p * 5.5 + uSeed * 2.0);
  float granulation = 1.0 + 0.2 * (pores - 0.5) + 0.14 * (tooth - 0.5);
  density *= (0.45 + 0.55 * settle) * flow * granulation;
  // Backruns: late water pushes pigment aside, leaving pale blooms with a darker scalloped edge.
  float run = fbm(p * 3.7 + uSeed * 5.0) + feather * 0.18;
  float bloom = smoothstep(0.58, 0.66, run);
  float bloomEdge = smoothstep(0.53, 0.6, run) * (1.0 - bloom);
  density *= 1.0 + settle * (0.22 * bloomEdge - 0.3 * bloom) * (1.0 - 0.8 * dissolve);
  density *= 1.0 - 0.16 * settle * smoothstep(0.6, 0.66, fbm(p * 10.0 + uSeed * 7.0) + feather * 0.1);
  float rim = exp(-max(inkAge, 0.0) / 0.16);
  density += rim * (0.07 + 0.4 * density);
  density += field.b * 0.3 * settle * (0.3 + inkMatte) * (1.0 - dissolve);
  // Past the photo the ink thins out to nothing, with no edge: it runs further where it is
  // dark, and breaks into wisps as it goes.
  // How far it runs varies along the edge: in places it gives out before the old edge, in
  // others it runs well past, so the photo's rectangle does not survive as a shape.
  float along = fbm(p * 1.7 + uSeed * 11.0);
  float further = fbm(p * 2.3 + uSeed * 13.0 + 40.0);
  // Pale, watery ink runs far; dark ink is heavy with pigment and settles early, but its
  // water carries a faint tint on with the rest.
  float spread = 0.55 + 0.9 * further;
  float heavy = clamp(density / 1.1, 0.0, 1.0);
  float reach = mix(0.26, 0.045, heavy) * spread;
  float begin = mix(-0.13, 0.04, smoothstep(0.3, 0.7, along)) - 0.05 * heavy;
  float wisp = fbm(p * 5.0 + uSeed * 9.0);
  float wander = rimDistance + (wisp - 0.5) * 0.14;
  float thinning = smoothstep(begin, begin + reach, wander) * mix(edging, 1.0, smoothstep(-0.02, 0.02, rimDistance));
  float tint = min(density, 0.17) * thinning * (1.0 - smoothstep(begin, begin + 0.3 * spread, wander)) * (0.45 + 0.7 * wisp);
  density = density * (1.0 - thinning) * mix(1.0, 0.5 + wisp, thinning) + tint;
  density += blots(p) * smoothstep(-0.02, 0.08, rimDistance) * (0.6 + 0.8 * wisp);
  density *= 1.0 + 0.16 * exp(-max(inkAge, 0.0) / 1.4);
  density *= cover;
  // Water runs ahead of the pigment and leaves a faint stain before the front arrives.
  float seep = smoothstep(-0.2, 0.0, inkAge);
  density += (1.0 - cover) * seep * seep * 0.13 * (0.35 + 0.65 * inkMatte);

  vec3 sepia = vec3(0.3, 0.2, 0.125);
  vec3 hue = textureLod(uPhoto, uv, lod + 1.0).rgb + 0.02;
  hue /= max(hue.r, max(hue.g, hue.b));
  vec3 pigment = mix(sepia, clamp(mix(vec3(0.8, 0.72, 0.6), hue, 0.8) * 0.4, 0.02, 0.9), uTint);
  vec3 painted = paper * pow(pigment, vec3(density));

  float inkLine = max(lead.g, sketch.r * (1.0 - subject) * (1.0 - dissolve)) * cover * mix(0.3, 1.0, inkMatte) * (0.4 + 0.6 * settle);
  painted *= mix(vec3(1.0), vec3(0.2, 0.14, 0.1), inkLine * 0.75);
  // Pencil darkens once the ink soaks it. The wash itself is untouched. In a light wash the
  // strokes turn a deep graphite; in a dark one they go fully black and heavier, which is
  // the only way left to stay darker than the ink beside them.
  float deepWash = smoothstep(0.5, 1.2, density);
  vec3 graphiteTint = mix(vec3(0.24, 0.21, 0.19), mix(vec3(0.1, 0.085, 0.075), vec3(0.02, 0.016, 0.013), deepWash), cover);
  painted *= mix(vec3(1.0), graphiteTint, min(pencil * mix(1.0, mix(1.0, 1.9, deepWash), cover), 1.0));
  painted *= mix(vec3(1.0), sepia * 0.5, splatter(p) * 0.9 * (1.0 - uSketchOnly));

  vec3 col = mix(film, painted, paperMask);
  col += (hash(uv * uSize + uTime) - 0.5) * 0.012;
  // Planning guides: the photo's own outline and four hairlines that cut it into thirds.
  // They belong to the photo, so they turn and move with it and show how it sits in the frame.
  if (uGuides > 0.0) {
    vec2 perPixel = vec2(length(vec2(dFdx(uv.x), dFdy(uv.x))), length(vec2(dFdx(uv.y), dFdy(uv.y))));
    // Lines fall on every third, which includes the two edges; they stop at the outline.
    vec2 px = abs(fract(uv * 3.0 + 0.5) - 0.5) / 3.0 / perPixel;
    vec2 reach = step(-1.5 * perPixel, uv) * step(uv, 1.0 + 1.5 * perPixel);
    float line = mix(1e3, min(px.x, px.y), reach.x * reach.y);
    col = mix(col, vec3(0.0), uGuides * 0.25 * (1.0 - smoothstep(0.6, 2.2, line)));
    col = mix(col, vec3(1.0), uGuides * 0.85 * (1.0 - smoothstep(0.2, 1.0, line)));
  }
  outColor = vec4(col, 1.0);
}`
