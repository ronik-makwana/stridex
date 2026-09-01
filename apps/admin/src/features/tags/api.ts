import { get } from '@/lib/api-client'
import type { Tag } from '@/types/api'

export const tagsApi = {
  /**
   * The suggestion list behind the tag input. Read-only: a tag is created by
   * naming it on a product and deleted when the last product drops it, so
   * there is nothing else here to call.
   */
  list: () => get<Tag[]>('/tags'),
}
