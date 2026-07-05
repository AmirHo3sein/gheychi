// The user's own gender identity ('female'/'male') and a salon's target clientele
// ('women'/'men', the vocabulary /search's `gender` param expects) are different
// fields with different vocabularies -- map one to the other rather than passing
// session.user.gender straight through, which /search would reject with a 400.
export function toSearchGender(gender: 'female' | 'male' | null | undefined): 'women' | 'men' | undefined {
  if (gender === 'female') return 'women'
  if (gender === 'male') return 'men'
  return undefined
}
