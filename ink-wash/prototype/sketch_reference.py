"""Reference implementation of the Ink Wash pencil sketch (see ../SKETCH-PIPELINE.md).

Not part of the app. It is the approved look, kept so the browser port can be checked
against it; delete it once the port matches.

    uv run --python 3.12 --with numpy --with pillow --with onnxruntime --with scipy \
        --with ai-edge-litert python sketch_reference.py name=/path/to/photo.jpg

Expects ./models/ with informative-drawings_anime_1024x1024.onnx, depth.onnx
(Depth Anything V2 small, quantized), rmbg.onnx (RMBG-1.4, quantized) and
unisal_fp16.tflite, and writes to ./out/.
"""
import sys, time
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter, ImageOps
from scipy.ndimage import gaussian_filter, map_coordinates
from ai_edge_litert.interpreter import Interpreter

LONG = 1400
K = 8  # quantized stroke directions


def load(path):
    image = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    image.thumbnail((LONG, LONG), Image.LANCZOS)
    return image


def lines(image, session):
    size = session.get_inputs()[0].shape[2]
    x = np.float32(image.resize((size, size), Image.LANCZOS)) / 255.0
    out = session.run(None, {'inputs': x.transpose(2, 0, 1)[None]})[0][0, 0]
    out = Image.fromarray(np.uint8(np.clip(out, 0, 1) * 255)).resize(image.size, Image.LANCZOS)
    return 1.0 - np.float32(out) / 255.0  # 1 = stroke


def depth(image, session):
    w, h = image.size
    scale = 518 / max(w, h)
    dw, dh = max(14, round(w * scale / 14) * 14), max(14, round(h * scale / 14) * 14)
    x = np.float32(image.resize((dw, dh), Image.BICUBIC)) / 255.0
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    out = session.run(None, {'pixel_values': np.float32(x.transpose(2, 0, 1)[None])})[0][0]
    out = (out - out.min()) / (out.max() - out.min() + 1e-6)
    return np.float32(Image.fromarray(out).resize((w, h), Image.BICUBIC))  # 1 = near


def hash1(*values):
    s = sum(np.asarray(v, dtype=np.float64) * k for v, k in zip(values, (12.9898, 78.233, 37.719, 4.581)))
    return np.mod(np.sin(s) * 43758.5453, 1.0)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def matte(image, session):
    x = np.float32(image.resize((1024, 1024), Image.BILINEAR)) / 255.0 - 0.5
    name = session.get_inputs()[0].name
    out = session.run(None, {name: np.float32(x.transpose(2, 0, 1)[None])})[0][0, 0]
    out = (out - out.min()) / (out.max() - out.min() + 1e-6)
    out = np.float32(Image.fromarray(np.float32(out)).resize(image.size, Image.BILINEAR)).clip(0, 1)
    return smooth(0.3, 0.7, out)  # the quantized model leaves a faint haze in the background


def attention(image, net):
    inp, out = net.get_input_details()[0], net.get_output_details()[0]
    x = np.float32(image.resize((256, 256), Image.BICUBIC)) / 255.0
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    net.set_tensor(inp['index'], np.float32(x.transpose(2, 0, 1)[None]))
    net.invoke()
    sal = 1.0 / (1.0 + np.exp(-net.get_tensor(out['index'])[0, 0].astype(np.float64)))
    sal = sal / (sal.max() + 1e-9)
    return np.float32(Image.fromarray(np.float32(sal)).resize(image.size, Image.BICUBIC)).clip(0, 1)


