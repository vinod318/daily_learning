import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { orgToday } from '../lib/dates'
import { requireSupabase } from '../lib/supabase'
import type { AdminQuiz, AllowlistEntry, Difficulty, Role } from '../lib/types'

type DraftQuestion = {
  question_text: string
  code_snippet: string
  concept: string
  explanation: string
  options: string[]
  correct_option_index: number
}

const emptyQuestion = (): DraftQuestion => ({
  question_text: '',
  code_snippet: '',
  concept: '',
  explanation: '',
  options: ['', '', '', ''],
  correct_option_index: 0,
})

const fieldClass = 'w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-brass'

export function AdminPage() {
  const { role } = useAuth()
  const [engineers, setEngineers] = useState<AllowlistEntry[]>([])
  const [quizzes, setQuizzes] = useState<AdminQuiz[]>([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('engineer')
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('C/Embedded')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [xpReward, setXpReward] = useState(100)
  const [publishDate, setPublishDate] = useState(orgToday())
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function reload() {
    const client = requireSupabase()
    const [engineerResult, quizResult] = await Promise.all([
      client.rpc('admin_list_engineers'),
      client.rpc('admin_list_quizzes'),
    ])
    if (engineerResult.error) throw engineerResult.error
    if (quizResult.error) throw quizResult.error
    setEngineers((engineerResult.data ?? []) as AllowlistEntry[])
    setQuizzes((quizResult.data ?? []) as AdminQuiz[])
  }

  useEffect(() => {
    if (role !== 'admin') return
    let active = true
    reload().catch((caught: unknown) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : 'Could not load the admin desk.')
    })
    return () => {
      active = false
    }
  }, [role])

  if (role !== 'admin') {
    return <p className="text-sm text-muted">This desk is for admins.</p>
  }

  async function addEngineer(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setNotice(null)
    const { error: rpcError } = await requireSupabase().rpc('admin_add_engineer', {
      p_email: email,
      p_role: inviteRole,
    })
    setPending(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setEmail('')
    setNotice('Allowlist updated.')
    await reload()
  }

  async function removeEngineer(target: string) {
    setError(null)
    const { error: rpcError } = await requireSupabase().rpc('admin_remove_engineer', { p_email: target })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await reload()
  }

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) => current.map((question, i) => (i === index ? { ...question, ...patch } : question)))
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const payload = {
        title,
        topic,
        difficulty,
        xp_reward: xpReward,
        publish_date: publishDate,
        is_active: true,
        questions: questions.map((question, index) => {
          const options = question.options.map((option) => option.trim())
          if (options.some((option) => option.length === 0)) {
            throw new Error(`Question ${index + 1} has an empty option. Fill it or remove it.`)
          }
          return {
            question_text: question.question_text,
            code_snippet: question.code_snippet,
            concept: question.concept,
            explanation: question.explanation,
            options,
            correct_option_index: question.correct_option_index,
          }
        }),
      }
      const { error: rpcError } = await requireSupabase().rpc('admin_publish_quiz', { payload })
      if (rpcError) throw new Error(rpcError.message)
      setNotice(`Published ${publishDate}.`)
      setTitle('')
      setQuestions([emptyQuestion()])
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not publish.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-medium">Admin desk</h1>
        <p className="mt-1 text-sm text-muted">
          Add allowlisted emails before they can create an account. Publishing a date that already has submissions is refused.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {notice && <p className="text-sm text-foam">{notice}</p>}

      <section className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={(event) => void addEngineer(event)} className="space-y-3 rounded-xl border border-line bg-panel p-4">
          <h2 className="text-sm uppercase tracking-wide text-muted">Allowlist</h2>
          <input
            className={fieldClass}
            type="email"
            placeholder="engineer@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <select className={fieldClass} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)}>
            <option value="engineer">engineer</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" disabled={pending} className="rounded-md bg-brass px-3 py-2 text-sm font-medium text-panel">
            Add email
          </button>
          <ul className="divide-y divide-line text-sm">
            {engineers.map((engineer) => (
              <li key={engineer.email} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {engineer.email}
                  <span className="ml-2 text-xs text-muted">{engineer.role}</span>
                </span>
                <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => void removeEngineer(engineer.email)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </form>

        <form onSubmit={(event) => void publish(event)} className="space-y-3 rounded-xl border border-line bg-panel p-4">
          <h2 className="text-sm uppercase tracking-wide text-muted">Publish a daily quiz</h2>
          <input className={fieldClass} placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={fieldClass} placeholder="Topic" value={topic} onChange={(event) => setTopic(event.target.value)} required />
            <input className={fieldClass} type="date" value={publishDate} onChange={(event) => setPublishDate(event.target.value)} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select className={fieldClass} value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
            <input
              className={fieldClass}
              type="number"
              min={1}
              value={xpReward}
              onChange={(event) => setXpReward(Number(event.target.value))}
            />
          </div>

          {questions.map((question, index) => (
            <fieldset key={index} className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-xs text-muted">Question {index + 1}</legend>
              <textarea
                className={fieldClass}
                rows={2}
                placeholder="Question"
                value={question.question_text}
                onChange={(event) => updateQuestion(index, { question_text: event.target.value })}
                required
              />
              <textarea
                className={`${fieldClass} font-mono`}
                rows={3}
                placeholder="Optional code"
                value={question.code_snippet}
                onChange={(event) => updateQuestion(index, { code_snippet: event.target.value })}
              />
              <input
                className={fieldClass}
                placeholder="Concept, such as ADC"
                value={question.concept}
                onChange={(event) => updateQuestion(index, { concept: event.target.value })}
              />
              <textarea
                className={fieldClass}
                rows={2}
                placeholder="Explanation shown only after an engineer submits"
                value={question.explanation}
                onChange={(event) => updateQuestion(index, { explanation: event.target.value })}
              />
              {question.options.map((option, optionIndex) => (
                <label key={optionIndex} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`correct-${index}`}
                    checked={question.correct_option_index === optionIndex}
                    onChange={() => updateQuestion(index, { correct_option_index: optionIndex })}
                  />
                  <input
                    className={fieldClass}
                    placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`}
                    value={option}
                    onChange={(event) => {
                      const options = [...question.options]
                      options[optionIndex] = event.target.value
                      updateQuestion(index, { options })
                    }}
                  />
                </label>
              ))}
              <div className="flex gap-3 text-xs text-muted">
                <button
                  type="button"
                  onClick={() => updateQuestion(index, { options: [...question.options, ''] })}
                >
                  Add option
                </button>
                {question.options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => {
                      const options = question.options.slice(0, -1)
                      const correct = Math.min(question.correct_option_index, options.length - 1)
                      updateQuestion(index, { options, correct_option_index: correct })
                    }}
                  >
                    Remove last option
                  </button>
                )}
                {questions.length > 1 && (
                  <button type="button" onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))}>
                    Remove question
                  </button>
                )}
              </div>
            </fieldset>
          ))}
          <button type="button" className="text-sm text-muted" onClick={() => setQuestions((current) => [...current, emptyQuestion()])}>
            Add question
          </button>
          <button type="submit" disabled={pending} className="block rounded-md bg-brass px-3 py-2 text-sm font-medium text-panel">
            {pending ? 'Publishing…' : 'Publish'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted">Published</h2>
        <ul className="mt-3 space-y-3">
          {quizzes.map((quiz) => (
            <li key={quiz.id} className="rounded-xl border border-line bg-panel p-4 text-sm">
              <p>
                <span className="font-mono text-muted">{quiz.publish_date}</span> · {quiz.title}
              </p>
              <p className="text-muted">
                {quiz.topic} · {quiz.difficulty} · 1 XP per correct answer · {quiz.submission_count} submission
                {quiz.submission_count === 1 ? '' : 's'}
                {!quiz.is_active && ' · inactive'}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-muted">Questions and answers</summary>
                <ol className="mt-2 space-y-2">
                  {quiz.questions.map((question, index) => (
                    <li key={question.id ?? index}>
                      <p>{question.question_text}</p>
                      <p className="text-foam">
                        Correct: {question.options[question.correct_option_index] ?? '—'}
                      </p>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
