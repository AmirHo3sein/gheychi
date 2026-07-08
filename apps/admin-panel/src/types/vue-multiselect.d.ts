// vue-multiselect ships no TypeScript types. Declared loosely -- AppSelect.vue is the
// only file that imports it directly, so this ambient module stays narrowly scoped.
declare module 'vue-multiselect' {
  import type { DefineComponent } from 'vue'
  const Multiselect: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default Multiselect
}
