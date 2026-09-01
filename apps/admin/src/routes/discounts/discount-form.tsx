import * as React from 'react'
import { useFormContext } from 'react-hook-form'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Discount, DiscountRef } from '@/types/api'
import type { DiscountFormValues } from '@/features/discounts/schemas'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CategoryPicker,
  CollectionPicker,
  CustomerPicker,
  ProductPicker,
} from './resource-picker'

/**
 * The cards down the left of the editor. One card per decision, in the order
 * the operator makes them: what the code is, what it takes off, who may use it,
 * what has to be true first, how often, what it may sit beside, and when.
 *
 * The id lists live outside the form — react-hook-form is holding text inputs,
 * and a picker's staged Save is a different interaction from a field's onChange
 * — so they are passed in and lifted straight back out.
 */

export type Selections = {
  productIds: string[]
  categoryIds: string[]
  collectionIds: string[]
  customerIds: string[]
}

/** Unambiguous characters only: no O/0, no I/1/L. A code gets read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

function Card({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-card space-y-4 rounded-lg border p-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export function DiscountForm({
  selections,
  onSelectionsChange,
  known,
  selectionErrors,
}: {
  selections: Selections
  onSelectionsChange: (next: Selections) => void
  /** Names loaded with the discount, so chips render before any list arrives. */
  known: Pick<Discount, 'products' | 'categories' | 'collections' | 'customers'>
  selectionErrors: Partial<Record<keyof Selections, string>>
}) {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<DiscountFormValues>()

  const type = watch('type')
  const appliesTo = watch('appliesTo')
  const eligibility = watch('eligibility')
  const minRequirement = watch('minRequirement')
  const capEnabled = watch('capEnabled')
  const limitTotal = watch('limitTotal')
  const hasEndDate = watch('hasEndDate')

  const set = (patch: Partial<Selections>) => onSelectionsChange({ ...selections, ...patch })

  return (
    <div className="space-y-4">
      {/* ── the code ────────────────────────────────────────────────────── */}
      <Card title="Amount off products">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="code">Discount code</Label>
            <button
              type="button"
              onClick={() =>
                setValue('code', randomCode(), { shouldDirty: true, shouldValidate: true })
              }
              className="text-primary inline-flex items-center gap-1.5 text-xs hover:underline"
            >
              <RefreshCw className="size-3" />
              Generate random code
            </button>
          </div>
          <Input
            id="code"
            autoComplete="off"
            placeholder="SUMMER20"
            className="font-mono uppercase"
            aria-invalid={Boolean(errors.code)}
            {...register('code')}
          />
          {errors.code ? (
            <p className="text-destructive text-sm">{errors.code.message}</p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Customers must enter this code at checkout. Stored upper-case.
            </p>
          )}
        </div>

      </Card>

      {/* ── the value ───────────────────────────────────────────────────── */}
      <Card title="Discount value">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select
              value={type}
              onValueChange={(next) =>
                setValue('type', next as DiscountFormValues['type'], { shouldDirty: true })
              }
            >
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT">Percentage</SelectItem>
                <SelectItem value="FIXED">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="value">{type === 'PERCENT' ? 'Percentage' : 'Amount'}</Label>
            <div className="relative">
              <Input
                id="value"
                inputMode="decimal"
                placeholder={type === 'PERCENT' ? '20' : '500'}
                className={type === 'PERCENT' ? 'pr-8' : 'pl-7'}
                aria-invalid={Boolean(errors.value)}
                {...register('value')}
              />
              <span
                aria-hidden
                className={cn(
                  'text-muted-foreground pointer-events-none absolute top-1/2 -translate-y-1/2 text-sm',
                  type === 'PERCENT' ? 'right-3.5' : 'left-3.5',
                )}
              >
                {type === 'PERCENT' ? '%' : '₹'}
              </span>
            </div>
            {errors.value && <p className="text-destructive text-sm">{errors.value.message}</p>}
          </div>
        </div>

        {/* A cap only means something on a percentage: a fixed ₹500 off is
            already its own ceiling. */}
        {type === 'PERCENT' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={capEnabled}
                onCheckedChange={(checked) =>
                  setValue('capEnabled', checked === true, { shouldDirty: true })
                }
              />
              Cap the discount at a maximum amount
            </label>
            {capEnabled && (
              <div className="max-w-xs">
                <Input
                  inputMode="decimal"
                  placeholder="500"
                  aria-invalid={Boolean(errors.maxDiscountAmount)}
                  {...register('maxDiscountAmount')}
                />
                {errors.maxDiscountAmount && (
                  <p className="text-destructive mt-1 text-sm">
                    {errors.maxDiscountAmount.message}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="appliesTo">Applies to</Label>
          <Select
            value={appliesTo}
            onValueChange={(next) =>
              setValue('appliesTo', next as DiscountFormValues['appliesTo'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="appliesTo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PRODUCTS">Specific products</SelectItem>
              <SelectItem value="CATEGORIES">Specific categories</SelectItem>
              <SelectItem value="COLLECTIONS">Specific collections</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Only the chosen one is rendered. Two lists on screen would be two
            answers to a question that has one. */}
        {appliesTo === 'PRODUCTS' && (
          <ProductPicker
            value={selections.productIds}
            onChange={(productIds) => set({ productIds })}
            known={known.products}
            error={selectionErrors.productIds}
          />
        )}
        {appliesTo === 'CATEGORIES' && (
          <CategoryPicker
            value={selections.categoryIds}
            onChange={(categoryIds) => set({ categoryIds })}
            known={known.categories}
            error={selectionErrors.categoryIds}
          />
        )}
        {appliesTo === 'COLLECTIONS' && (
          <CollectionPicker
            value={selections.collectionIds}
            onChange={(collectionIds) => set({ collectionIds })}
            known={known.collections}
            error={selectionErrors.collectionIds}
          />
        )}
      </Card>

      {/* ── who ─────────────────────────────────────────────────────────── */}
      <Card title="Eligibility">
        <RadioGroup
          value={eligibility}
          onValueChange={(next) =>
            setValue('eligibility', next as DiscountFormValues['eligibility'], {
              shouldDirty: true,
            })
          }
          className="space-y-1"
        >
          <label className="flex items-center gap-2.5 text-sm">
            <RadioGroupItem value="ALL_CUSTOMERS" id="eligibility-all" />
            All customers
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <RadioGroupItem value="SPECIFIC_CUSTOMERS" id="eligibility-specific" />
            Specific customers
          </label>
        </RadioGroup>

        {eligibility === 'SPECIFIC_CUSTOMERS' && (
          <CustomerPicker
            value={selections.customerIds}
            onChange={(customerIds) => set({ customerIds })}
            known={known.customers}
            error={selectionErrors.customerIds}
          />
        )}
      </Card>

      {/* ── the gate ────────────────────────────────────────────────────── */}
      <Card
        title="Minimum purchase requirements"
        description="Measured against the products this discount applies to, not the whole cart."
      >
        <RadioGroup
          value={minRequirement}
          onValueChange={(next) =>
            setValue('minRequirement', next as DiscountFormValues['minRequirement'], {
              shouldDirty: true,
            })
          }
          className="space-y-1"
        >
          <label className="flex items-center gap-2.5 text-sm">
            <RadioGroupItem value="NONE" id="min-none" />
            No minimum requirements
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <RadioGroupItem value="PURCHASE_AMOUNT" id="min-amount" />
            Minimum purchase amount (₹)
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <RadioGroupItem value="ITEM_QUANTITY" id="min-quantity" />
            Minimum quantity of items
          </label>
        </RadioGroup>

        {minRequirement === 'PURCHASE_AMOUNT' && (
          <div className="max-w-xs">
            <Input
              inputMode="decimal"
              placeholder="2000"
              aria-invalid={Boolean(errors.minCartValue)}
              {...register('minCartValue')}
            />
            {errors.minCartValue && (
              <p className="text-destructive mt-1 text-sm">{errors.minCartValue.message}</p>
            )}
          </div>
        )}
        {minRequirement === 'ITEM_QUANTITY' && (
          <div className="max-w-xs">
            <Input
              inputMode="numeric"
              placeholder="2"
              aria-invalid={Boolean(errors.minQuantity)}
              {...register('minQuantity')}
            />
            {errors.minQuantity && (
              <p className="text-destructive mt-1 text-sm">{errors.minQuantity.message}</p>
            )}
          </div>
        )}
      </Card>

      {/* ── how often ───────────────────────────────────────────────────── */}
      <Card title="Maximum discount uses">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={limitTotal}
            onCheckedChange={(checked) =>
              setValue('limitTotal', checked === true, { shouldDirty: true })
            }
          />
          Limit number of times this discount can be used in total
        </label>
        {limitTotal && (
          <div className="max-w-xs">
            <Input
              inputMode="numeric"
              placeholder="100"
              aria-invalid={Boolean(errors.usageLimit)}
              {...register('usageLimit')}
            />
            {errors.usageLimit && (
              <p className="text-destructive mt-1 text-sm">{errors.usageLimit.message}</p>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={watch('onePerCustomer')}
            onCheckedChange={(checked) =>
              setValue('onePerCustomer', checked === true, { shouldDirty: true })
            }
          />
          Limit to one use per customer
        </label>
      </Card>

      {/* ── combinations ────────────────────────────────────────────────── */}
      <Card
        title="Combinations"
        description="What this discount may sit alongside in the same checkout."
      >
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={watch('combinesWithProduct')}
              onCheckedChange={(checked) =>
                setValue('combinesWithProduct', checked === true, { shouldDirty: true })
              }
            />
            Product discounts
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={watch('combinesWithOrder')}
              onCheckedChange={(checked) =>
                setValue('combinesWithOrder', checked === true, { shouldDirty: true })
              }
            />
            Order discounts
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={watch('combinesWithShipping')}
              onCheckedChange={(checked) =>
                setValue('combinesWithShipping', checked === true, { shouldDirty: true })
              }
            />
            Shipping discounts
          </label>
        </div>
      </Card>

      {/* ── when ────────────────────────────────────────────────────────── */}
      <Card title="Active dates">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="startsAtDate">Start date</Label>
            <Input
              id="startsAtDate"
              type="date"
              aria-invalid={Boolean(errors.startsAtDate)}
              {...register('startsAtDate')}
            />
            {errors.startsAtDate && (
              <p className="text-destructive text-sm">{errors.startsAtDate.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="startsAtTime">Start time</Label>
            <Input id="startsAtTime" type="time" {...register('startsAtTime')} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={hasEndDate}
            onCheckedChange={(checked) =>
              setValue('hasEndDate', checked === true, { shouldDirty: true })
            }
          />
          Set end date
        </label>

        {hasEndDate && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="endsAtDate">End date</Label>
              <Input
                id="endsAtDate"
                type="date"
                aria-invalid={Boolean(errors.endsAtDate)}
                {...register('endsAtDate')}
              />
              {errors.endsAtDate && (
                <p className="text-destructive text-sm">{errors.endsAtDate.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="endsAtTime">End time</Label>
              <Input id="endsAtTime" type="time" {...register('endsAtTime')} />
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

export type { DiscountRef }
