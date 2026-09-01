import * as React from 'react'
import { cn } from '@/lib/utils'
import type { Address } from '@/types/api'

/**
 * How an address reads everywhere it appears — the book, and the radio cards on
 * checkout. Only the chrome differs between those two, which is why the lines
 * themselves live here.
 */
export function AddressLines({ address }: { address: Address }) {
  return (
    <div className="text-sm leading-relaxed">
      <p>{address.fullName}</p>
      <p className="text-muted-foreground">{address.addressLine1}</p>
      {address.addressLine2 && <p className="text-muted-foreground">{address.addressLine2}</p>}
      <p className="text-muted-foreground">
        {address.city}, {address.state}
      </p>
      <p className="text-muted-foreground tabular-nums">{address.postalCode}</p>
      <p className="text-muted-foreground mt-1 tabular-nums">{address.phone}</p>
    </div>
  )
}

/**
 * The same address on one line, for the places that are listing addresses to
 * choose between rather than displaying the chosen one — a menu row is a
 * comparison, and five stacked lines each is a wall.
 */
export function addressSummary(address: Address): string {
  return [address.addressLine1, address.addressLine2, address.city, address.state, address.postalCode]
    .filter(Boolean)
    .join(', ')
}

export function AddressCard({
  address,
  actions,
  className,
}: {
  address: Address
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col border p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs tracking-[0.14em] uppercase">
          {address.isDefault ? 'Default' : 'Address'}
        </p>
      </div>

      <div className="mt-3 flex-1">
        <AddressLines address={address} />
      </div>

      {actions && <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">{actions}</div>}
    </div>
  )
}
