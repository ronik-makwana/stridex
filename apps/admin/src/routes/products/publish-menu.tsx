import * as React from 'react'
import { Check, ChevronDown, CircleAlert, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { usePublishChecklist } from '@/features/products/queries'
import { usePublishProduct } from '@/features/products/mutations'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

/**
 * The checklist is read before publishing, not after failing to. Four things
 * have to be true — an image, a variant, a price on every variant, no empty
 * attribute rows — and each one is cheaper to see now than to discover from a
 * 422 that lists them all at once.
 *
 * The same server function answers this and enforces the publish, so what is
 * shown here and what is checked there cannot drift.
 */
export function PublishMenu({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const { data, isPending, isFetching } = usePublishChecklist(productId, open)
  const publish = usePublishProduct()

  const run = async () => {
    try {
      await publish.mutateAsync(productId)
      setOpen(false)
    } catch (error) {
      // The 422 carries the failures; the popover is already showing them, so
      // the toast only needs to say the attempt was refused.
      toast.error(error instanceof ApiError ? error.message : 'Could not publish this product')
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button disabled={disabled}>
          <Rocket className="size-4" />
          Publish
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Readiness</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            All four have to pass before this product can go live.
          </p>
        </div>

        <div className="space-y-2.5 px-4 py-3">
          {isPending || !data ? (
            Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)
          ) : (
            data.checks.map((check) => (
              <div key={check.key} className="flex items-start gap-2.5">
                {check.passed ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Passed" />
                ) : (
                  <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-label="Failed" />
                )}
                <div className="min-w-0">
                  <p className="text-sm">{check.label}</p>
                  {check.detail && (
                    <p className="text-muted-foreground mt-0.5 text-xs">{check.detail}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t px-4 py-3">
          <Button
            className="w-full"
            disabled={!data?.ready || publish.isPending || isFetching}
            onClick={() => void run()}
          >
            {publish.isPending && <Spinner />}
            {data?.ready ? 'Publish now' : 'Not ready yet'}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
