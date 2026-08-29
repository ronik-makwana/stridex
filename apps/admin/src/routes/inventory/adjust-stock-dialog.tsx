import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useAdjustReasons } from '@/features/inventory/queries'
import { useAdjustStock } from '@/features/inventory/mutations'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Spinner } from '@/components/ui/spinner'

/** The minimum any screen needs to hand over to adjust a SKU. */
export type StockTarget = {
  variantId: string
  sku: string
  quantity: number
  reserved: number
}

/**
 * The one screen where a slip costs real money, so it is built around a single
 * idea: never let anyone press the button without seeing the number they are
 * about to write.
 *
 * "Set to" and "Change by" are the classic mix-up — typing 3 meaning "three
 * fewer" and ending up with three on hand — and no amount of labelling fixes it
 * as reliably as showing the result. Hence the live "new on hand" line, which
 * updates on every keystroke and turns red before the request is ever sent.
 */
export function AdjustStockDialog({
  target,
  onOpenChange,
}: {
  target: StockTarget | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: reasons } = useAdjustReasons()
  const adjust = useAdjustStock()

  const [mode, setMode] = React.useState<'set' | 'change'>('change')
  const [value, setValue] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!target) return
    setMode('change')
    setValue('')
    setReason('')
    setNote('')
    setError(null)
  }, [target])

  const onHand = target?.quantity ?? 0
  const reserved = target?.reserved ?? 0

  const parsed = value.trim() === '' || value.trim() === '-' ? null : Number(value)
  const isNumber = parsed !== null && Number.isFinite(parsed) && Number.isInteger(parsed)
  const nextOnHand = isNumber ? (mode === 'set' ? parsed : onHand + parsed) : null

  // The same two guards the server enforces, checked here so they are visible
  // while typing rather than delivered as a rejection afterwards.
  const belowZero = nextOnHand !== null && nextOnHand < 0
  const belowReserved = nextOnHand !== null && nextOnHand >= 0 && nextOnHand < reserved
  const noChange = nextOnHand !== null && nextOnHand === onHand

  const blocked = !isNumber || belowZero || belowReserved || noChange || !reason

  const submit = async () => {
    if (!target || !isNumber) return
    setError(null)
    try {
      await adjust.mutateAsync({
        variantId: target.variantId,
        values: { mode, value: parsed, reason, note: note.trim() || null },
      })
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.reason ?? err.message)
          : 'Could not adjust the stock. Try again.',
      )
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => !adjust.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{target?.sku}</span> · currently {onHand} on hand
            {reserved > 0 && `, ${reserved} reserved`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Change</Label>
            <RadioGroup
              value={mode}
              onValueChange={(next) => setMode(next as 'set' | 'change')}
              className="flex items-center gap-5"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="change" id="mode-change" />
                <Label htmlFor="mode-change" className="text-sm font-normal">
                  Change by
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="set" id="mode-set" />
                <Label htmlFor="mode-set" className="text-sm font-normal">
                  Set to
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-value">
              {mode === 'set' ? 'New quantity' : 'Units to add or remove'}
            </Label>
            <Input
              id="adjust-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              inputMode="numeric"
              placeholder={mode === 'set' ? String(onHand) : '-3'}
              autoFocus
              className="tabular-nums"
            />

            {/* The line that stops the mistake. */}
            <p
              className={cn(
                'text-sm',
                belowZero || belowReserved
                  ? 'text-destructive font-medium'
                  : 'text-muted-foreground',
              )}
              aria-live="polite"
            >
              {nextOnHand === null
                ? mode === 'change'
                  ? 'Negative numbers remove stock.'
                  : ' '
                : belowZero
                  ? `New on hand: ${nextOnHand} — stock cannot go below zero`
                  : belowReserved
                    ? `New on hand: ${nextOnHand} — fewer than the ${reserved} units pending orders are holding`
                    : noChange
                      ? `New on hand: ${nextOnHand} — that is what it already is`
                      : `New on hand: ${nextOnHand}`}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="adjust-reason" className="w-full">
                <SelectValue placeholder="Why is this changing?" />
              </SelectTrigger>
              <SelectContent>
                {(reasons ?? []).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Required, not optional. A ledger of unexplained numbers is a
                ledger nobody can reconcile six months later. */}
            <p className="text-muted-foreground text-xs">
              Recorded against this entry in the ledger, with your name.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-note">Note</Label>
            <Input
              id="adjust-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional — a PO, a shelf, what happened"
              maxLength={500}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={blocked || adjust.isPending}>
            {adjust.isPending && <Spinner />}
            Adjust stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
