import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import type { Profile } from '@/types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  isLoading: boolean
  isInitialized: boolean
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null, user: null, profile: null, isLoading: true, isInitialized: false,
  })

  const loadProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      return data as unknown as Profile | null
    } catch { return null }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!state.user) return
    const profile = await loadProfile(state.user.id)
    setState(prev => ({ ...prev, profile }))
  }, [state.user, loadProfile])

  useEffect(() => {
    // Safety timeout — never hang forever
    const timeout = setTimeout(() => {
      setState(prev => {
        if (!prev.isInitialized) {
          return { ...prev, isLoading: false, isInitialized: true }
        }
        return prev
      })
    }, 3000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(timeout)
      const profile = session?.user ? await loadProfile(session.user.id) : null
      setState({ session, user: session?.user ?? null, profile, isLoading: false, isInitialized: true })
    }).catch(() => {
      clearTimeout(timeout)
      setState({ session: null, user: null, profile: null, isLoading: false, isInitialized: true })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const profile = session?.user ? await loadProfile(session.user.id) : null
      setState(prev => ({ ...prev, session, user: session?.user ?? null, profile, isLoading: false, isInitialized: true }))
    })

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: error.message }
      return { error: null }
    } catch {
      return { error: 'Connection failed. Check your Supabase credentials.' }
    }
  }, [])

  const signOut = useCallback(async () => {
    try { await supabase.auth.signOut() } catch { /* ignore */ }
  }, [])

  return <AuthContext.Provider value={{ ...state, signIn, signOut, refreshProfile }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
