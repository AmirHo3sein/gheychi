import { onMounted, type Ref } from 'vue'

/**
 * vue-multiselect always renders `aria-controls`/`aria-owns="listbox-<id>"`, but only mounts
 * that listbox `<ul>` while the dropdown is open -- so a closed select points assistive tech
 * (and axe's aria-valid-attr-value) at an element that does not exist. ARIA 1.2 lets a closed
 * combobox omit the reference, so it is withheld until `open` and dropped again on `close`.
 * Vue only re-patches an attribute when its bound value changes, and these ones are constant,
 * so the manual edits survive re-renders.
 */
export function useListboxReference(root: Ref<{ $el?: Element } | null>, id: () => string) {
  function sync(open: boolean) {
    const el = root.value?.$el
    if (!(el instanceof HTMLElement)) return
    const ref = `listbox-${id()}`
    const targets: [Element | null, string][] = [
      [el.querySelector('input.multiselect__input'), 'aria-controls'],
      [el, 'aria-owns'],
    ]
    for (const [target, attr] of targets) {
      if (!target) continue
      if (open) target.setAttribute(attr, ref)
      else target.removeAttribute(attr)
    }
  }

  onMounted(() => sync(false))
  return { onOpen: () => sync(true), onClose: () => sync(false) }
}
