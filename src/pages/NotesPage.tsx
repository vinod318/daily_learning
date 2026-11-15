import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatOrgDate, orgDateFromInstant } from '../lib/dates'
import { requireSupabase } from '../lib/supabase'
import type { BreakdownItem } from '../lib/types'

type Note = BreakdownItem & { takenOn: string }

export function NotesPage() {
  const { profile } = useAuth()
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    let active = true
    requireSupabase()
      .from('submissions')
      .select('detail, completed_at')
      .eq('user_id', profile.id)
      .order('completed_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) {
          setError(queryError.message)
          setLoading(false)
          return
        }
        const rows = (data ?? []) as Array<{ detail: BreakdownItem[]; completed_at: string }>
        const misses = rows.flatMap((row) =>
          (row.detail ?? [])
            .filter((item) => !item.is_correct && item.explanation)
            .map((item) => ({ ...item, takenOn: orgDateFromInstant(row.completed_at) })),
        )
        setNotes(misses)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [profile])

  if (loading) return <p className="text-sm text-muted">Opening your notes…</p>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-medium">Field notes</h1>
        <p className="mt-1 text-sm text-muted">
          Misses from quizzes you have already submitted. The explanation stays hidden until you commit an answer.
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {notes.length === 0 && !error && (
        <p className="text-sm text-muted">
          Nothing here yet. A miss on <Link to="/today" className="text-brass">today&apos;s quiz</Link> lands on this shelf.
        </p>
      )}
      <ul className="space-y-3">
        {notes.map((note) => (
          <li key={`${note.takenOn}-${note.question_id}`} className="rounded-xl border border-line bg-panel p-4">
            <p className="text-xs text-muted">
              {note.concept ?? 'Review'} · {formatOrgDate(note.takenOn)}
            </p>
            <p className="mt-1">{note.question_text}</p>
            <p className="mt-2 text-sm leading-6 text-foam">{note.explanation}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
