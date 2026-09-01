import * as React from 'react'
import { Link, useSearchParams } from 'react-router'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/features/auth/api'
import { ApiError } from '@/lib/api-client'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * Opened from an inbox, routinely in a browser that has never seen this app —
 * so it must work with no session at all, which is why the endpoint behind it
 * is public.
 *
 * The token is consumed on mount rather than behind a "Verify" button: the
 * customer already expressed intent by clicking the link in the email, and a
 * second click is a step that only loses people.
 */
export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const { reloadUser, isAuthenticated } = useAuth()
  const token = params.get('token') ?? ''

  const { mutate, status, error } = useMutation({
    mutationFn: () => authApi.verifyEmail({ token }),
    onSuccess: () => {
      // If this same browser is signed in, its cached user still says
      // unverified. Re-read it so the banner disappears without a reload.
      void reloadUser()
    },
  })

  // Guarded by a ref, not by an empty dep array alone: StrictMode mounts effects
  // twice in development, and firing the mutation twice would spend the token on
  // the first call and show the second call's failure.
  const fired = React.useRef(false)
  React.useEffect(() => {
    if (!token || fired.current) return
    fired.current = true
    mutate()
  }, [token, mutate])

  if (!token) {
    return (
      <Outcome
        icon={<XCircle className="text-destructive size-8" />}
        title="This link is incomplete"
        body="Verification links expire after 24 hours. Request a new one from your account."
        action={{ to: '/', label: 'Go to the shop' }}
      />
    )
  }

  if (status === 'pending' || status === 'idle') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Spinner className="size-5" />
        <p className="text-muted-foreground text-sm">Verifying your email…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <Outcome
        icon={<XCircle className="text-destructive size-8" />}
        title="We could not verify that link"
        body={
          error instanceof ApiError
            ? error.message
            : 'Something went wrong. Try the link again in a moment.'
        }
        action={
          isAuthenticated
            ? { to: '/account/profile', label: 'Send a new link' }
            : { to: '/login', label: 'Sign in' }
        }
      />
    )
  }

  return (
    <Outcome
      icon={<CheckCircle2 className="text-success size-8" />}
      title="Email verified"
      body="Your account is all set."
      action={{ to: '/', label: 'Start shopping' }}
    />
  )
}

function Outcome({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action: { to: string; label: string }
}) {
  return (
    <div className="text-center">
      <div className="flex justify-center">{icon}</div>
      <h1 className="mt-4 text-xl">{title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{body}</p>
      <Button asChild size="lg" className="mt-6 w-full">
        <Link to={action.to}>{action.label}</Link>
      </Button>
    </div>
  )
}
