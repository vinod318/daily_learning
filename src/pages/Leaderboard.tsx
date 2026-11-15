import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Flame } from '../components/Marks'
import { rankFor } from '../lib/ranks'
import { requireSupabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

const COLUMNS =
  'id, full_name, engineering_discipline, total_xp, current_streak, avatar_url'

export function Leaderboard() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: queryError } = await requireSupabase()
      .from('profiles')
      .select(COLUMNS)
      .order('total_xp', { ascending: false })
      .order('current_streak', { ascending: false })
    if (queryError) throw queryError
    setRows((data ?? []) as Profile[])
  }, [])

  useEffect(() => {
    const client = requireSupabase()
    let active = true
    load().catch((caught: unknown) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : 'Could not load the board.')
    })
    const channel = client
      .channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        load().catch(() => {
          /* The next manual visit will surface a persistent error. */
        })
      })
      .subscribe()
    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [load])

  const ranked = [...rows].sort((a, b) => {
    if (b.total_xp !== a.total_xp) return b.total_xp - a.total_xp
    if (b.current_streak !== a.current_streak) return b.current_streak - a.current_streak
    return a.full_name.localeCompare(b.full_name)
  })

  return (
    <div>
      <h1 className="text-2xl font-medium">Organization board</h1>
      <p className="mt-1 text-sm text-muted">Sorted by total XP, then current streak. Updates as engineers finish.</p>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      <ol className="mt-6 divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
        {ranked.map((row, index) => {
          const mine = row.id === profile?.id
          const name = row.full_name || 'Unnamed engineer'
          return (
            <li
              key={row.id}
              className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-4 py-3 ${mine ? 'bg-brass/10' : ''}`}
            >
              <span className="font-mono text-sm text-muted">{index + 1}</span>
              <div>
                <p>{name}</p>
                <p className="text-xs text-muted">
                  {row.engineering_discipline ?? 'Discipline not set'} · {rankFor(row.total_xp).title}
                </p>
              </div>
              <div className="text-right text-sm">
                <p>{row.total_xp} XP</p>
                <p className="inline-flex items-center gap-1 text-xs text-brass">
                  <Flame className="h-3.5 w-3.5" />
                  {row.current_streak}
                </p>
              </div>
            </li>
          )
        })}
        {ranked.length === 0 && !error && <li className="px-4 py-6 text-sm text-muted">No engineers yet.</li>}
      </ol>
    </div>
  )
}
