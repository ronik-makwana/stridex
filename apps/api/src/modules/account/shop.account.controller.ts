import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { serializeShopUser } from '../../serializers/shop/user.serializer.js'
import type {
  ChangePasswordInput,
  UpdateAccountInput,
} from '../../schemas/shop/account.schema.js'
import * as account from './account.service.js'

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw unauthorized()
  const { user, verificationEmailSent } = await account.update(
    req.user.id,
    req.body as UpdateAccountInput,
  )
  res.status(200).json({ data: { ...serializeShopUser(user), verificationEmailSent } })
}

/** 204: there is nothing to hand back, and the session in use still works. */
export const changePassword: RequestHandler = async (req, res) => {
  if (!req.user) throw unauthorized()
  await account.changePassword(req.user.id, req.user.sessionId, req.body as ChangePasswordInput)
  res.status(204).end()
}
