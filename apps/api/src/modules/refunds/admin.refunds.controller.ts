import type { RequestHandler } from 'express'
import { unauthorized } from '../../lib/errors.js'
import { validatedParams, validatedQuery } from '../../middleware/validate.js'
import { listMeta, type UuidParam } from '../../schemas/admin/common.schema.js'
import type {
  ApproveReturnInput,
  CreateRefundInput,
  ReceiveReturnInput,
  RejectReturnInput,
  ReturnListQuery,
} from '../../schemas/admin/refund.schema.js'
import * as returns from './admin.refunds.service.js'

/**
 * Who decided is recorded on every write here, which is why the actor is read
 * from the session rather than taken from the body. A decision nobody can be
 * named for is a decision nobody made.
 */
function actorId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw unauthorized()
  return req.user.id
}

export const list: RequestHandler = async (req, res) => {
  const query = validatedQuery<ReturnListQuery>(req)
  const { data, total } = await returns.findMany(query)
  res.status(200).json({ data, meta: listMeta(total, query.page, query.limit) })
}

export const getOne: RequestHandler = async (req, res) => {
  res.status(200).json({ data: await returns.findById(validatedParams<UuidParam>(req).id) })
}

export const approve: RequestHandler = async (req, res) => {
  const { id } = validatedParams<UuidParam>(req)
  const data = await returns.approve(id, req.body as ApproveReturnInput, actorId(req))
  res.status(200).json({ data })
}

export const reject: RequestHandler = async (req, res) => {
  const { id } = validatedParams<UuidParam>(req)
  const data = await returns.reject(id, req.body as RejectReturnInput, actorId(req))
  res.status(200).json({ data })
}

export const receive: RequestHandler = async (req, res) => {
  const { id } = validatedParams<UuidParam>(req)
  const data = await returns.receive(id, req.body as ReceiveReturnInput, actorId(req))
  res.status(200).json({ data })
}

/**
 * A refund against an order rather than a return. Answers with the whole order,
 * because after it every figure on that screen reads differently.
 */
export const issueRefund: RequestHandler = async (req, res) => {
  const { id } = validatedParams<UuidParam>(req)
  const data = await returns.issueDiscretionary(id, req.body as CreateRefundInput, actorId(req))
  res.status(201).json({ data })
}
