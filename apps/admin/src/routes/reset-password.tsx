import * as React from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
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
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const [banner, setBanner] = React.useState<string | null>(null)

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
      toast.success('Password updated. Sign in with your new password.')
      navigate('/login', { replace: true })
    } catch (error) {
      setBanner(error instanceof ApiError ? error.message : 'Something went wrong. Try again.')
    }
  })

  return (
    <div className="bg-muted/40 flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h1 className="font-semibold">Choose a new password</h1>

          {!token ? (
            <>
              <Alert variant="destructive" className="mt-4">
                <AlertCircle />
                <AlertDescription>
                  This link is missing its reset token. Request a new one.
                </AlertDescription>
              </Alert>
              <Button asChild className="mt-4 w-full">
                <Link to="/forgot-password">Request a new link</Link>
              </Button>
            </>
          ) : (
            <>
              {banner && (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle />
                  <AlertDescription>{banner}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    aria-invalid={Boolean(errors.password)}
                    {...register('password')}
                  />
                  {errors.password && (
                    <p className="text-destructive text-sm">{errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(errors.confirmPassword)}
                    {...register('confirmPassword')}
                  />
                  {errors.confirmPassword && (
                    <p className="text-destructive text-sm">{errors.confirmPassword.message}</p>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Spinner />}
                  Update password
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
