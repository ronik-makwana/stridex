import * as React from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronRight, MailWarning } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { authApi } from '@/features/auth/api'
import { formatDate } from '@/lib/format'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Phase 11's account page: enough to prove the session is real and the guard
 * works, and no more. Phase 16 grows this into order history, the address book
 * and profile editing — the tabs are its work, not this phase's.
 */
export default function AccountPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [resending, setResending] = React.useState(false)

  // RequireAuth guarantees this, but the type does not — and reading `user!`
  // here would be the one place a future refactor could crash the page.
  if (!user) return null

  const resendVerification = async () => {
    setResending(true)
    try {
      await authApi.resendVerification({ email: user.email })
      toast.success('Verification link sent', { description: 'Check your inbox.' })
    } finally {
      setResending(false)
    }
  }

  const signOut = async () => {
    await logout()
    navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <h1 className="text-2xl">Your account</h1>

      {!user.emailVerified && (
        <Alert className="mt-6">
          <MailWarning />
          <AlertTitle>Verify your email</AlertTitle>
          <AlertDescription>
            <p className="text-muted-foreground">
              We sent a link to {user.email}. Verifying secures your account and your order updates.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={resendVerification}
              disabled={resending}
            >
              {resending ? 'Sending…' : 'Resend the link'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <dl className="mt-8 divide-y border-y">
        <Row label="Name" value={user.fullName ?? '—'} />
        <Row label="Email" value={user.email} />
        <Row label="Mobile" value={user.phone ?? 'Not added'} />
        <Row label="Member since" value={formatDate(user.createdAt)} />
      </dl>

      {/*
        The account's other screens as they arrive. One link today rather than a
        sub-nav of three, two of which would go nowhere — orders and profile
        land with phase 16.
      */}
      <nav className="mt-8 border-y">
        <Link
          to="/account/addresses"
          className="hover:bg-secondary/60 flex items-center justify-between px-1 py-3.5 transition-colors"
        >
          <span className="text-sm">Addresses</span>
          <ChevronRight className="text-muted-foreground size-4" />
        </Link>
      </nav>

      <Button variant="outline" className="mt-8" onClick={signOut}>
        Sign out
      </Button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-3.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="col-span-2 text-sm">{value}</dd>
    </div>
  )
}
