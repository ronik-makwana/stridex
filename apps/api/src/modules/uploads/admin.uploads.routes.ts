import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { validate } from '../../middleware/validate.js'
import { UPLOAD_FOLDERS } from '../../config/minio.js'
import { badRequest } from '../../lib/errors.js'
import * as controller from './admin.uploads.controller.js'

/** Browsers send these for png/jpeg/webp/gif/svg. Nothing else is accepted. */
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/**
 * Memory storage: logos are small, and buffering them avoids a temp file that
 * has to be cleaned up on every error path. Product media in a later phase
 * will want a presigned direct PUT instead, once files get large.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      callback(badRequest(`${file.mimetype} is not an image we accept`, { file: 'Use a PNG, JPEG, WebP, GIF or SVG' }))
      return
    }
    callback(null, true)
  },
})

const folderParamSchema = z.object({
  folder: z.enum(UPLOAD_FOLDERS, 'Not a folder uploads are allowed into'),
})

export const adminUploadsRouter: Router = Router()

adminUploadsRouter.post(
  '/:folder',
  validate({ params: folderParamSchema }),
  upload.single('file'),
  controller.uploadFile,
)
