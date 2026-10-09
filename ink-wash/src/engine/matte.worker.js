import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers'

// RMBG-1.4 ships without a Transformers.js pipeline config, so both halves are configured by hand.
const MODEL = 'briaai/RMBG-1.4'
let loading

function load() {
  const progress_callback = event => {
    if (event.status === 'progress' && event.file?.endsWith('.onnx')) {
      self.postMessage({ type: 'progress', progress: event.progress / 100 })
    }
  }
  return Promise.all([
    AutoModel.from_pretrained(MODEL, { config: { model_type: 'custom' }, device: 'wasm', dtype: 'q8', progress_callback }),
    AutoProcessor.from_pretrained(MODEL, {
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
  ])
}

self.onmessage = async ({ data: { id, pixels, width, height } }) => {
  try {
    loading ??= load()
    const [model, processor] = await loading
    self.postMessage({ type: 'running', id })
    const image = new RawImage(pixels, width, height, 4).rgb()
    const { pixel_values } = await processor(image)
    const { output } = await model({ input: pixel_values })
    const mask = await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(width, height)
    self.postMessage({ type: 'matte', id, width, height, data: mask.data }, [mask.data.buffer])
  } catch (error) {
    loading = undefined
    self.postMessage({ type: 'error', id, message: String(error?.message || error) })
  }
}
