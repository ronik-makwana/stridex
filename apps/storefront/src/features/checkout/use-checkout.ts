import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { ApiError } from '@/lib/api-client'
import { cartKeys } from '@/features/cart/use-cart'
import type { CheckoutSession } from '@/types/api'
import { checkoutApi } from './api'

/**
 * The session behind the checkout page.
 *
 * The id lives in the URL — `/checkout?s=…` — and that is what makes a refresh,
 * a back button and a second tab all land on the same session instead of
 * quietly starting a new one and holding the stock twice (§26, §27). The page
 * creates a session only when it arrives without one.
 */

export const checkoutKeys = {
  all: ['checkout'] as const,
  session: (id: string) => [...checkoutKeys.all, id] as const,
}

/** How often to re-read while the provider is deciding. */
const PENDING_POLL_MS = 2_000

export function useCheckoutSession() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const sessionId = params.get('s')
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<ApiError | null>(null)
  /**
   * Set the moment an attempt is made, and never unset.
   *
   * Without it the page would only poll once it had *already read* a
   * PAYMENT_PENDING session — but the read that would tell it that is the one
   * being waited for. The client knows it just paid; the cache does not yet.
   */
  const [attempted, setAttempted] = React.useState(false)

  const query = useQuery({
    queryKey: checkoutKeys.session(sessionId ?? 'none'),
    queryFn: () => checkoutApi.get(sessionId!),
    enabled: Boolean(sessionId),
    /**
     * While a payment is in flight the answer is coming from somewhere else
     * entirely — the provider's webhook — so the page watches the session
     * rather than trusting what the payment sheet said (§10, §12).
     */
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'EXPIRED') return false
      return attempted || status === 'PAYMENT_PENDING' ? PENDING_POLL_MS : false
    },
    // A stale quote is the one thing this page must never show.
    staleTime: 0,
    retry: false,
  })

  // Arrived without a session: make one, and put its id in the URL by replacing
  // the entry, so Back goes to the cart rather than to a bare /checkout that
  // would create a second session.
  React.useEffect(() => {
    if (sessionId || creating) return
    let cancelled = false
    setCreating(true)
    checkoutApi
      .create()
      .then((session) => {
        if (cancelled) return
        queryClient.setQueryData(checkoutKeys.session(session.id), session)
        setParams({ s: session.id }, { replace: true })
      })
      .catch((error: unknown) => {
        if (!cancelled) setCreateError(error instanceof ApiError ? error : null)
      })
      .finally(() => !cancelled && setCreating(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  /**
   * The order took the cart with it — server side, in the same transaction that
   * wrote the order. The badge in the header is reading a cache that predates
   * that, so it is dropped the moment the session says COMPLETED.
   */
  const completed = query.data?.status === 'COMPLETED'
  React.useEffect(() => {
    if (!completed) return
    void queryClient.invalidateQueries({ queryKey: cartKeys.all })
  }, [completed, queryClient])

  const write = (session: CheckoutSession) =>
    queryClient.setQueryData(checkoutKeys.session(session.id), session)

  const setAddress = useMutation({
    mutationFn: ({ shippingAddressId, billingAddressId }: { shippingAddressId: string; billingAddressId?: string }) =>
      checkoutApi.setAddress(sessionId!, shippingAddressId, billingAddressId),
    onSuccess: write,
  })

  const cancel = useMutation({
    mutationFn: () => checkoutApi.cancel(sessionId!),
    onSuccess: () => {
      // The stock is back and the cart still has everything in it.
      void queryClient.invalidateQueries({ queryKey: cartKeys.all })
      void queryClient.invalidateQueries({ queryKey: checkoutKeys.all })
    },
  })

  return {
    sessionId,
    session: query.data,
    /** Called by the page as soon as it has posted a payment. */
    onPaymentAttempted: () => setAttempted(true),
    isAwaitingPayment: attempted && query.data?.status !== 'COMPLETED',
    isLoading: creating || (Boolean(sessionId) && query.isPending),
    /** A 422 from create carries one message per unbuyable line (§16). */
    createError,
    loadError: query.error instanceof ApiError ? query.error : null,
    setAddress: setAddress.mutateAsync,
    isSettingAddress: setAddress.isPending,
    cancel: cancel.mutateAsync,
    refetch: query.refetch,
  }
}

/**
 * Time left, as a countdown. Decoration, and labelled as such everywhere it is
 * used: the server rejects on `expires_at` whatever this says (§2).
 */
export function useCountdown(expiresAt: string | undefined): { text: string; expired: boolean } {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!expiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  if (!expiresAt) return { text: '', expired: false }
  const remaining = new Date(expiresAt).getTime() - now
  if (remaining <= 0) return { text: '0:00', expired: true }

  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1_000)
  return { text: `${minutes}:${String(seconds).padStart(2, '0')}`, expired: false }
}
