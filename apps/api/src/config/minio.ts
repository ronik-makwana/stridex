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

// ─── direct browser uploads ──────────────────────────────────────────────────
//
// Product media is where `uploadObject` stops being the right tool. A gallery
// is four to eight files of several megabytes each, and routing those through
// Node means the API holds every byte in memory, ties up an event loop that has
// requests to serve, and doubles the bandwidth bill for no gain. The browser
// PUTs straight to storage instead; the API only signs the URL and records the
// row afterwards.

/**
 * Long enough for a slow phone on hotel wifi to finish a 20MB video, short
 * enough that a signature copied out of devtools is worthless by the time
 * anyone tries it.
 */
const PRESIGN_TTL_SECONDS = 15 * 60

/** Fallbacks for a filename with no usable extension — a paste, or a camera blob. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
}

export type PresignedUpload = { uploadUrl: string; key: string; url: string }

/**
 * Hands back a URL the browser can PUT one object to, plus the key and the
 * public URL the object will live at. The key is a fresh UUID for the same
 * reason `uploadObject` uses one: operator filenames collide, carry spaces and
 * unicode, and leak whatever was on someone's desktop.
 *
 * Nothing is recorded here. An abandoned upload leaves an object with no row,
 * which costs storage and nothing else; a row with no object would be a broken
 * image in the gallery, which is why the record step verifies first.
 */
export async function presignUpload(
  folder: UploadFolder,
  filename: string,
  contentType: string,
): Promise<PresignedUpload> {
  await ensureBucket()

  const extension =
    extname(filename).toLowerCase().slice(0, 10) || EXTENSION_BY_TYPE[contentType] || '.bin'
  const key = `${folder}/${randomUUID()}${extension}`

  const uploadUrl = await minio.presignedPutObject(BUCKET, key, PRESIGN_TTL_SECONDS)
  return { uploadUrl, key, url: publicUrl(key) }
}

export type ObjectStat = { size: number; contentType: string | undefined }

/**
 * What the browser actually stored, or null if it never got there. The media
 * record step calls this before writing a row, so a PUT that failed, was
 * cancelled, or was never made cannot become a broken <img> nobody can explain.
 */
export async function statObject(key: string): Promise<ObjectStat | null> {
  try {
    const stat = await minio.statObject(BUCKET, key)
    return { size: stat.size, contentType: stat.metaData?.['content-type'] }
  } catch {
    return null
  }
}

/** Best effort, like `removeObjectByUrl` — see the note there. */
export async function removeObjectByKey(key: string | null | undefined): Promise<void> {
  if (!key) return
  try {
    await minio.removeObject(BUCKET, key)
  } catch (error) {
    logger.warn({ err: error, key }, 'could not remove orphaned object')
  }
}

/**
 * Server-side copy of one stored object into a fresh key. Used when a product
 * is duplicated: pointing both products at the same key would mean deleting an
 * image from the copy silently breaks the original, and a copy that shares
 * nothing is worth the storage.
 *
 * The bytes never travel through Node — `copyObject` is a single call the
 * storage service performs internally. Returns null for anything this bucket
 * does not own, so the caller falls back to reusing the URL as-is.
 */
export async function copyObjectByUrl(
  url: string | null | undefined,
  folder: UploadFolder,
): Promise<string | null> {
  const sourceKey = keyFromUrl(url)
  if (!sourceKey) return null

  const extension = extname(sourceKey).toLowerCase().slice(0, 10) || '.bin'
  const key = `${folder}/${randomUUID()}${extension}`

  try {
    await minio.copyObject(BUCKET, key, `/${BUCKET}/${sourceKey}`)
    return publicUrl(key)
  } catch (error) {
    logger.warn({ err: error, sourceKey }, 'could not copy stored object')
    return null
  }
}