def strokes(xx, yy, angle, spacing, length, seed, coverage, wobble, level, focus):
    """Parallel hand strokes at one angle. Each level halves the stroke length, so a long
    stroke breaks cleanly into shorter ones where the level rises."""
    u = xx * np.cos(angle) + yy * np.sin(angle)
    v = -xx * np.sin(angle) + yy * np.cos(angle) + wobble
    row = np.floor(v / spacing)
    seg_len = length * (0.55 + 0.9 * hash1(row, seed))
    along = (u + hash1(row, seed + 1) * 999.0) / seg_len * (2.0 ** level)
    seg = np.floor(along)
    w = along - seg
    key = seg + level * 7919.0
    tilt = (hash1(row, key, seed + 2) - 0.5) * 0.55 * spacing
    offset = (hash1(row, seed + 3) - 0.5) * 0.4 * spacing
    d = np.abs((v / spacing - row - 0.5) * spacing - offset - (w - 0.5) * tilt)
    pressure = (0.5 + 0.15 * focus) + (0.5 - 0.15 * focus) * hash1(row, key, seed + 4)
    taper = smooth(0.0, 0.1, w) * smooth(1.0, 0.82, w)
    exists = smooth(0.0, 0.08, coverage - hash1(row, key, seed + 5))  # nothing at zero coverage
    width = 0.78 - 0.16 * focus
    return np.exp(-(d / width) ** 2) * pressure * taper * exists


