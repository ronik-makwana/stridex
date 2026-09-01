import * as React from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Eye, EyeOff, MailCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-client'
import { safeRedirect } from '@/lib/redirect'
import { authApi } from '@/features/auth/api'
import { registerSchema, type RegisterValues } from '@/features/auth/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FullPageSpinner, Spinner } from '@/components/ui/spinner'

/**
 * Registration ends on a "check your email" state, not a redirect — the spec is
 * explicit about that. The customer *is* signed in by then (the API issues a
 * session so Phase 14 has something to merge the guest cart into), so this
 * screen is a confirmation with a way onward, never a wall.
 */
function CheckYourEmail({ email, redirect }: { email: string; redirect: string }) {
  const [resent, setResent] = React.useState(false)
  const [resending, setResending] = React.useState(false)

  const resend = async () => {
    setResending(true)
    try {
      await authApi.resendVerification({ email })
      // The API answers 202 whether or not there was anything to send, so this
      // says "sent" without claiming the address exists.
      setResent(true)
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="text-center">
      <MailCheck className="text-muted-foreground mx-auto size-8" />
      <h1 className="mt-4 text-xl">Check your inbox</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        We sent a verification link to <span className="text-foreground">{email}</span>. It expires
        in 24 hours.
      </p>
      <p className="text-muted-foreground mt-4 text-sm">
        You are already signed in — verifying just secures your account.
      </p>

      <Button asChild size="lg" className="mt-6 w-full">
        <Link to={redirect}>{redirect === '/' ? 'Start shopping' : 'Continue'}</Link>
      </Button>

      <div className="mt-4">
        {resent ? (
          <p className="text-muted-foreground text-sm">Sent. Give it a minute.</p>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={resending}
            className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors disabled:opacity-50"
          >
            {resending ? 'Sending…' : 'Resend the link'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function RegisterPage() {
  const { register: registerAccount, status } = useAuth()
  const [params] = useSearchParams()
  const [banner, setBanner] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)
  const [registeredEmail, setRegisteredEmail] = React.useState<string | null>(null)

  const redirect = safeRedirect(params.get('redirect'))

  /*
   * Whether this browser was *already* signed in when the page mounted.
   *
   * This cannot be `status === 'authenticated'` read live. Registering succeeds
   * by creating a session, so a live read flips to true the instant the form is
   * submitted — and a guard reacting to that redirects the customer home before
   * the "check your inbox" screen renders, which is precisely the redirect the
   * spec says registration must not end in. Recorded once, on the first render
   * where auth has resolved, and never updated after.
   */
  const wasSignedInOnMount = React.useRef<boolean | null>(null)
  if (wasSignedInOnMount.current === null && status !== 'loading') {
    wasSignedInOnMount.current = status === 'authenticated'
  }

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', phone: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null)
    try {
      await registerAccount(values)
      setRegisteredEmail(values.email)
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        // A taken email is the one case worth putting on the field itself: the
        // customer knows the address is theirs, and a banner would leave them
        // hunting for which input to fix.
        for (const [field, message] of Object.entries(error.fields ?? {})) {
          setError(field as keyof RegisterValues, { message })
        }
        return
      }
      setBanner(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
      )
    }
  })

  // Hooks are all above this line; these three returns are the render branches.
  if (status === 'loading') return <FullPageSpinner label="One moment" />
  // Someone who already has an account has no business on this form.
  if (wasSignedInOnMount.current) return <Navigate to={redirect} replace />
  if (registeredEmail) return <CheckYourEmail email={registeredEmail} redirect={redirect} />

  return (
    <div>
      <h1 className="text-xl">Create an account</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        Faster checkout, order history, and a wishlist that follows you.
      </p>

      {banner && (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              autoComplete="given-name"
              autoFocus
              aria-invalid={Boolean(errors.firstName)}
              {...register('firstName')}
            />
            {errors.firstName && (
              <p className="text-destructive text-sm">{errors.firstName.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">
              Last name <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input id="lastName" autoComplete="family-name" {...register('lastName')} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
          {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className="pr-11"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-11 items-center justify-center transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {errors.password ? (
            <p className="text-destructive text-sm">{errors.password.message}</p>
          ) : (
            <p className="text-muted-foreground text-xs">At least 8 characters.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">
            Mobile <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="9876543210"
            aria-invalid={Boolean(errors.phone)}
            {...register('phone')}
          />
          {errors.phone ? (
            <p className="text-destructive text-sm">{errors.phone.message}</p>
          ) : (
            <p className="text-muted-foreground text-xs">For delivery updates only.</p>
          )}
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          Create account
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-sm">
        Already have an account?{' '}
        <Link
          to={`/login${redirect === '/' ? '' : `?redirect=${encodeURIComponent(redirect)}`}`}
          className="text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
