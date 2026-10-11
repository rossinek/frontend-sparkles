// Writers for the export dialog. Each takes frames one at a time, as fast as they can be
// painted rather than in real time, so the result has an even frame rate on any machine.
// The encoders are loaded on first use.

export const GIF_FPS = 20
export const GIF_LONG = 640

/** The output size for a picture: its short side, or its long side, brought to a given length. Sides are even, as H.264 wants. */
export function fit(width, height, { short, long }) {
  const ratio = short ? short / Math.min(width, height) : long / Math.max(width, height)
  const even = value => Math.max(2, Math.round((value * ratio) / 2) * 2)
  return { width: even(width), height: even(height) }
}

/** An MP4 (H.264) written from a canvas: `add(index)` takes the canvas as it is now. */
export async function movieWriter(surface, fps) {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_VERY_HIGH, canEncodeVideo } = await import('mediabunny')
  if (!(await canEncodeVideo('avc', { width: surface.width, height: surface.height }))) {
    throw new Error('This browser cannot encode MP4 video. Try a current version of Chrome, Edge, or Safari.')
  }
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  // The paper's grain is hard on a video codec, so it gets a generous bitrate.
  const source = new CanvasSource(surface, { codec: 'avc', bitrate: QUALITY_VERY_HIGH, keyFrameInterval: 2 })
  output.addVideoTrack(source, { frameRate: fps })
  await output.start()
  return {
    add: index => source.add(index / fps, 1 / fps),
    async finish() {
      await output.finalize()
      return new Blob([output.target.buffer], { type: 'video/mp4' })
    },
    cancel: () => output.cancel(),
  }
}

/** A looping GIF: `add(index, context)` reads the frame from a 2D context. */
export async function gifWriter(width, height, fps) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
  const gif = GIFEncoder()
  return {
    add(index, context) {
      const { data } = context.getImageData(0, 0, width, height)
      const palette = quantize(data, 256)
      gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: 1000 / fps })
    },
    finish() {
      gif.finish()
      return new Blob([gif.bytes()], { type: 'image/gif' })
    },
    cancel() {},
  }
}
