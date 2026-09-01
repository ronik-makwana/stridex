import type { RequestHandler } from 'express'
import { validatedQuery } from '../../middleware/validate.js'
import { serializeAdminTag } from '../../serializers/admin/tag.serializer.js'
import type { TagListQuery } from '../../schemas/admin/tag.schema.js'
import * as tagService from './tags.service.js'

/** No `meta`: this is a suggestion list, not a paginated screen. */
export const list: RequestHandler = async (req, res) => {
  const tags = await tagService.findMany(validatedQuery<TagListQuery>(req))
  res.status(200).json({ data: tags.map(serializeAdminTag) })
}
