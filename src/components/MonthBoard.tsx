import { Link } from 'react-router-dom'
import { CALENDAR_START, monthCells, monthTitle, orgToday, shiftMonth } from '../lib/dates'
import type { Quiz } from '../lib/types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type Props = {
  year: number
  month: number
  quizzes: Quiz[]
  attempted: Set<string>
  onMonth: (next: { year: number; month: number }) => void
}

export function MonthBoard({ year, month, quizzes, attempted, onMonth }: Props) {
  const today = orgToday()
  const current = today.slice(0, 7)
  const shown = `${year}-${String(month).padStart(2, '0')}`
  const byDate = new Map(quizzes.map((quiz) => [quiz.publish_date, quiz]))
  const atStart = year === CALENDAR_START.year && month === CALENDAR_START.month
  const atNow = shown === current

  return (
    <article className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-muted">Calendar</p>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            className="rounded-md border border-line px-2 py-1 text-muted disabled:opacity-30"
            disabled={atStart}
            onClick={() => onMonth(shiftMonth(year, month, -1))}
          >
            Prev
          </button>
          <span className="min-w-36 text-center">{monthTitle(year, month)}</span>
          <button
            type="button"
            className="rounded-md border border-line px-2 py-1 text-muted disabled:opacity-30"
            disabled={atNow}
            onClick={() => onMonth(shiftMonth(year, month, 1))}
          >
            Next
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-muted">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {monthCells(year, month).map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />
          const quiz = byDate.get(date)
          const done = quiz ? attempted.has(quiz.id) : false
          const future = date > today
          const label = String(Number(date.slice(8)))
          const tone = done
            ? 'bg-ok text-panel'
            : quiz
              ? 'bg-brass text-panel'
              : 'text-muted'
          const ring = date === today ? 'ring-1 ring-ink' : ''
          const cell = (
            <span className={`grid h-9 place-items-center rounded-md text-sm ${tone} ${ring}`}>{label}</span>
          )
          if (!quiz || future) {
            return (
              <span key={date} className={future ? 'opacity-40' : undefined}>
                {cell}
              </span>
            )
          }
          return (
            <Link key={date} to={`/quiz/${quiz.id}`} title={quiz.title} className="block">
              {cell}
            </Link>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        <span className="mr-3 inline-block h-2 w-2 rounded-sm bg-brass" />
        Released, one attempt left
        <span className="mr-3 ml-4 inline-block h-2 w-2 rounded-sm bg-ok" />
        Attempted
      </p>
    </article>
  )
}
