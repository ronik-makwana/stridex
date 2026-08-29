import * as React from 'react'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, ArrowLeft, MailCheck } from 'lucide-react'
import { authApi } from '@/features/auth/api'
import { ApiError } from '@/lib/api-client'
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/features/auth/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

export default function ForgotPasswordPage() {
  const [sent, setSent] = React.useState(false)
  const [banner, setBanner] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null)
    try {
      await authApi.forgotPassword(values)
      // Success regardless of whether the account exists — same as the API.
      setSent(true)
    } catch (error) {
      setBanner(error instanceof ApiError ? error.message : 'Something went wrong. Try again.')
    }
  })

  return (
    <div className="bg-muted/40 flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          {sent ? (
            <div className="text-center">
              <MailCheck className="text-muted-foreground mx-auto mb-3 size-8" />
              <h1 className="font-semibold">Check your inbox</h1>
              <p className="text-muted-foreground mt-2 text-sm">
                If that email has an admin account, a reset link is on its way. The link expires in
                one hour.
              </p>
            </div>
          ) : (
            <>
              <h1 className="font-semibold">Reset your password</h1>
              <p className="text-muted-foreground mt-1 mb-4 text-sm">
                We will email you a link to set a new one.
              </p>

              {banner && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle />
                  <AlertDescription>{banner}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={onSubmit} noValidate className="space-y-4">
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
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Spinner />}
                  Send reset link
                </Button>
              </form>
            </>
          )}

          <div className="mt-4 text-center">
            <Link
              to="/login"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              <ArrowLeft className="size-3.5" />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
