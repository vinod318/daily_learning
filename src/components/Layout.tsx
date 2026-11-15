import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Flame } from './Marks'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-panel-2 text-ink' : 'text-muted hover:text-ink'}`

export function Layout() {
  const { profile, role, signOut } = useAuth()

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-16 pt-6">
      <header className="mb-8 flex flex-wrap items-center gap-4 border-b border-line pb-4">
        <NavLink to="/today" className="mr-auto text-sm font-medium tracking-wide text-brass">
          DAILY LEARNING
        </NavLink>
        <nav className="flex items-center gap-1">
          <NavLink to="/today" className={linkClass}>
            Today
          </NavLink>
          <NavLink to="/board" className={linkClass}>
            Board
          </NavLink>
          <NavLink to="/notes" className={linkClass}>
            Notes
          </NavLink>
          {role === 'admin' && (
            <NavLink to="/admin" className={linkClass}>
              Admin
            </NavLink>
          )}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          {profile && (
            <span className="inline-flex items-center gap-1 text-brass">
              <Flame className="flame h-4 w-4" />
              {profile.current_streak}
            </span>
          )}
          <button type="button" onClick={() => void signOut()} className="text-muted hover:text-ink">
            Sign out
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
