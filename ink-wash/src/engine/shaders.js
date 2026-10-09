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

export const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPhoto, uSketch, uMatte, uField, uField2;
uniform vec2 uAspect;
uniform vec2 uSize;
// Each front: x = start (s), y = duration (s), z = easing exponent.
uniform vec3 uPaper, uInk, uAccent;
uniform float uTint, uSeed, uStage, uZoom, uTime, uShading, uSketchOnly;
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
  vec2 uv = (vUv - 0.5) / uZoom + 0.5;
  vec2 p = uv * uAspect;
  vec3 photo = texture(uPhoto, uv).rgb;
  if (uStage < 0.5) {
    outColor = vec4(photo, 1.0);
    return;
  }

  vec2 wobble = vec2(fbm(p * 9.0 + uSeed), fbm(p * 9.0 + uSeed + 31.7)) - 0.5;
  vec4 field = texture(uField, uv + wobble * 0.014 / uAspect);
  float fine = fbm(p * 60.0 + uSeed) - 0.5;
  float tooth = noise(uv * uSize * 0.55);
  float pores = noise(uv * uSize * 0.21 + 9.0);

  // --- Paper: a bleached, wet-looking cloud eats the photograph, then ages.
  // Ages are seconds since each front reached this pixel.
  float paperAge = uTime - easeIn(field.r + fine * 0.03, uPaper);
  // While a sketch slider is dragged, show the finished drawing alone on dry paper.
  if (uSketchOnly > 0.5) paperAge = 10.0;
  float paperMask = smoothstep(0.0, 0.035, paperAge);
  float fresh = exp(-max(paperAge, 0.0) / 0.6);
  vec3 freshPaper = vec3(0.99, 0.955, 0.875) * (1.0 - 0.2 * field.a) * (0.97 + 0.03 * tooth);
  vec3 paper = mix(agedPaper(p, uv, tooth), freshPaper, fresh * 0.92);
  float glow = smoothstep(-0.18, 0.0, paperAge);
  vec3 film = mix(photo, vec3(0.99, 0.95, 0.86), glow * glow * 0.5);

  // --- Pencil: only the subject is drawn at first.
  vec4 sketch = texture(uSketch, uv);
  float matteSharp = texture(uMatte, uv).r;
  float matteSoft = textureLod(uMatte, uv, 3.0).r;
  float subject = smoothstep(0.2, 0.55, mix(matteSharp, matteSoft, 0.5));
  float drawn = smoothstep(0.03, 0.4, paperAge);
  float graphite = 0.5 + 0.5 * smoothstep(0.25, 0.75, tooth * 0.6 + pores * 0.4);
  float tone = 1.0 - clamp((sketch.g - uLevels.x) / (uLevels.y - uLevels.x), 0.0, 1.0);
  float stripes = smoothstep(0.1, 0.9, sin((p.x + p.y * 0.8) * 560.0 + noise(p * 30.0) * 7.0));
  // Shading lets the hatch reach lighter tones, widens its patches, and darkens it; 0 removes it.
  float hatchFrom = mix(0.9, 0.34, uShading);
  float patchFrom = mix(0.6, 0.0, uShading);
  float hatch = stripes * smoothstep(hatchFrom, hatchFrom + 0.36, tone) * smoothstep(patchFrom, patchFrom + 0.32, noise(p * 7.0 + uSeed)) * 0.48 * uShading;
  float pencil = max(sketch.r, hatch) * subject * drawn * graphite;

  // --- Ink: arrives blurred and pale, then settles into the tones of the photograph.
  float feather = fbm(p * 24.0 + uSeed * 4.0) - 0.5;
  // Ink may follow closely behind the paper front, but never overtakes it.
  float inkAge = min(uTime - easeOut(field.g + feather * 0.022, uInk), paperAge - 0.12);
  if (uSketchOnly > 0.5) inkAge = -10.0;
  float cover = smoothstep(0.0, 0.035, inkAge);
  float settle = smoothstep(0.0, 1.1, inkAge);
  float lod = 4.5 * (1.0 - settle) * (1.0 - settle);
  float luma = dot(textureLod(uPhoto, uv, lod).rgb, vec3(0.299, 0.587, 0.114));
  float lumaWash = textureLod(uSketch, uv, 2.5).g;
  float low = fbm(p * 3.1 + uSeed * 2.3);
  float bleed = textureLod(uMatte, uv + wobble * 0.03 / uAspect, 1.5 + 2.5 * (1.0 - settle)).r;
  float inkMatte = smoothstep(0.28, 0.62, bleed + (low - 0.5) * 0.22);

  // Levels are stretched to the subject so backlit or flat photos still get a full tonal range.
  float inkTone = 1.0 - clamp((luma - uLevels.x) / (uLevels.y - uLevels.x), 0.0, 1.0);
  float bodyDensity = 0.05 + 1.6 * pow(inkTone, 1.4);
  // The first wash is thin; the darks flood in afterwards as their own, smaller blots.
  vec4 second = texture(uField2, uv + wobble * 0.014 / uAspect);
  float accentAge = min(uTime - easeOut(second.r + feather * 0.03, uAccent), inkAge - 0.1);
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
  density *= 1.0 + settle * (0.22 * bloomEdge - 0.3 * bloom);
  density *= 1.0 - 0.16 * settle * smoothstep(0.6, 0.66, fbm(p * 10.0 + uSeed * 7.0) + feather * 0.1);
  float rim = exp(-max(inkAge, 0.0) / 0.16);
  density += rim * (0.07 + 0.4 * density);
  density += field.b * 0.3 * settle * (0.3 + inkMatte);
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

  float inkLine = sketch.r * cover * mix(0.3, 1.0, inkMatte) * (0.4 + 0.6 * settle);
  painted *= mix(vec3(1.0), vec3(0.2, 0.14, 0.1), inkLine * 0.75);
  painted *= mix(vec3(1.0), vec3(0.34, 0.29, 0.26), pencil * 0.9 * (1.0 - 0.6 * cover));
  painted *= mix(vec3(1.0), sepia * 0.5, splatter(p) * 0.9 * (1.0 - uSketchOnly));

  vec3 col = mix(film, painted, paperMask);
  col += (hash(uv * uSize + uTime) - 0.5) * 0.012;
  outColor = vec4(col, 1.0);
}`
