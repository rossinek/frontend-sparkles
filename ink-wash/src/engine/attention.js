import { loadLiteRt, loadAndCompile, Tensor } from '@litertjs/core'

// UniSal predicts where people look. It is tiny, and LiteRT.js cannot load inside a module
// worker, so it runs on the main thread.
const WASM = 'https://cdn.jsdelivr.net/npm/@litertjs/core@2.5.3/wasm/'
const MODEL = 'https://huggingface.co/litert-community/UniSal-Saliency-LiteRT/resolve/main/unisal_fp16.tflite'
const SIZE = 256
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let loading

/**
 * @param {CanvasImageSource} source
 * @returns {Promise<{ width: number, height: number, data: Uint8Array }>} attention, 0…255
 */
export async function attention(source) {
  loading ??= loadLiteRt(WASM).then(() => loadAndCompile(MODEL, { accelerator: 'wasm' })).catch(error => {
    loading = undefined
    throw error
  })
  const model = await loading
  const surface = document.createElement('canvas')
  surface.width = surface.height = SIZE
  const context = surface.getContext('2d', { willReadFrequently: true })
  context.drawImage(source, 0, 0, SIZE, SIZE)
  const { data: rgba } = context.getImageData(0, 0, SIZE, SIZE)
  const planar = new Float32Array(SIZE * SIZE * 3)
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) planar[c * SIZE * SIZE + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c]
  }
  const input = new Tensor(planar, [1, 3, SIZE, SIZE])
  const results = await model.run(input)
  const logits = results[0].toTypedArray()
  // The model returns logits; the map is scaled so its peak is 1.
  const values = new Float32Array(SIZE * SIZE)
  let peak = 1e-6
  for (let i = 0; i < values.length; i++) {
    values[i] = 1 / (1 + Math.exp(-logits[i]))
    if (values[i] > peak) peak = values[i]
  }
  const data = new Uint8Array(SIZE * SIZE)
  for (let i = 0; i < data.length; i++) data[i] = Math.round((255 * values[i]) / peak)
  input.delete()
  for (const result of results) result.delete()
  return { width: SIZE, height: SIZE, data }
}
