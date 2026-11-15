import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import type { Profile, Role } from '../lib/types'

type AuthValue = {
  configured: boolean
  loading: boolean
  profileLoading: boolean
  session: Session | null
  profile: Profile | null
  role: Role | null
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

const PROFILE_COLUMNS =
  'id, email, full_name, engineering_discipline, avatar_url, total_xp, current_streak, longest_streak, last_quiz_date, created_at'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(supabaseConfigured)
  const [profileLoading, setProfileLoading] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [role, setRole] = useState<Role | null>(null)

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return
    setProfileLoading(true)
    try {
      const [profileResult, roleResult] = await Promise.all([
        supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(),
        supabase.rpc('current_role'),
      ])
      if (profileResult.error) throw profileResult.error
      if (roleResult.error) throw roleResult.error
      setProfile(profileResult.data as Profile | null)
      const nextRole = roleResult.data
      setRole(nextRole === 'admin' || nextRole === 'engineer' ? nextRole : 'engineer')
    } finally {
      setProfileLoading(false)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!session) return
    await loadProfile(session.user.id)
  }, [loadProfile, session])

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
      if (!next) {
        setProfile(null)
        setRole(null)
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) return
    let active = true
    loadProfile(session.user.id).catch(() => {
      if (!active) return
      setProfile(null)
      setRole(null)
    })
    return () => {
      active = false
    }
  }, [loadProfile, session])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      configured: supabaseConfigured,
      loading,
      profileLoading,
      session,
      profile,
      role,
      refreshProfile,
      signOut,
    }),
    [loading, profileLoading, session, profile, role, refreshProfile, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
