import type { RequestHandler } from 'express'
import { validatedParams } from '../../middleware/validate.js'
import { badRequest } from '../../lib/errors.js'
import { uploadObject, type UploadFolder } from '../../config/minio.js'

export const uploadFile: RequestHandler = async (req, res) => {
  const { folder } = validatedParams<{ folder: UploadFolder }>(req)
  const file = req.file

  if (!file) throw badRequest('No file was uploaded', { file: 'Choose an image' })

  const uploaded = await uploadObject(folder, file)
  res.status(201).json({ data: uploaded })
}
