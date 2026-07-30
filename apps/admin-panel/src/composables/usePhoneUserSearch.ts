// apps/admin-panel/src/composables/usePhoneUserSearch.ts
// Shared phone-number user lookup used by WalletView.vue's ledger filter and
// AdjustBalanceCard.vue's target-user picker. Both call sites need the exact same
// debounced-search / select / clear / "no results" / click-outside-dismiss behavior --
// this composable is the single source of truth for it instead of two near-verbatim
// copies drifting apart. The click-outside pattern mirrors JalaliDatePicker.vue's own
// root-ref + document-mousedown-listener approach.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { debounce } from '@/utils/debounce'

export interface MatchedUser {
  id: string
  phone: string
  name: string | null
}

export function usePhoneUserSearch() {
  const { apiFetch } = useApi()

  // Bind this to the root element wrapping both the input/selected-user chip and the
  // floating match panel, so a click anywhere outside it dismisses the panel.
  const root = ref<HTMLElement | null>(null)

  const phoneQuery = ref('')
  const matches = ref<MatchedUser[]>([])
  const selectedUser = ref<MatchedUser | null>(null)
  const searching = ref(false)
  // True once a search for the current query has completed with zero matches --
  // distinguishes "no results" from "haven't searched yet" in the template.
  const noResults = ref(false)

  // Guards against a slower earlier response landing after a faster later one when the
  // admin keeps typing.
  let searchToken = 0

  async function searchUsers() {
    const query = phoneQuery.value.trim()
    if (selectedUser.value) return
    matches.value = []
    noResults.value = false
    if (!query) return
    searching.value = true
    const token = ++searchToken
    // GET /admin/users returns a paginated envelope, not a bare array -- reading it as an
    // array yielded `matches = []` for every query, so the picker could never find anyone
    // and never said "not found" either (noResults is derived from the same empty list).
    const { data } = await apiFetch<{ items: MatchedUser[]; total: number }>(
      `/admin/users?phone=${encodeURIComponent(query)}`,
      { silent: true },
    )
    if (token === searchToken) {
      matches.value = data?.items ?? []
      searching.value = false
      noResults.value = matches.value.length === 0
    }
  }

  function selectUser(user: MatchedUser) {
    selectedUser.value = user
    matches.value = []
    noResults.value = false
    phoneQuery.value = user.phone
  }

  function clearUser() {
    selectedUser.value = null
    phoneQuery.value = ''
    matches.value = []
    noResults.value = false
  }

  function closePanel() {
    matches.value = []
    noResults.value = false
  }

  function onDocumentClick(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) closePanel()
  }

  onMounted(() => document.addEventListener('mousedown', onDocumentClick))
  onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentClick))

  watch(phoneQuery, debounce(searchUsers, 350))

  return {
    root,
    phoneQuery,
    matches,
    selectedUser,
    searching,
    noResults,
    searchUsers,
    selectUser,
    clearUser,
  }
}
