import type * as React from 'react'
import { Toaster as Sonner } from 'sonner'

export function Toaster(props: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      className="toaster group"
      // Bottom-centre on a storefront: the top-right corner is where the cart
      // badge lives, and a toast that covers it hides the thing it is
      // confirming.
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: 'group toast bg-popover text-popover-foreground border rounded-md shadow-lg',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-secondary text-secondary-foreground',
        },
      }}
      {...props}
    />
  )
}
