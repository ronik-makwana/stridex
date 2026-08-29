import { api } from '@/lib/api-client'

/** Folders the API will accept an upload into. Mirrors `UPLOAD_FOLDERS`. */
export type UploadFolder = 'brands' | 'products' | 'collections'

export type UploadedObject = { key: string; url: string; size: number }

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]

export const uploadsApi = {
  /**
   * Posts one image and returns its public URL. `Content-Type` is deliberately
   * unset so the browser writes the multipart boundary itself — axios' JSON
   * default would produce a body the server cannot parse.
   */
  upload: async (folder: UploadFolder, file: File): Promise<UploadedObject> => {
    const body = new FormData()
    body.append('file', file)

    const response = await api.post<{ data: UploadedObject }>(`/uploads/${folder}`, body, {
      headers: { 'Content-Type': undefined },
    })
    return response.data.data
  },
}
