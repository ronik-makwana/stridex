import * as React from 'react'
import { usePageMeta } from '@/lib/use-page-meta'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { authApi } from '@/features/auth/api'
import { ApiError } from '@/lib/api-client'
import { resetPasswordSchema, type ResetPasswordValues } from '@/features/auth/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

export default function ResetPasswordPage() {
  usePageMeta({ title: 'Set a new password' })

  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [banner, setBanner] = React.useState<string | null>(null)
  const [showPassword, setShowPassword] = React.useState(false)

  const token = params.get('token') ?? ''

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null)
    try {
      await authApi.resetPassword({ token, password: values.password })
      // The API revoked every session for this account, including any this
      // browser held, so the only correct next screen is a fresh sign-in.
      toast.success('Password updated', { description: 'Sign in with your new password.' })
      void navigate('/login', { replace: true })
    } catch (error) {
      setBanner(error instanceof ApiError ? error.message : 'Something went wrong. Try again.')
    }
  })

  // A link with no token cannot be salvaged by submitting the form, so it does
  // not offer one.
  if (!token) {
    return (
      <div>
        <h1 className="text-xl">This link is incomplete</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Reset links expire after an hour and can only be used once. Request a new one.
        </p>
        <Button asChild size="lg" className="mt-6 w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl">Set a new password</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        You will be signed out everywhere else.
      </p>

      {banner && (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
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
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="text-destructive text-sm">{errors.confirmPassword.message}</p>
          )}
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          Update password
        </Button>
      </form>
    </div>
  )
}
