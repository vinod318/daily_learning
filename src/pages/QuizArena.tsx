import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CodeBlock } from '../components/CodeBlock'
import { BadgeMark } from '../components/Marks'
import { useAuth } from '../context/AuthContext'
import { orgToday } from '../lib/dates'
import { requireSupabase } from '../lib/supabase'
import type { Badge, BreakdownItem, Question, Quiz, QuizResult, Submission } from '../lib/types'

const FAST_MS = 4 * 60 * 1000

function clock(total: number) {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function Achievements({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) {
    return <p className="mt-3 text-sm text-muted">No achievement on this attempt.</p>
  }
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-wide text-muted">Achievements</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {badges.map((badge) => (
          <li key={badge.slug} className="flex gap-3 rounded-lg border border-brass/40 bg-panel-2 p-3">
            <BadgeMark slug={badge.slug} earned />
            <div>
              <p>{badge.name}</p>
              <p className="text-xs text-muted">{badge.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function asOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item))
}

export function QuizArena() {
  const { quizId } = useParams()
  const { profile, refreshProfile } = useAuth()
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [picks, setPicks] = useState<Record<string, number>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [prior, setPrior] = useState<Submission | null>(null)
  const [paperBadges, setPaperBadges] = useState<Badge[]>([])
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!profile || !quizId) return
    const client = requireSupabase()
    let active = true

    async function load() {
      const quizResult = await client
        .from('quizzes')
        .select('id, publish_date, title, topic, difficulty, xp_reward')
        .eq('id', quizId)
        .maybeSingle()
      if (quizResult.error) throw quizResult.error
      const questionResult = await client
        .from('questions')
        .select('id, quiz_id, question_text, code_snippet, concept, options, sort_order')
        .eq('quiz_id', quizId)
        .order('sort_order')
      if (questionResult.error) throw questionResult.error
      const submissionResult = await client
        .from('submissions')
        .select('id, quiz_id, score, xp_earned, detail, completed_at')
        .eq('quiz_id', quizId)
        .eq('user_id', profile!.id)
        .maybeSingle()
      if (submissionResult.error) throw submissionResult.error
      const priorRow = (submissionResult.data as Submission | null) ?? null
      const [catalogResult, heldResult, startResult, historyResult] = await Promise.all([
        client.from('badges').select('slug, name, description'),
        client.from('user_badges').select('badge_slug').eq('user_id', profile!.id),
        client.from('quiz_starts').select('started_at').eq('user_id', profile!.id).eq('quiz_id', quizId).maybeSingle(),
        client.from('submissions').select('completed_at').eq('user_id', profile!.id).order('completed_at'),
      ])
      if (catalogResult.error) throw catalogResult.error
      if (heldResult.error) throw heldResult.error
      if (historyResult.error) throw historyResult.error
      if (!active) return
      const catalog = (catalogResult.data ?? []) as Badge[]
      const held = new Set(((heldResult.data ?? []) as Array<{ badge_slug: string }>).map((row) => row.badge_slug))
      const history = (historyResult.data ?? []) as Array<{ completed_at: string }>
      const startedAt = (startResult.data as { started_at: string } | null)?.started_at
      const earnedHere: string[] = []
      if (priorRow) {
        const earliest = history[0]?.completed_at
        if (earliest && earliest === priorRow.completed_at) earnedHere.push('first_blood')
        if (priorRow.score > 0 && priorRow.score === ((questionResult.data ?? []) as unknown[]).length) {
          earnedHere.push('perfect_score')
        }
        if (startedAt && priorRow.score > 0) {
          const elapsed = new Date(priorRow.completed_at).getTime() - new Date(startedAt).getTime()
          if (elapsed >= 0 && elapsed <= FAST_MS) earnedHere.push('quick_draw')
        }
      }
      setPaperBadges(catalog.filter((badge) => earnedHere.includes(badge.slug) && held.has(badge.slug)))

      setQuiz((quizResult.data as Quiz | null) ?? null)
      setQuestions(
        ((questionResult.data ?? []) as Array<Question & { options: unknown }>).map((row) => ({
          ...row,
          concept: row.concept ?? null,
          options: asOptions(row.options),
        })),
      )
      setPrior((submissionResult.data as Submission | null) ?? null)
      setLoading(false)
    }

    load().catch((caught: unknown) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : 'Could not open the quiz.')
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [profile, quizId])

  const reviewing = Boolean(prior || result)
  useEffect(() => {
    if (reviewing || !quiz || quiz.publish_date > orgToday()) return
    let active = true
    requireSupabase()
      .rpc('start_daily_quiz', { p_quiz_id: quiz.id })
      .then(({ data }) => {
        if (!active || !data) return
        const started = new Date((data as { started_at: string }).started_at).getTime()
        if (!Number.isNaN(started)) setStartedAt(started)
      })
    return () => {
      active = false
    }
  }, [reviewing, quiz])

  useEffect(() => {
    if (reviewing) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [reviewing])

  async function submit() {
    if (!quiz || !profile) return
    if (quiz.publish_date > orgToday()) {
      setError('That quiz is not open yet.')
      return
    }
    const unanswered = questions.some((question) => picks[question.id] === undefined)
    if (unanswered) {
      setError('Answer every question before submitting.')
      return
    }
    setSubmitting(true)
    setError(null)
    const answers = questions.map((question) => ({
      question_id: question.id,
      selected_index: picks[question.id],
    }))
    const { data, error: rpcError } = await requireSupabase().rpc('submit_daily_quiz', {
      p_quiz_id: quiz.id,
      p_answers: answers,
    })
    setSubmitting(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setResult(data as QuizResult)
    await refreshProfile()
  }

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  const quickLeft = Math.max(0, Math.ceil((FAST_MS - elapsed * 1000) / 1000))

  if (loading) return <p className="text-sm text-muted">Opening the quiz…</p>
  if (!quiz) return <p className="text-sm text-muted">That quiz is not available.</p>

  const breakdown = new Map<string, BreakdownItem>(
    (result?.breakdown ?? prior?.detail ?? []).map((item) => [item.question_id, item]),
  )
  const misses = (result?.breakdown ?? prior?.detail ?? []).filter((item) => !item.is_correct && item.explanation)
  const score = result?.score ?? prior?.score
  const total = result?.total ?? questions.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/today" className="text-xs text-muted hover:text-ink">
            Back to today
          </Link>
          <h1 className="mt-1 text-2xl font-medium">{quiz.title}</h1>
          <p className="text-sm text-muted">
            {quiz.topic} · {quiz.difficulty} · 1 XP per correct answer
          </p>
        </div>
        {!reviewing && (
          <div className="text-right">
            <p className="font-mono text-lg text-brass">{clock(elapsed)}</p>
            <p className="text-xs text-muted">
              {quickLeft > 0 ? `Quick Draw ${clock(quickLeft)}` : 'Quick Draw closed'}
            </p>
          </div>
        )}
      </div>

      {reviewing && score !== undefined && (
        <section className="rounded-xl border border-line bg-panel p-4">
          <p className="text-lg">
            {score}/{total}
            {result ? ` · +${result.xp_earned} XP · streak ${result.current_streak}` : prior ? ` · +${prior.xp_earned} XP` : ''}
          </p>
          {result?.rank_up && <p className="mt-1 text-sm text-foam">Promoted to {result.rank_up}.</p>}
          <Achievements badges={result?.attempt_badges?.length ? result.attempt_badges : result?.new_badges ?? paperBadges} />
        </section>
      )}

      {misses.length > 0 && (
        <section className="rounded-xl border border-brass/40 bg-panel p-4">
          <h2 className="text-sm uppercase tracking-wide text-brass">Field notes</h2>
          <ul className="mt-3 space-y-3">
            {misses.map((item) => (
              <li key={item.question_id}>
                <p className="text-xs text-muted">{item.concept ?? 'Review'}</p>
                <p className="text-sm">{item.question_text}</p>
                <p className="mt-1 text-sm leading-6 text-foam">{item.explanation}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol className="space-y-5">
        {questions.map((question, index) => {
          const graded = breakdown.get(question.id)
          return (
            <li key={question.id} className="rounded-xl border border-line bg-panel p-4">
              <p className="text-xs text-muted">
                Question {index + 1}
                {question.concept ? ` · ${question.concept}` : ''}
              </p>
              <p className="mt-1">{question.question_text}</p>
              {question.code_snippet && (
                <div className="mt-3">
                  <CodeBlock code={question.code_snippet} />
                </div>
              )}
              <div className="mt-3 space-y-2">
                {question.options.map((option, optionIndex) => {
                  const selected = (picks[question.id] ?? graded?.selected_index) === optionIndex
                  const correct = graded?.correct_option_index === optionIndex
                  let tone = 'border-line'
                  if (graded && correct) tone = 'border-ok bg-ok/10'
                  else if (graded && selected && !correct) tone = 'border-danger bg-danger/10'
                  else if (!graded && selected) tone = 'border-brass bg-brass/10'
                  return (
                    <button
                      key={`${question.id}-${optionIndex}`}
                      type="button"
                      disabled={reviewing}
                      aria-pressed={selected}
                      onClick={() => setPicks((current) => ({ ...current, [question.id]: optionIndex }))}
                      className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${tone} disabled:cursor-default`}
                    >
                      <span className="mr-2 font-mono text-muted">{String.fromCharCode(65 + optionIndex)}</span>
                      {option}
                    </button>
                  )
                })}
              </div>
              {graded?.explanation && (
                <p className="mt-3 border-t border-line pt-3 text-sm leading-6 text-foam">{graded.explanation}</p>
              )}
            </li>
          )
        })}
      </ol>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!reviewing && (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="rounded-md bg-brass px-4 py-2 text-sm font-medium text-panel disabled:opacity-50"
        >
          {submitting ? 'Grading…' : 'Submit answers'}
        </button>
      )}
    </div>
  )
}
