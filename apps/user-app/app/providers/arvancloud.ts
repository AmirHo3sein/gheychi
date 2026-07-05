import { createOperationsGenerator, defineProvider } from '@nuxt/image/runtime'

const operationsGenerator = createOperationsGenerator({
  keyMap: { width: 'width', height: 'height' },
})

export default defineProvider({
  getImage(src, { modifiers }) {
    const operations = operationsGenerator(modifiers)
    return { url: operations ? `${src}?${operations}` : src }
  },
})
