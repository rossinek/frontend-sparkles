import { AutoModel, AutoProcessor, RawImage, Tensor, pipeline } from '@huggingface/transformers'

// Three models, run once per photo. Only the matte is required; the other maps are optional
// and the renderer falls back when one is missing. The fourth model, attention, runs on the
// main thread (see attention.js). See SKETCH-PIPELINE.md.

// WebGPU is several times faster than single-threaded WASM for these networks. A model that
// fails to start on it is retried on WASM.
const gpu = (async () => {
  try {
    return !!(await navigator.gpu?.requestAdapter())
  } catch {
    return false
  }
})()

async function onBestDevice(load) {
  if (await gpu) {
    try {
      return { model: await load('webgpu'), device: 'webgpu' }
    } catch (error) {
      console.warn('WebGPU start failed, falling back to WASM.', error)
    }
  }
  return { model: await load('wasm'), device: 'wasm' }
}

const progress = label => event => {
  if (event.status === 'progress' && event.file?.endsWith('.onnx')) {
    self.postMessage({ type: 'progress', label, progress: event.progress / 100 })
  }
}

// Loaders are cached; a failed one is dropped so the next photo retries it.
const cache = {}
function once(name, load) {
  cache[name] ??= load().catch(error => {
    delete cache[name]
    throw error
  })
  return cache[name]
}

// RMBG-1.4 ships without a Transformers.js pipeline config, so both halves are configured by hand.
const loadMatte = () => once('matte', () => Promise.all([
  onBestDevice(device => AutoModel.from_pretrained('briaai/RMBG-1.4', {
    config: { model_type: 'custom' },
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: progress('background model'),
  })),
  AutoProcessor.from_pretrained('briaai/RMBG-1.4', {
    config: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      image_std: [1, 1, 1],
      feature_extractor_type: 'ImageFeatureExtractor',
      resample: 2,
      rescale_factor: 1 / 255,
      size: { width: 1024, height: 1024 },
    },
  }),
]))

// The line model's repository has no config and keeps its files in the root.
const loadLines = () => once('lines', () => onBestDevice(device => AutoModel.from_pretrained('x-Liola-x/informative-drawings-onnx', {
  config: { model_type: 'custom' },
  subfolder: '',
  model_file_name: 'informative-drawings_anime_1024x1024',
  device,
  dtype: 'fp32',
  progress_callback: progress('drawing model'),
})))

const loadDepth = () => once('depth', () => onBestDevice(device => pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', {
  device,
  dtype: device === 'webgpu' ? 'fp16' : 'q8',
  progress_callback: progress('depth model'),
})))

// Planar float tensor data from an RGB RawImage, scaled to 0…1.
function planar(image) {
  const { data, width, height } = image
  const size = width * height
  const out = new Float32Array(size * 3)
  for (let i = 0; i < size; i++) {
    for (let c = 0; c < 3; c++) out[c * size + i] = data[i * 3 + c] / 255
  }
  return out
}

async function matte(image) {
  const [{ model, device }, processor] = await loadMatte()
  const { pixel_values } = await processor(image)
  const { output } = await model({ input: pixel_values })
  const mask = await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(image.width, image.height)
  return { width: mask.width, height: mask.height, data: mask.data, device }
}

// 1 = stroke. The model wants a square, so the photo is squashed; the renderer stretches it back.
async function lines(image) {
  const { model, device } = await loadLines()
  const square = await image.resize(1024, 1024)
  const { outputs } = await model({ inputs: new Tensor('float32', planar(square), [1, 3, 1024, 1024]) })
  const data = new Uint8Array(1024 * 1024)
  for (let i = 0; i < data.length; i++) data[i] = Math.round(255 * Math.min(1, Math.max(0, 1 - outputs.data[i])))
  return { width: 1024, height: 1024, data, device }
}

// 1 = near.
async function depth(image) {
  const { model: estimator, device } = await loadDepth()
  const { depth: map } = await estimator(image)
  return { width: map.width, height: map.height, data: map.data, device }
}

self.onmessage = async ({ data: { id, pixels, width, height } }) => {
  const image = new RawImage(pixels, width, height, 4).rgb()
  const optional = async (name, status, run) => {
    self.postMessage({ type: 'status', id, text: status })
    const started = performance.now()
    try {
      const map = await run(image)
      return { ...map, ms: Math.round(performance.now() - started) }
    } catch (error) {
      console.warn(`The ${name} model failed; continuing without it.`, error)
      return null
    }
  }
  try {
    self.postMessage({ type: 'status', id, text: 'Separating the subject…' })
    const started = performance.now()
    const subject = { ...(await matte(image)), ms: Math.round(performance.now() - started) }
    const line = await optional('drawing', 'Drawing the contours…', lines)
    const near = await optional('depth', 'Reading the depth…', depth)
    const transfer = [subject, line, near].filter(Boolean).map(map => map.data.buffer)
    self.postMessage({ type: 'maps', id, matte: subject, line, depth: near }, transfer)
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error?.message || error) })
  }
}
