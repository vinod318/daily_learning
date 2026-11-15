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
