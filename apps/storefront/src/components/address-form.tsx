import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ApiError } from '@/lib/api-client'
import { addressSchema, type AddressValues } from '@/features/addresses/schemas'
import type { Address } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/**
 * One address form, used by the account book and — from 15.8 — by checkout's
 * "Use a new address". Two copies of these seven fields would be two places for
 * the PIN rule to drift, and the one on the checkout page is the one that must
 * not be wrong.
 *
 * It takes a submit handler rather than owning a mutation, because the two
 * callers do different things afterwards: the book closes the form, checkout
 * selects the new address and re-quotes shipping.
 */
export function AddressForm({
  address,
  onSubmit,
  onCancel,
  submitLabel = 'Save address',
  className,
}: {
  /** Present when editing. Absent means a new one. */
  address?: Address
  onSubmit: (values: AddressValues) => Promise<unknown>
  onCancel?: () => void
  submitLabel?: string
  className?: string
}) {
  const form = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      fullName: address?.fullName ?? '',
      phone: address?.phone ?? '',
      addressLine1: address?.addressLine1 ?? '',
      addressLine2: address?.addressLine2 ?? '',
      city: address?.city ?? '',
      state: address?.state ?? '',
      postalCode: address?.postalCode ?? '',
    },
  })

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values)
    } catch (error) {
      // The server validates the same seven fields and names the one it
      // rejected, so its message lands on the input rather than in a banner.
      if (error instanceof ApiError && error.isFieldError) {
        for (const [field, message] of Object.entries(error.fields!)) {
          if (field in values) setError(field as keyof AddressValues, { message })
        }
        return
      }
      setError('root', {
        message: error instanceof ApiError ? error.message : 'Could not save that address',
      })
    }
  })

  const field = (name: keyof AddressValues, label: string, extra?: Record<string, unknown>) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} aria-invalid={Boolean(errors[name])} {...register(name)} {...extra} />
      {errors[name] && <p className="text-destructive text-xs">{errors[name]?.message}</p>}
    </div>
  )

  return (
    <form onSubmit={submit} noValidate className={cn('space-y-4', className)}>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('fullName', 'Full name', { autoComplete: 'name' })}
        {field('phone', 'Phone', { autoComplete: 'tel', inputMode: 'tel', placeholder: '9876543210' })}
      </div>

      {field('addressLine1', 'Address', { autoComplete: 'address-line1' })}
      {field('addressLine2', 'Apartment, floor, landmark (optional)', {
        autoComplete: 'address-line2',
      })}

      <div className="grid gap-4 sm:grid-cols-3">
        {field('city', 'City', { autoComplete: 'address-level2' })}
        {field('state', 'State', { autoComplete: 'address-level1' })}
        {field('postalCode', 'PIN code', { autoComplete: 'postal-code', inputMode: 'numeric' })}
      </div>

      <p className="text-muted-foreground text-xs">We deliver within India only.</p>

      {errors.root && <p className="text-destructive text-sm">{errors.root.message}</p>}

      <div className="flex gap-3 pt-1">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
