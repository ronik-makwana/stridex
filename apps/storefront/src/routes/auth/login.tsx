import * as React from 'react'
import { usePageMeta } from '@/lib/use-page-meta'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-client'
import { safeRedirect } from '@/lib/redirect'
import { loginSchema, type LoginValues } from '@/features/auth/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

/**
 * The message above the form is the guard's, shown only when the customer was
 * bounced here from somewhere. Arriving at /login directly gets the plain
 * heading.
 */
function guardMessageFor(redirect: string): string | null {
  if (redirect.startsWith('/checkout')) return 'Sign in to complete your order'
  if (redirect.startsWith('/account')) return 'Sign in to see your account'
  if (redirect.startsWith('/order/')) return 'Sign in to see this order'
  return null
}

export default function LoginPage() {
  usePageMeta({ title: 'Sign in' })

  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [banner, setBanner] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)

  // Validated the moment it is read, not at the moment it is used. Anything
  // that is not a site-relative path collapses to `/` (see lib/redirect.ts) —
  // without this the login page is an open redirect.
  const redirect = safeRedirect(params.get('redirect'))
  const guardMessage = guardMessageFor(redirect)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null)
    try {
      await login(values.email, values.password)
      navigate(redirect, { replace: true })
    } catch (error) {
      // A banner above the form, never a field error. Attaching "wrong
      // password" to the password input tells an attacker the email was right,
      // and the API deliberately refuses to make that distinction anyway — an
      // admin account fails here with this same generic message.
      setBanner(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again in a moment.',
      )
    }
  })

  return (
    <div>
      <h1 className="text-xl">{guardMessage ?? 'Sign in'}</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {guardMessage ? 'Your cart is saved and waiting.' : 'Welcome back.'}
      </p>

      {banner && (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
          {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4 transition-colors"
            >
              Forgot your password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
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
          {errors.password && <p className="text-destructive text-sm">{errors.password.message}</p>}
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          Sign in
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-sm">
        New here?{' '}
        <Link
          // Carried through, so someone who registers instead still lands where
          // they were going.
          to={`/register${redirect === '/' ? '' : `?redirect=${encodeURIComponent(redirect)}`}`}
          className="text-foreground underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </div>
  )
}
