const ORG_TIME_ZONE = 'Asia/Kolkata'

export function orgToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function orgDateFromInstant(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export const CALENDAR_START = { year: 2026, month: 11 }

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const next = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 }
}

export function monthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<string | null> = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= days; day += 1) {
    cells.push(new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10))
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function recentOrgDates(days: number, today = orgToday()): string[] {
  const [year, month, day] = today.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day))
  const dates: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const next = new Date(anchor)
    next.setUTCDate(anchor.getUTCDate() - offset)
    dates.push(next.toISOString().slice(0, 10))
  }
  return dates
}

export function formatOrgDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}
