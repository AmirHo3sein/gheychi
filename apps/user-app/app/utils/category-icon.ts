import type { IconName } from '../components/ui/BaseIcon.vue'

// service_categories.icon is a free-text key set by whoever created the category (admin-panel
// has no upload/picker either -- see its own CategoriesView.vue iconFor, which this mirrors).
// Known keys map to a real glyph; anything else falls back to a generic icon instead of
// rendering nothing (BaseIcon silently draws an empty <svg> for an unrecognized name).
const KNOWN_CATEGORY_ICONS: IconName[] = ['scissors', 'palette', 'droplet', 'nail', 'sparkles', 'brush', 'eye', 'razor', 'pencil']

export function iconForCategory(icon: string): IconName {
  return (KNOWN_CATEGORY_ICONS as string[]).includes(icon) ? (icon as IconName) : 'sparkles'
}