def sketch(image, line, near, subject, focus_raw):
    w, h = image.size
    unit = max(w, h) / 1400
    rng = np.random.default_rng(3)
    gray = np.float32(image.convert('L')) / 255.0
    lo, hi = np.percentile(gray, [2, 98])
    tone = 1.0 - np.clip((gray - lo) / max(hi - lo, 0.2), 0, 1)

    focus = smooth(0.12, 0.8, gaussian_filter(focus_raw, 10 * unit))

    # Tone: broad masses away from the focus, finer inside it. Partial equalization as before.
    dark = gaussian_filter(tone, 5 * unit)  # the plain shading map, same everywhere
    levels = np.quantile(dark, np.linspace(0, 1, 256))
    dark = 0.35 * dark + 0.65 * np.interp(dark, levels, np.linspace(0, 1, 256))

    # True darkness of the photo: inverted gray, median-blurred so texture and thin lines
    # drop out but the edges of light and shadow stay sharp. No equalization and no lift, so
    # pale areas really get few strokes and dark ones many.
    small = Image.fromarray(np.uint8(np.clip(tone, 0, 1) * 255)).resize((max(1, w // 3), max(1, h // 3)), Image.BILINEAR)
    small = small.filter(ImageFilter.MedianFilter(7))
    shade = gaussian_filter(np.float32(small.resize((w, h), Image.BICUBIC)) / 255.0, 1.5 * unit)
    # One-sided contour band. Each contour throws its shading to one side only:
    #  - where the photo has a clear, broad step in brightness, toward the darker side;
    #  - elsewhere (thin lines, small glyphs, where "darker" is all around or nowhere),
    #    toward one shared direction, as if lit from a single side.
    # The step is measured at a coarse scale so small closed shapes cancel out.
    drawn = gaussian_filter(line * subject, 1.2 * unit)
    dy, dx = np.gradient(gaussian_filter(shade, 14 * unit))
    slope = np.hypot(dx, dy)
    on_line = drawn > 0.2
    conf = smooth(0.3, 0.85, slope / (np.percentile(slope[on_line], 88) + 1e-9))
    mean = np.array([(dx * slope * on_line).sum(), (dy * slope * on_line).sum()])
    resultant = np.hypot(*mean) / ((slope * slope * on_line).sum() + 1e-9)
    shared = mean / (np.hypot(*mean) + 1e-9) if resultant > 0.25 else np.array([0.6, 0.8])
    nx = conf * dx / (slope + 1e-9) + (1 - conf) * shared[0]
    ny = conf * dy / (slope + 1e-9) + (1 - conf) * shared[1]
    nx, ny = gaussian_filter(nx, 4 * unit), gaussian_filter(ny, 4 * unit)
    norm = np.hypot(nx, ny) + 1e-9
    nx, ny = nx / norm, ny / norm
    # A pixel is in the band if a contour lies just behind it, looking back along that
    # direction. Darkest right at the line, fading with distance.
    reach = 32 * unit  # a little longer than the short strokes, so they fit inside
    gy0, gx0 = np.mgrid[0:h, 0:w].astype(np.float64)
    band = np.zeros((h, w))
    for step_index in range(1, 15):
        t = step_index / 14
        hit = map_coordinates(drawn, [gy0 - ny * reach * t, gx0 - nx * reach * t], order=1, mode='nearest')
        band = np.maximum(band, hit * (1 - 0.5 * t))
    band = smooth(0.05, 0.32, band)
    near_contour = band * shade

    # Direction away from the focus: wrap the form (depth gradient), slant where it is flat.
    d = gaussian_filter(near, 7 * unit)
    gy, gx = np.gradient(d)
    mag = np.hypot(gx, gy)
    conf = np.clip(mag / (np.percentile(mag, 92) + 1e-6), 0, 1)
    form = np.arctan2(gy, gx)
    base = -np.pi / 4
    c2 = conf * np.cos(2 * form) + (1 - conf) * 0.6 * np.cos(2 * base)
    s2 = conf * np.sin(2 * form) + (1 - conf) * 0.6 * np.sin(2 * base)
    # Direction inside the focus: along the features themselves (structure tensor tangent).
    sy, sx = np.gradient(gaussian_filter(line * subject, 2.5 * unit))
    jxx, jyy, jxy = (gaussian_filter(a, 6 * unit) for a in (sx * sx, sy * sy, sx * sy))
    tangent = 0.5 * np.arctan2(2 * jxy, jxx - jyy) + np.pi / 2 + np.radians(50)  # strokes come off the contour at an angle
    coherence = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-9)
    pull = focus * smooth(0.15, 0.6, coherence)
    c2 = gaussian_filter(c2, 22 * unit) * (1 - pull) + gaussian_filter(np.cos(2 * tangent) * coherence, 5 * unit) * pull * 2
    s2 = gaussian_filter(s2, 22 * unit) * (1 - pull) + gaussian_filter(np.sin(2 * tangent) * coherence, 5 * unit) * pull * 2
    theta = 0.5 * np.arctan2(s2, c2)

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    wobble = gaussian_filter(rng.standard_normal((h, w)), 22 * unit) * 55 * unit
    patch = gaussian_filter(rng.standard_normal((h, w)), 40 * unit)
    patch = patch / (np.abs(patch).max() + 1e-6)
    cluster = gaussian_filter(rng.standard_normal((h, w)), 26 * unit)
    cluster = np.clip(0.5 + 0.5 * cluster / (cluster.std() + 1e-6), 0, 1)
    dither = rng.random((h, w))

    # Stroke length level 0..3 (220 px down to ~27 px), dithered so the steps do not show.
    level = np.clip(np.floor(focus * 3.999 + (gaussian_filter(dither, 9 * unit) - 0.5) * 3.0), 0, 3)

    passes = [
        dict(turn=0.0, spacing=13.0, length=220, lo=0.12, hi=0.42),
        dict(turn=0.0, spacing=9.0, length=190, lo=0.3, hi=0.58),
        dict(turn=np.radians(38), spacing=7.2, length=160, lo=0.48, hi=0.74),
        dict(turn=np.radians(-14), spacing=5.4, length=130, lo=0.62, hi=0.88),
        dict(turn=np.radians(62), spacing=4.0, length=110, lo=0.78, hi=1.0),
    ]
    paper_left = np.ones((h, w))
    for index, p in enumerate(passes):
        # Away from the focus the tone is pushed darker, so hatching is fuller there.
        pushed = np.clip(dark + 0.14, 0, 1)
        driver = pushed + focus * (near_contour - pushed)  # the map that drives the hatching
        coverage = np.clip((driver - p['lo']) / (p['hi'] - p['lo']), 0, 1)
        if index < 2:
            coverage = coverage * (0.65 + 0.6 * cluster * (1 - focus) + 0.35 * focus)
        coverage = coverage * subject
        turn = p['turn'] * (1 - 0.85 * focus)  # no crossing where it must stay precise
        local = theta + turn + patch * 0.35 * (1 - focus)
        snapped = np.round(local / (np.pi / K)) % K
        layer = np.zeros((h, w))
        for k in range(K):
            where = snapped == k
            if not where.any():
                continue
            texture = strokes(xx, yy, k * np.pi / K, p['spacing'] * unit, p['length'] * unit, 17 * index + k, coverage, wobble, level, focus)
            layer[where] = texture[where]
        paper_left *= 1 - 0.42 * layer

    tooth = gaussian_filter(np.random.default_rng(5).random((h, w)), 0.7)
    tooth = np.clip((tooth - 0.5) * 5 + 0.5, 0, 1)
    edge = smooth(0.25, 0.6, gaussian_filter(subject, 2 * unit))
    contour = np.clip(line * 1.6, 0, 1) ** 0.85 * edge
    graphite = 1 - (1 - 0.9 * contour) * paper_left
    graphite *= 0.7 + 0.3 * tooth

    grain = gaussian_filter(np.random.default_rng(9).random((h, w)), 30 * unit)
    grain = (grain - grain.mean()) / (grain.std() + 1e-6)
    paper = np.array([0.93, 0.885, 0.79]) * (1 + 0.012 * grain[..., None]) * (0.985 + 0.03 * tooth[..., None])
    lead = np.array([0.2, 0.185, 0.18])
    out = paper * (1 - graphite[..., None] * (1 - lead))
    driver = np.clip(dark + 0.14, 0, 1) + focus * (near_contour - np.clip(dark + 0.14, 0, 1))
    return np.clip(out, 0, 1), focus, driver * subject


if __name__ == '__main__':
    cpu = ['CPUExecutionProvider']
    line_net = ort.InferenceSession('models/informative-drawings_anime_1024x1024.onnx', providers=cpu)
    depth_net = ort.InferenceSession('models/depth.onnx', providers=cpu)
    matte_net = ort.InferenceSession('models/rmbg.onnx', providers=cpu)
    sal_net = Interpreter(model_path='models/unisal_fp16.tflite')
    sal_net.allocate_tensors()
    for item in sys.argv[1:]:
        name, path = item.split('=', 1)
        image = load(path)
        t = [time.perf_counter()]
        line = lines(image, line_net); t.append(time.perf_counter())
        near = depth(image, depth_net); t.append(time.perf_counter())
        subject = matte(image, matte_net); t.append(time.perf_counter())
        sal = attention(image, sal_net); t.append(time.perf_counter())
        out, focus, driver = sketch(image, line, near, subject, sal); t.append(time.perf_counter())
        steps = ' '.join(f'{n} {b - a:.1f}s' for n, a, b in zip(['lines', 'depth', 'matte', 'attention', 'hatch'], t, t[1:]))
        print(f'{name}: {image.size} {steps} | subject {subject.mean():.2f} of frame')
        photo = np.float32(image) / 255.0
        f = (focus * subject)[..., None]
        heat = np.stack([np.clip(f[..., 0] * 3, 0, 1), np.clip(f[..., 0] * 3 - 1, 0, 1), np.clip(f[..., 0] * 3 - 2, 0, 1)], -1)
        guide = (0.3 * photo.mean(-1, keepdims=True) + 0.15) * (0.35 + 0.65 * subject[..., None]) * (1 - f) + heat * f * 0.8 + photo * f * 0.2
        Image.fromarray(np.uint8(np.clip(1 - driver, 0, 1) * 255)).save(f'out/{name}-driver.jpg', quality=88)
        Image.fromarray(np.uint8(out * 255)).save(f'out/{name}-sketch.jpg', quality=92)
        image.save(f'out/{name}-photo.jpg', quality=90)
