import { z } from 'zod'

/**
 * The window every dashboard read shares. Defaults to the last 30 days, which
 * is what the header control opens on — a dashboard that needs configuring
 * before it says anything is a dashboard nobody opens twice.
 */
export const dashboardRangeSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})

export const salesQuerySchema = dashboardRangeSchema.extend({
  interval: z.enum(['day', 'week']).default('day'),
})

export const adminSearchSchema = z.object({
  q: z.string().trim().min(2, 'Type at least two characters').max(80),
})

export type DashboardRange = z.infer<typeof dashboardRangeSchema>
export type SalesQuery = z.infer<typeof salesQuerySchema>
export type AdminSearchQuery = z.infer<typeof adminSearchSchema>

/** Resolves the window once, so every card on the page covers the same dates. */
export function resolveRange(range: DashboardRange): { from: Date; to: Date } {
  const to = range.to ? new Date(`${range.to}T23:59:59.999Z`) : new Date()
  const from = range.from
    ? new Date(`${range.from}T00:00:00.000Z`)
    : new Date(to.getTime() - 30 * 24 * 60 * 60_000)
  return { from, to }
}
