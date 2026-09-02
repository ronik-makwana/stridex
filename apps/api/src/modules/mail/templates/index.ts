import { renderTestMail, type TestMailData } from './test.template.js'
import type { RenderedMail } from './layout.js'

/**
 * Every email the system can send, by name.
 *
 * The name is what travels in the job payload, so this map is the contract
 * between whoever enqueues and the worker that renders. Phase 23 adds five
 * entries here and changes nothing else in the pipeline.
 *
 * **Renderers take data, and for anything real that data is ids.** A renderer
 * reads its own rows so the email reflects the database at send time rather
 * than at enqueue time — and so a job payload never carries a price, an
 * address, or anything else that has a canonical home. They are `async` for
 * exactly that reason, even though this first one has nothing to read.
 */
export type Renderer<TData> = (data: TData) => RenderedMail | Promise<RenderedMail>

export const templates = {
  'mail.test': renderTestMail as Renderer<TestMailData>,
} satisfies Record<string, Renderer<never>>

export type TemplateName = keyof typeof templates

export function isTemplateName(value: string): value is TemplateName {
  return value in templates
}

export type { RenderedMail }
