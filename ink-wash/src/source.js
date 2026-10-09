import { shallowRef } from 'vue'

// The photo picked on the start screen, handed to the editor. A file cannot survive a
// reload, so the editor sends you back to the start when it is missing.
export const chosenFile = shallowRef(null)

const pexels = id => `https://www.pexels.com/photo/${id}/`

// Sample photos from Pexels, kept in public/samples as <id>.jpg and <id>-thumb.jpg.
export const SAMPLES = [
  { id: 'reader', by: 'Olly', page: pexels(3989412), alt: 'A man in a hat looking down at his phone', portrait: true },
  { id: 'teahouse', by: 'Ricky Kwong', page: pexels(38031625), alt: 'An older man in a hat turning to smile in a teahouse', portrait: true },
  { id: 'rodeo', by: 'Fabio Le Saint', page: pexels(38728029), alt: 'A rider on a galloping horse kicking up dirt at a rodeo' },
  { id: 'selfie', by: 'silverkblack', page: pexels(36763580), alt: 'A woman in a hat taking a selfie and giving a thumbs up' },
  { id: 'couple', by: 'Arina Krasnikova', page: pexels(7350871), alt: 'A couple in hats facing each other in the mountains' },
  { id: 'notebook', by: 'Vie Studio', page: pexels(8148585), alt: 'A black notebook and a pen on a white table beside a plant' },
]

export const EXAMPLE = { by: 'odobesku', page: pexels(10632585) }

export const asset = path => `${import.meta.env.BASE_URL}${path}`
