import { useState, type FormEvent } from 'react'
import { DISCIPLINES } from '../lib/types'
import { supabase, supabaseConfigured } from '../lib/supabase'

type Mode = 'sign-in' | 'setup'

const fieldClass =
  'w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-brass'

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [discipline, setDiscipline] = useState<string>(DISCIPLINES[0])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!supabase) return
    setPending(true)
    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError
        return
      }

      if (password.length < 8) {
        throw new Error('Use a password of at least 8 characters.')
      }
      if (!fullName.trim()) {
        throw new Error('Add your name so the board knows who you are.')
      }

      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            full_name: fullName.trim(),
            engineering_discipline: discipline,
          },
        },
      })
      if (signUpError) throw signUpError
      if (!data.session) {
        setMessage('Check your email to confirm the account, then sign in.')
      }
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : 'Something went wrong.'
      if (/allowlist/i.test(text) || /database error saving new user/i.test(text)) {
        setError('That email is not on the organization allowlist. Ask an admin to add it.')
      } else {
        setError(text)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-4 py-12 md:grid-cols-2">
      <section>
        <p className="text-sm tracking-[0.18em] text-brass">DAILY LEARNING</p>
        <h1 className="mt-3 max-w-md text-4xl font-medium leading-tight">
          One quiz. Every working day. The floor ranks itself.
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-muted">
          Firmware, hardware, and software engineers on the allowlist. Answers are graded in
          Postgres. The browser never receives the correct option until you submit.
        </p>
        <ol className="mt-8 space-y-2 text-sm text-muted">
          <li>0 XP — Intern</li>
          <li>100 XP — Junior Engineer</li>
          <li>300 XP — Senior Engineer</li>
          <li>700 XP — Staff Engineer</li>
          <li>1500 XP — Principal Engineer</li>
        </ol>
      </section>

      <section className="rounded-xl border border-line bg-panel/90 p-6">
        {!supabaseConfigured && (
          <p className="mb-4 rounded-md border border-brass/40 bg-brass/10 px-3 py-2 text-sm text-brass">
            This build has no Supabase URL or anon key. Add the GitHub Actions secrets and redeploy,
            or copy <span className="font-mono">.env.example</span> to <span className="font-mono">.env</span> for
            local work.
          </p>
        )}

        <div className="mb-5 flex gap-2 text-sm">
          <button
            type="button"
            className={mode === 'sign-in' ? 'text-ink' : 'text-muted'}
            onClick={() => {
              setMode('sign-in')
              setError(null)
              setMessage(null)
            }}
          >
            Sign in
          </button>
          <span className="text-line">/</span>
          <button
            type="button"
            className={mode === 'setup' ? 'text-ink' : 'text-muted'}
            onClick={() => {
              setMode('setup')
              setError(null)
              setMessage(null)
            }}
          >
            First-time setup
          </button>
        </div>

        <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
          {mode === 'setup' && (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Full name</span>
                <input className={fieldClass} value={fullName} onChange={(event) => setFullName(event.target.value)} required />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Discipline</span>
                <select className={fieldClass} value={discipline} onChange={(event) => setDiscipline(event.target.value)}>
                  {DISCIPLINES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Work email</span>
            <input
              className={fieldClass}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Password</span>
            <input
              className={fieldClass}
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          {message && <p className="text-sm text-foam">{message}</p>}
          <button
            type="submit"
            disabled={!supabaseConfigured || pending}
            className="w-full rounded-md bg-brass px-3 py-2 text-sm font-medium text-panel disabled:opacity-50"
          >
            {pending ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </section>
    </div>
  )
}
