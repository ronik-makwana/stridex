import { Heart } from 'lucide-react'
import { toast } from 'sonner'
import { useWishlist } from '@/features/wishlist/use-wishlist'
import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api-client'

/**
 * The heart, on a card and on the product page. Public — saving needs no
 * account, because the wishlist is localStorage until there is one and merges
 * on sign-in.
 *
 * It sits inside a card that is itself a link, so the click has to be stopped
 * from navigating. That is the whole reason this is a component rather than
 * three lines inlined twice.
 */
export function WishlistButton({
  productId,
  title,
  className,
  size = 'default',
}: {
  productId: string
  title?: string
  className?: string
  size?: 'sm' | 'default'
}) {
  const { isSaved, toggle, isMutating } = useWishlist()
  const saved = isSaved(productId)

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title ?? 'this'} from wishlist` : `Save ${title ?? 'this'} to wishlist`}
      disabled={isMutating}
      onClick={async (event) => {
        // The card around it is a <Link>.
        event.preventDefault()
        event.stopPropagation()
        try {
          await toggle(productId)
          if (!saved) toast.success('Saved to wishlist')
        } catch (error) {
          toast.error(error instanceof ApiError ? error.message : 'Could not update your wishlist')
        }
      }}
      className={cn(
        'inline-flex items-center justify-center rounded-full transition-colors disabled:opacity-50',
        size === 'sm' ? 'size-8' : 'size-10',
        className,
      )}
    >
      <Heart
        className={cn(
          size === 'sm' ? 'size-4' : 'size-5',
          // Filled is the accent's other permitted use: a saved heart and a
          // marked-down price are the two things allowed to spend it.
          saved ? 'fill-accent text-accent' : 'text-foreground/70 hover:text-foreground',
        )}
      />
    </button>
  )
}
