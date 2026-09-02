import * as React from 'react'
import { usePageMeta } from '@/lib/use-page-meta'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { MailWarning } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api-client'
import { accountApi } from '@/features/account/api'
import { authApi } from '@/features/auth/api'
import { formatDate } from '@/lib/format'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

/**
 * Two cards, as the spec has it: who you are, and how you sign in. Kept apart
 * because they fail differently — a rejected email is a form error, a wrong
 * password is a failed authentication — and one form with both would have to
 * explain both at once.
 */

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().max(80).optional(),
  email: z.email('Enter a valid email address').trim(),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
    .optional()
    .or(z.literal('')),
})

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'Use at least 8 characters').max(128),
  })
  .refine((values) => values.currentPassword !== values.newPassword, {
    path: ['newPassword'],
    message: 'This is the password you already have',
  })

type ProfileValues = z.infer<typeof profileSchema>
type PasswordValues = z.infer<typeof passwordSchema>

export default function ProfilePage() {
  const { user, reloadUser } = useAuth()

  usePageMeta({ title: 'Profile' })

  if (!user) return null

  return (
    <div className="space-y-8">
      <h1 className="text-xl sm:text-2xl">Profile</h1>

      {!user.emailVerified && <VerifyNotice email={user.email} />}

      <ProfileCard user={user} onSaved={reloadUser} />
      <PasswordCard />

      <p className="text-muted-foreground text-xs">
        Member since {formatDate(user.createdAt)}
      </p>
    </div>
  )
}

function VerifyNotice({ email }: { email: string }) {
  const [sending, setSending] = React.useState(false)
  return (
    <Alert>
      <MailWarning />
      <AlertTitle>Verify your email</AlertTitle>
      <AlertDescription>
        <p className="text-muted-foreground">
          We sent a link to {email}. Order updates go to a verified address.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={sending}
          onClick={async () => {
            setSending(true)
            try {
              await authApi.resendVerification({ email })
              toast.success('Verification link sent')
            } finally {
              setSending(false)
            }
          }}
        >
          {sending ? 'Sending…' : 'Resend the link'}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function ProfileCard({
  user,
  onSaved,
}: {
  user: { firstName: string | null; lastName: string | null; email: string; phone: string | null }
  onSaved: () => Promise<void>
}) {
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      email: user.email,
      phone: user.phone ?? '',
    },
  })
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form

  const submit = handleSubmit(async (values) => {
    try {
      const saved = await accountApi.update({
        firstName: values.firstName,
        lastName: values.lastName || null,
        phone: values.phone || null,
        ...(values.email !== user.email ? { email: values.email } : {}),
      })
      await onSaved()
      form.reset(values)
      toast.success(
        saved.verificationEmailSent
          ? 'Saved. Check your new inbox for a verification link.'
          : 'Saved',
      )
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in values) setError(field as keyof ProfileValues, { message })
        }
        return
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not save that')
    }
  })

  return (
    <section className="border p-5">
      <h2 className="text-xs tracking-[0.14em] uppercase">Your details</h2>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={errors.firstName?.message}>
            <Input id="firstName" autoComplete="given-name" {...register('firstName')} />
          </Field>
          <Field label="Last name" error={errors.lastName?.message}>
            <Input id="lastName" autoComplete="family-name" {...register('lastName')} />
          </Field>
        </div>
        <Field
          label="Email"
          error={errors.email?.message}
          hint="Changing this sends a new verification link."
        >
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Mobile" error={errors.phone?.message}>
          <Input id="phone" inputMode="tel" autoComplete="tel" {...register('phone')} />
        </Field>

        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting && <Spinner />}
          Save changes
        </Button>
      </form>
    </section>
  )
}

function PasswordCard() {
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  })
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = form

  const submit = handleSubmit(async (values) => {
    try {
      await accountApi.changePassword(values.currentPassword, values.newPassword)
      reset()
      // Said plainly, because it is the surprising part: everywhere else this
      // account was signed in has just been signed out.
      toast.success('Password changed', {
        description: 'Your other devices have been signed out.',
      })
    } catch (error) {
      if (error instanceof ApiError && error.isFieldError) {
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in values) setError(field as keyof PasswordValues, { message })
        }
        return
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not change your password')
    }
  })

  return (
    <section className="border p-5">
      <h2 className="text-xs tracking-[0.14em] uppercase">Password</h2>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <Field label="Current password" error={errors.currentPassword?.message}>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            {...register('currentPassword')}
          />
        </Field>
        <Field
          label="New password"
          error={errors.newPassword?.message}
          hint="At least 8 characters. Signs out your other devices."
        >
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            {...register('newPassword')}
          />
        </Field>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          Change password
        </Button>
      </form>
    </section>
  )
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  )
}
