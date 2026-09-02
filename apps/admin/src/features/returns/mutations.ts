import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Order, RefundReason, ReturnRequest } from '@/types/api'
import { orderKeys } from '@/features/orders/queries'
import { returnsApi } from './api'
import { returnKeys } from './queries'

/**
 * Every decision moves the row between the queue's filtered lists — "waiting on
 * us" loses it, "waiting on a parcel" gains it — so the lists are invalidated
 * rather than patched, and the fresh record is written straight into the detail
 * cache so the screen does not flicker through a loading state it already has
 * the answer for.
 *
 * Orders are invalidated too: receiving a return issues a refund, and the order
 * screen's `refundableAmount` and payment status both move because of it.
 */
function useSettleReturn() {
  const queryClient = useQueryClient()
  return (request: ReturnRequest) => {
    queryClient.setQueryData(returnKeys.detail(request.id), request)
    void queryClient.invalidateQueries({ queryKey: returnKeys.lists() })
    void queryClient.invalidateQueries({ queryKey: orderKeys.all })
  }
}

export function useApproveReturn() {
  const settle = useSettleReturn()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string | null }) => returnsApi.approve(id, note),
    onSuccess: settle,
  })
}

export function useRejectReturn() {
  const settle = useSettleReturn()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => returnsApi.reject(id, note),
    onSuccess: settle,
  })
}

export function useReceiveReturn() {
  const settle = useSettleReturn()
  return useMutation({
    mutationFn: ({
      id,
      items,
      note,
    }: {
      id: string
      items: { requestItemId: string; restockQuantity: number; unsellableQuantity: number }[]
      note: string | null
    }) => returnsApi.receive(id, { items, note }),
    onSuccess: settle,
  })
}

/** A discretionary refund. Touches orders only — it opens no return. */
export function useRefundOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      orderId,
      ...body
    }: {
      orderId: string
      amount: string
      reason: RefundReason
      note: string
    }) => returnsApi.refundOrder(orderId, body),
    onSuccess: (order: Order) => {
      queryClient.setQueryData(orderKeys.detail(order.id), order)
      void queryClient.invalidateQueries({ queryKey: orderKeys.lists() })
    },
  })
}
