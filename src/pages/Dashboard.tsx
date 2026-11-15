import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { BadgeMark, Flame } from '../components/Marks'
import { orgToday, formatOrgDate } from '../lib/dates'
import { rankFor } from '../lib/ranks'
import { requireSupabase } from '../lib/supabase'
import { DISCIPLINES, type Badge, type Quiz } from '../lib/types'

type Earned = { badge_slug: string; awarded_at: string }

export function Dashboard() {
  const { profile, profileLoading, refreshProfile } = useAuth()
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [taken, setTaken] = useState(false)
  const [catalog, setCatalog] = useState<Badge[]>([])
  const [earned, setEarned] = useState<Earned[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [discipline, setDiscipline] = useState<string>(DISCIPLINES[0])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile) return
    const client = requireSupabase()
    let active = true
    const today = orgToday()

    async function load() {
      const [quizResult, badgeResult, earnedResult] = await Promise.all([
        client
          .from('quizzes')
          .select('id, publish_date, title, topic, difficulty, xp_reward')
          .eq('publish_date', today)
          .maybeSingle(),
        client.from('badges').select('slug, name, description'),
        client.from('user_badges').select('badge_slug, awarded_at').eq('user_id', profile!.id),
      ])
      if (!active) return
      if (quizResult.error) throw quizResult.error
      if (badgeResult.error) throw badgeResult.error
      if (earnedResult.error) throw earnedResult.error

      const todayQuiz = quizResult.data as Quiz | null
      setQuiz(todayQuiz)
      setCatalog((badgeResult.data ?? []) as Badge[])
      setEarned((earnedResult.data ?? []) as Earned[])

      if (todayQuiz) {
        const submission = await client
          .from('submissions')
          .select('id')
          .eq('quiz_id', todayQuiz.id)
          .eq('user_id', profile!.id)
          .maybeSingle()
        if (!active) return
        if (submission.error) throw submission.error
        setTaken(Boolean(submission.data))
      } else {
        setTaken(false)
      }
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
                {quiz.topic} · {quiz.difficulty} · {quiz.xp_reward} XP base
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

      <p className="text-xs text-muted">
        Base XP is the reward scaled by your score. Each extra streak day adds 5%, up to 50%.
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted">Badges</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {catalog.map((badge) => {
            const have = earnedSlugs.has(badge.slug)
            return (
              <li
                key={badge.slug}
                className={`flex gap-3 rounded-xl border p-3 ${have ? 'border-brass/50 bg-panel' : 'border-line bg-panel/50'}`}
              >
                <BadgeMark slug={badge.slug} earned={have} />
                <div>
                  <p className={have ? 'text-ink' : 'text-muted'}>{badge.name}</p>
                  <p className="text-xs text-muted">{badge.description}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
