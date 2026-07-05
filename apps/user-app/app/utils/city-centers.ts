export interface CityCenter {
  name: string
  lat: number
  lng: number
}

// Fallback for when the browser denies/lacks geolocation. Small starter list, not
// exhaustive -- add more cities here as the salon supply expands beyond them.
export const CITY_CENTERS: CityCenter[] = [
  { name: 'تهران', lat: 35.6892, lng: 51.389 },
  { name: 'مشهد', lat: 36.2605, lng: 59.6168 },
  { name: 'اصفهان', lat: 32.6546, lng: 51.668 },
  { name: 'شیراز', lat: 29.5918, lng: 52.5837 },
]
