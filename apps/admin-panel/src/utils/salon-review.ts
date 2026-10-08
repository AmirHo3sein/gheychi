import { weekdayLabel } from '@/utils/labels'

/**
 * Pure helpers behind the salon approval review screen: the written checklist, the weekly
 * hours grouping and the read-only map preview geometry. Kept out of the component so each
 * rule is unit-testable without mounting anything.
 */

/**
 * The listing bar (spec: "admin review + phone call, with a written checklist"). Purely a
 * client-side gate on the Approve button -- deliberately NOT persisted: the audit log already
 * records who approved, and a stored checklist would only prove the boxes were clicked.
 */
export const APPROVAL_CHECKLIST: { key: string; label: string }[] = [
  { key: 'identity', label: 'نام، دسته و مخاطب (بانوان/آقایان) با واقعیت می‌خواند' },
  { key: 'location', label: 'موقعیت روی نقشه و آدرس منطقی است' },
  { key: 'photos', label: 'تصاویر مربوط به همین سالن است' },
  { key: 'call', label: 'با شماره مالک تماس گرفته شد' },
  { key: 'services', label: 'خدمات و قیمت‌ها منطقی است' },
]

export function isChecklistComplete(ticked: Record<string, boolean>): boolean {
  return APPROVAL_CHECKLIST.every((item) => ticked[item.key] === true)
}

export interface HourInput {
  // The admin endpoint's contract names it dayOfWeek; the entity column is `weekday`. Both
  // are 0 = Sunday (JS getDay) -- accept either so the screen survives the field rename.
  dayOfWeek?: number
  weekday?: number
  openTime: string
  closeTime: string
  isClosed?: boolean
}

export interface DayHours {
  day: number
  label: string
  /** Empty = closed. A day may have several ranges (split shift). */
  ranges: { open: string; close: string }[]
}

// Iran's week starts on Saturday; stored numbering stays 0 = Sunday.
const DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5]

const hhmm = (time: string) => time.slice(0, 5)

/** Always 7 rows in display order; a weekday with no open range (or flagged closed) is closed. */
export function groupWorkingHours(hours: HourInput[]): DayHours[] {
  return DISPLAY_ORDER.map((day) => ({
    day,
    label: weekdayLabel(day),
    ranges: hours
      .filter((h) => (h.dayOfWeek ?? h.weekday) === day && !h.isClosed)
      .map((h) => ({ open: hhmm(h.openTime), close: hhmm(h.closeTime) }))
      .sort((a, b) => a.open.localeCompare(b.open)),
  }))
}

export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const DEFAULT_TILE_ATTRIBUTION = '© OpenStreetMap'
export const PREVIEW_ZOOM = 16
const TILE_SIZE = 256

/** Slippy-map tile containing a point, plus the point's pixel offset inside that tile. */
export function tileForPoint(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom
  const latRad = (lat * Math.PI) / 180
  const xf = ((lng + 180) / 360) * n
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const x = Math.floor(xf)
  const y = Math.floor(yf)
  return { x, y, offsetX: (xf - x) * TILE_SIZE, offsetY: (yf - y) * TILE_SIZE }
}

export function fillTileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** Where the admin can inspect the pin on a full interactive map (always OSM, no key needed). */
export function externalMapUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
}

/** The fields GET /admin/salons/:id adds on top of the salon's own columns. */
export interface SalonReviewData {
  address: string
  city: string
  contactPhone: string | null
  createdAt: string
  owner: { id: string; name: string | null; phone: string; status: string }
  location: { lat: number; lng: number } | null
  photos: { id: string; url: string; sortOrder: number }[]
  services: {
    id: string
    name: string
    pricingType: string
    price: number | null
    priceMax: number | null
    durationMinutes: number
    isActive: boolean
  }[]
  hours: HourInput[]
  riskSummary: {
    bookingsTotal: number
    onlineBookings: number
    manualBookings: number
    cancelledBySalon: number
    rejectedBySalon: number
    noShowMarked: number
    openReports: number
  }
}

/** Plain-language labels for the 90-day counters; `warn` ones are highlighted when non-zero. */
export const RISK_STATS: { key: keyof SalonReviewData['riskSummary']; label: string; warn: boolean }[] = [
  { key: 'bookingsTotal', label: 'کل نوبت‌ها', warn: false },
  { key: 'onlineBookings', label: 'نوبت آنلاین', warn: false },
  { key: 'manualBookings', label: 'ثبت‌شده توسط خود سالن', warn: false },
  { key: 'cancelledBySalon', label: 'لغو از طرف سالن', warn: true },
  { key: 'rejectedBySalon', label: 'رد درخواست توسط سالن', warn: true },
  { key: 'noShowMarked', label: 'عدم حضور ثبت‌شده', warn: true },
  { key: 'openReports', label: 'گزارش باز', warn: true },
]
