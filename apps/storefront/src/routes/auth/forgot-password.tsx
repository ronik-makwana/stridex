import * as React from 'react'
import { usePageMeta } from '@/lib/use-page-meta'
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
  usePageMeta({ title: 'Reset your password' })

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
      // Success regardless of whether the account exists — the API returns the
      // same 202 either way, and showing anything else here would rebuild the
      // account-existence oracle that response shape exists to close.
      setSent(true)
    } catch (error) {
      setBanner(error instanceof ApiError ? error.message : 'Something went wrong. Try again.')
    }
  })

  return (
    <div>
      {sent ? (
        <div className="text-center">
          <MailCheck className="text-muted-foreground mx-auto size-8" />
          <h1 className="mt-4 text-xl">Check your inbox</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            If that email has an account, a reset link is on its way. The link expires in one hour.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-xl">Reset your password</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            We will email you a link to set a new one.
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
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Spinner />}
              Send reset link
            </Button>
          </form>
        </>
      )}

      <div className="mt-6 text-center">
        <Link
          to="/login"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm underline underline-offset-4 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
