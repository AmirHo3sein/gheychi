import type { SelectOption } from '../components/ui/AppSelect.client.vue'

// The one gender picker used by both places that ask for it (login.vue's profile step and
// profile.vue), shared so the two forms can't drift apart. The values are the API's own
// vocabulary -- PATCH /auth/profile validates them with @IsIn(['female','male']) --
// which toSearchGender below then translates into /search's separate one.
export const GENDER_OPTIONS: SelectOption[] = [
  { value: 'female', label: 'زن' },
  { value: 'male', label: 'مرد' },
]

// The user's own gender identity ('female'/'male') and a salon's target clientele
// ('women'/'men', the vocabulary /search's `gender` param expects) are different
// fields with different vocabularies -- map one to the other rather than passing
// session.user.gender straight through, which /search would reject with a 400.
export function toSearchGender(gender: 'female' | 'male' | null | undefined): 'women' | 'men' | undefined {
  if (gender === 'female') return 'women'
  if (gender === 'male') return 'men'
  return undefined
}
