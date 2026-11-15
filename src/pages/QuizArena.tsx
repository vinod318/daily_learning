import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CodeBlock } from '../components/CodeBlock'
import { useAuth } from '../context/AuthContext'
import { orgToday } from '../lib/dates'
import { requireSupabase } from '../lib/supabase'
import type { BreakdownItem, Question, Quiz, QuizResult, Submission } from '../lib/types'

const LIMIT_SECONDS = 10 * 60
const SPEED_WINDOW_MS = 4 * 60 * 1000

function clock(total: number) {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
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
  const [secondsLeft, setSecondsLeft] = useState(LIMIT_SECONDS)
  const [speedEnds, setSpeedEnds] = useState<number | null>(null)
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
      if (!active) return

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
    if (reviewing || !quiz || quiz.publish_date !== orgToday()) return
    let active = true
    requireSupabase()
      .rpc('start_daily_quiz', { p_quiz_id: quiz.id })
      .then(({ data, error: startError }) => {
        if (!active || startError || !data) return
        const started = new Date((data as { started_at: string }).started_at).getTime()
        if (!Number.isNaN(started)) setSpeedEnds(started + SPEED_WINDOW_MS)
      })
    return () => {
      active = false
    }
  }, [reviewing, quiz])

  useEffect(() => {
    if (reviewing) return
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [reviewing])

  async function submit() {
    if (!quiz || !profile) return
    if (quiz.publish_date !== orgToday()) {
      setError("Only today's quiz can be submitted.")
      return
    }
    const unanswered = questions.some((question) => picks[question.id] === undefined)
    if (unanswered && secondsLeft > 0) {
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
            {quiz.topic} · {quiz.difficulty} · {quiz.xp_reward} XP base
          </p>
        </div>
        {!reviewing && (
          <div className="text-right">
            <p className={`font-mono text-lg ${secondsLeft < 60 ? 'text-danger' : 'text-brass'}`}>
              {clock(secondsLeft)}
            </p>
            <p className="text-xs text-muted">
              {speedEnds && Date.now() < speedEnds
                ? `Speed bonus ${clock(Math.ceil((speedEnds - Date.now()) / 1000))}`
                : 'Speed bonus closed'}
            </p>
            {secondsLeft === 0 && <p className="text-sm text-danger">Time is up — submit what you have.</p>}
          </div>
        )}
      </div>

      {reviewing && score !== undefined && (
        <section className="rounded-xl border border-line bg-panel p-4">
          <p className="text-lg">
            {score}/{total}
            {result ? ` · +${result.xp_earned} XP · streak ${result.current_streak}` : prior ? ` · +${prior.xp_earned} XP` : ''}
          </p>
          {result && result.speed_bonus > 0 && (
            <p className="mt-1 text-sm text-brass">Quick Draw +{result.speed_bonus} XP for finishing inside 4 minutes.</p>
          )}
          {result?.rank_up && <p className="mt-1 text-sm text-foam">Promoted to {result.rank_up}.</p>}
          {result && result.new_badges.length > 0 && (
            <p className="mt-1 text-sm text-brass">
              New badge{result.new_badges.length > 1 ? 's' : ''}: {result.new_badges.map((badge) => badge.name).join(', ')}
            </p>
          )}
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
