import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { Client } from 'minio'
import { env } from './env.js'
import { logger } from '../lib/logger.js'

/**
 * Object storage for everything operators upload: brand logos now, product
 * media later. One bucket, one folder per entity type.
 *
 *   stridex/brands/<uuid>.png
 *   stridex/products/<uuid>.jpg
 */
export const BUCKET = env.S3_BUCKET

/** The only folders an upload is allowed to land in. */
export const UPLOAD_FOLDERS = ['brands', 'products'] as const
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number]

function parseEndpoint(endpoint: string) {
  const url = new URL(endpoint)
  return {
    endPoint: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    useSSL: url.protocol === 'https:',
  }
}

export const minio: Client = new Client({
  ...parseEndpoint(env.S3_ENDPOINT),
  accessKey: env.S3_ACCESS_KEY,
  secretKey: env.S3_SECRET_KEY,
})

/**
 * Anonymous read on the whole bucket. These are logos and product photos that
 * every storefront visitor loads by `<img src>`; signing each one would mean a
 * round trip per image and URLs that expire out of the database. Writes still
 * require credentials, which only the API holds.
 */
function publicReadPolicy(bucket: string) {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  })
}

let ensured: Promise<void> | null = null

/**
 * Creates the bucket and applies the read policy if they are not already
 * there. Memoised, so concurrent uploads on a cold start do not race to create
 * the same bucket; a failure clears the memo so the next request retries
 * rather than caching a broken state forever.
 */
export function ensureBucket(): Promise<void> {
  ensured ??= (async () => {
    const exists = await minio.bucketExists(BUCKET)
    if (!exists) {
      await minio.makeBucket(BUCKET, env.S3_REGION)
      logger.info({ bucket: BUCKET }, 'created object storage bucket')
    }
    await minio.setBucketPolicy(BUCKET, publicReadPolicy(BUCKET))
  })().catch((error) => {
    ensured = null
    throw error
  })

  return ensured
}

/** Where a browser fetches an object from. */
export function publicUrl(key: string): string {
  return `${env.S3_PUBLIC_URL.replace(/\/+$/, '')}/${BUCKET}/${key}`
}

/**
 * The inverse of `publicUrl`, for cleanup. Returns undefined for anything this
 * bucket does not own — a hand-pasted external URL must never be treated as a
 * deletable object.
 */
export function keyFromUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  const prefix = `${env.S3_PUBLIC_URL.replace(/\/+$/, '')}/${BUCKET}/`
  if (!url.startsWith(prefix)) return undefined
  return url.slice(prefix.length) || undefined
}

export type UploadedObject = { key: string; url: string; size: number }

/**
 * Stores one file and hands back its public URL. The name is a fresh UUID:
 * operator filenames collide, carry spaces and unicode, and leak whatever was
 * on someone's desktop.
 */
export async function uploadObject(
  folder: UploadFolder,
  file: { buffer: Buffer; mimetype: string; originalname: string },
): Promise<UploadedObject> {
  await ensureBucket()

  const extension = extname(file.originalname).toLowerCase().slice(0, 10) || '.bin'
  const key = `${folder}/${randomUUID()}${extension}`

  await minio.putObject(BUCKET, key, file.buffer, file.buffer.length, {
    'Content-Type': file.mimetype,
    // Content is immutable: a new upload gets a new key, so it can be cached
    // forever and a replaced logo is never served stale.
    'Cache-Control': 'public, max-age=31536000, immutable',
  })

  return { key, url: publicUrl(key), size: file.buffer.length }
}

/**
 * Best effort by design. An orphaned object costs storage; a delete that
 * throws would fail the brand update that already succeeded in the database.
 */
export async function removeObjectByUrl(url: string | null | undefined): Promise<void> {
  const key = keyFromUrl(url)
  if (!key) return

  try {
    await minio.removeObject(BUCKET, key)
  } catch (error) {
    logger.warn({ err: error, key }, 'could not remove orphaned object')
  }
}
