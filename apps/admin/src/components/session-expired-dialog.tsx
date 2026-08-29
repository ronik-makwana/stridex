import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'

/**
 * Shown when a refresh fails while the admin was actively working. A redirect
 * alone would be worse: half-typed form state disappears with no explanation.
 */
export function SessionExpiredDialog() {
  const { sessionExpired, dismissSessionExpired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  if (!sessionExpired) return null

  const signInAgain = () => {
    dismissSessionExpired()
    navigate('/login', { replace: true, state: { from: location } })
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-card w-full max-w-sm rounded-xl border p-6 shadow-lg">
        <h2 id="session-expired-title" className="text-lg font-semibold">
          Your session expired
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          You were signed out for security. Sign in again to pick up where you left off.
        </p>
        <div className="mt-6 flex justify-end">
          <Button onClick={signInAgain}>Sign in again</Button>
        </div>
      </div>
    </div>
  )
}
