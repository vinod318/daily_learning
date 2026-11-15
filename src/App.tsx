import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { AuthPage } from './pages/AuthPage'
import { Dashboard } from './pages/Dashboard'
import { QuizArena } from './pages/QuizArena'
import { Leaderboard } from './pages/Leaderboard'
import { AdminPage } from './pages/AdminPage'
import { NotesPage } from './pages/NotesPage'

function BootScreen() {
  return (
    <div className="grid min-h-screen place-items-center text-sm tracking-wide text-brass">
      DAILY LEARNING
    </div>
  )
}

export function App() {
  const { configured, loading, session } = useAuth()

  if (!configured) return <AuthPage />
  if (loading) return <BootScreen />

  return (
    <Routes>
      <Route path="/" element={session ? <Navigate to="/today" replace /> : <AuthPage />} />
      <Route element={session ? <Layout /> : <Navigate to="/" replace />}>
        <Route path="/today" element={<Dashboard />} />
        <Route path="/quiz/:quizId" element={<QuizArena />} />
        <Route path="/board" element={<Leaderboard />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/today' : '/'} replace />} />
    </Routes>
  )
}
