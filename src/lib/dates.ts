import type { BusinessDate, ISODateTime } from '@/types/models'

export const TIME_ZONE = 'Asia/Kuala_Lumpur'

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Calendar date in Malaysia for the given instant, as `YYYY-MM-DD`. */
export function toBusinessDate(instant: Date = new Date()): BusinessDate {
  // en-CA formats as YYYY-MM-DD
  return ymdFormatter.format(instant)
}

/** Today's date in Malaysia (`YYYY-MM-DD`). */
export function todayMY(): BusinessDate {
  return toBusinessDate(new Date())
}

export function nowISO(): ISODateTime {
  return new Date().toISOString()
}

export function isValidBusinessDate(value: unknown): value is BusinessDate {
  if (typeof value !== 'string') return false
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

function toUTCms(date: BusinessDate): number {
  const m = DATE_RE.exec(date)
  if (!m) return Number.NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  return Math.round((toUTCms(to) - toUTCms(from)) / 86_400_000)
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  const ms = toUTCms(date) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** `2026-10-01` → `01/10/2026` */
export function formatDate(date: BusinessDate | null | undefined): string {
  if (!date) return '—'
  const m = DATE_RE.exec(date)
  if (!m) return date
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** ISO timestamp → `01/10/2026 14:05` in Malaysia time */
export function formatDateTime(iso: ISODateTime | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatDate(toBusinessDate(d))} ${timeFormatter.format(d)}`
}

/** Year (Malaysia time) used for document numbering. */
export function yearOf(date: BusinessDate): string {
  return date.slice(0, 4)
}
