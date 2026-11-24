import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { BadgeMark, Flame } from '../components/Marks'
import { MonthBoard } from '../components/MonthBoard'
import { CALENDAR_START, orgToday, formatOrgDate } from '../lib/dates'
import { rankFor } from '../lib/ranks'
import { requireSupabase } from '../lib/supabase'
import { DISCIPLINES, type Badge, type FloorPulse, type Quiz } from '../lib/types'

type Earned = { badge_slug: string; awarded_at: string }

export function Dashboard() {
  const { profile, profileLoading, refreshProfile } = useAuth()
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [attempted, setAttempted] = useState<Set<string>>(new Set())
  const todayParts = orgToday().split('-').map(Number)
  const [cursor, setCursor] = useState({ year: todayParts[0], month: todayParts[1] })
  const [catalog, setCatalog] = useState<Badge[]>([])
  const [earned, setEarned] = useState<Earned[]>([])
  const [pulse, setPulse] = useState<FloorPulse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [discipline, setDiscipline] = useState<string>(DISCIPLINES[0])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile) return
    const client = requireSupabase()
    let active = true

    async function load() {
      const [quizResult, badgeResult, earnedResult, pulseResult, historyResult] = await Promise.all([
        client
          .from('quizzes')
          .select('id, publish_date, title, topic, difficulty, xp_reward')
          .gte('publish_date', `${CALENDAR_START.year}-${String(CALENDAR_START.month).padStart(2, '0')}-01`)
          .order('publish_date'),
        client.from('badges').select('slug, name, description'),
        client.from('user_badges').select('badge_slug, awarded_at').eq('user_id', profile!.id),
        client.rpc('floor_pulse'),
        client.from('submissions').select('quiz_id').eq('user_id', profile!.id),
      ])
      if (!active) return
      if (quizResult.error) throw quizResult.error
      if (badgeResult.error) throw badgeResult.error
      if (earnedResult.error) throw earnedResult.error
      if (historyResult.error) throw historyResult.error

      setQuizzes((quizResult.data ?? []) as Quiz[])
      setAttempted(new Set(((historyResult.data ?? []) as Array<{ quiz_id: string }>).map((row) => row.quiz_id)))
      setCatalog((badgeResult.data ?? []) as Badge[])
      setEarned((earnedResult.data ?? []) as Earned[])
      if (!pulseResult.error && pulseResult.data) setPulse(pulseResult.data as FloorPulse)
    }

    load().catch((caught: unknown) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : 'Could not load today.')
    })
    return () => {
      active = false
    }
  }, [profile])

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!profile) return
    setSaving(true)
    setError(null)
    const { error: updateError } = await requireSupabase()
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        engineering_discipline: discipline,
      })
      .eq('id', profile.id)
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await refreshProfile()
  }

  if (profileLoading && !profile) {
    return <p className="text-sm text-muted">Loading your desk…</p>
  }

  if (!profile) {
    return (
      <p className="text-sm text-danger">
        Signed in, but there is no engineer profile. The allowlist trigger should create one. Re-run
        schema.sql if this account was created before that trigger existed.
      </p>
    )
  }

  if (!profile.full_name || !profile.engineering_discipline) {
    return (
      <form onSubmit={(event) => void saveProfile(event)} className="max-w-md space-y-3">
        <h1 className="text-2xl font-medium">Finish your profile</h1>
        <p className="text-sm text-muted">This is the name and discipline the leaderboard shows.</p>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Full name</span>
          <input
            className="w-full rounded-md border border-line bg-panel px-3 py-2"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Discipline</span>
          <select
            className="w-full rounded-md border border-line bg-panel px-3 py-2"
            value={discipline}
            onChange={(event) => setDiscipline(event.target.value)}
          >
            {DISCIPLINES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={saving} className="rounded-md bg-brass px-4 py-2 text-sm font-medium text-panel">
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    )
  }

  const rank = rankFor(profile.total_xp)
  const earnedSlugs = new Set(earned.map((item) => item.badge_slug))
  const today = orgToday()
  const quiz = quizzes.find((item) => item.publish_date === today) ?? null
  const taken = quiz ? attempted.has(quiz.id) : false

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">{profile.engineering_discipline}</p>
        <h1 className="text-3xl font-medium">{profile.full_name}</h1>
        <p className="mt-1 text-brass">{rank.title}</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-line bg-panel p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Streak</p>
          <p className="mt-2 flex items-center gap-2 text-3xl">
            <Flame className="flame h-7 w-7 text-brass" />
            {profile.current_streak}
          </p>
          <p className="mt-1 text-xs text-muted">Longest {profile.longest_streak}</p>
        </article>
        <article className="rounded-xl border border-line bg-panel p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Total XP</p>
          <p className="mt-2 text-3xl">{profile.total_xp}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-brass" style={{ width: `${rank.progress * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {rank.next ? `${rank.next.min - profile.total_xp} XP to ${rank.next.title}` : 'Top of the ladder'}
          </p>
        </article>
        <article className="rounded-xl border border-line bg-panel p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Today · {formatOrgDate(orgToday())}</p>
          {quiz ? (
            <>
              <h2 className="mt-2 text-lg">{quiz.title}</h2>
              <p className="text-sm text-muted">
                {quiz.topic} · {quiz.difficulty} · 1 XP per correct answer
              </p>
              {taken ? (
                <p className="mt-3 text-sm text-foam">Completed</p>
              ) : (
                <Link
                  to={`/quiz/${quiz.id}`}
                  className="mt-3 inline-block rounded-md bg-brass px-3 py-1.5 text-sm font-medium text-panel"
                >
                  Start quiz
                </Link>
              )}
              {taken && (
                <Link to={`/quiz/${quiz.id}`} className="mt-2 block text-sm text-muted hover:text-ink">
                  Review answers
                </Link>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">No quiz is published for today.</p>
          )}
        </article>
      </section>

      <OpenQuizzes quizzes={quizzes.filter((item) => !attempted.has(item.id))} />

      <p className="text-xs text-muted">
        One correct answer is 1 XP. There is no countdown. Finish inside 4 minutes with a correct answer for Quick Draw.
        A miss stays in your field notes.
      </p>

      <section className="grid gap-3 lg:grid-cols-[1.6fr_0.8fr]">
        <MonthBoard
          year={cursor.year}
          month={cursor.month}
          quizzes={quizzes}
          attempted={attempted}
          onMonth={setCursor}
        />
        {pulse && (
          <article className="rounded-xl border border-line bg-panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Floor</p>
            <p className="mt-2 text-lg">
              {pulse.finished_today} of {pulse.engineers} finished today
            </p>
            <p className="text-sm text-muted">
              You are #{pulse.your_place}
              {pulse.gap_above > 0 ? ` · ${pulse.gap_above} XP behind the next engineer` : ' · leading the floor'}
            </p>
          </article>
        )}
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}

      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted">Achievements</h2>
        <p className="mt-1 text-xs text-muted">Earned badges stay on your record. Locked ones show what is still open.</p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {[...catalog].sort((a, b) => Number(earnedSlugs.has(b.slug)) - Number(earnedSlugs.has(a.slug))).map((badge) => {
            const have = earnedSlugs.has(badge.slug)
            return (
              <li
                key={badge.slug}
                className={`flex gap-3 rounded-xl border p-3 ${have ? 'border-brass/50 bg-panel' : 'border-line bg-panel/50'}`}
              >
                <BadgeMark slug={badge.slug} earned={have} />
                <div className="min-w-0 flex-1">
                  <p className={have ? 'text-ink' : 'text-muted'}>{badge.name}</p>
                  <p className="text-xs text-muted">{badge.description}</p>
                  {!have && <BadgePace slug={badge.slug} streak={profile.current_streak} />}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function OpenQuizzes({ quizzes }: { quizzes: Quiz[] }) {
  const open = [...quizzes].sort((a, b) => b.publish_date.localeCompare(a.publish_date))
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm uppercase tracking-wide text-muted">Still open</h2>
      {open.length === 0 ? (
        <p className="mt-2 text-sm text-muted">You're caught up. New quizzes show up here in yellow on the calendar.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {open.map((quiz) => (
            <li key={quiz.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p>{quiz.title}</p>
                <p className="text-xs text-muted">{formatOrgDate(quiz.publish_date)} · {quiz.topic}</p>
              </div>
              <Link to={`/quiz/${quiz.id}`} className="rounded-md bg-brass px-3 py-1.5 text-sm font-medium text-panel">
                Sit this one
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BadgePace({ slug, streak }: { slug: string; streak: number }) {
  const target = slug === 'streak_7' ? 7 : slug === 'ironman_30' ? 30 : 0
  if (!target) return null
  const width = Math.min(100, Math.round((streak / target) * 100))
  return (
    <div className="mt-2">
      <div className="h-1 overflow-hidden rounded-full bg-panel">
        <div className="h-full bg-brass" style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{Math.min(streak, target)}/{target} days</p>
    </div>
  )
}
