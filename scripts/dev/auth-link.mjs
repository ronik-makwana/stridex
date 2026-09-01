#!/usr/bin/env node
/*
 * Dev-only. Mints an email-verification or password-reset link for a local
 * account and prints the URL.
 *
 * Why this exists: there is no mailer yet, so the API logs the raw token once
 * to stdout and stores only its SHA-256. Miss that log line and the link is
 * unrecoverable — which is a bad way to spend five minutes every time you test
 * a signup. This writes a fresh token straight to the database, exactly the way
 * `issueEmailVerificationToken` does, and hands you the link.
 *
 *   node scripts/dev/auth-link.mjs verify <email>
 *   node scripts/dev/auth-link.mjs reset  <email>
 *
 * Delete this the day a mailer lands. It is a convenience, not a feature, and
 * it must never ship anywhere but a developer's laptop.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const [kind, email] = process.argv.slice(2)
const SHOP_URL = process.env.SHOP_URL ?? 'http://localhost:5174'

if (!['verify', 'reset'].includes(kind) || !email) {
  console.error('usage: node scripts/dev/auth-link.mjs <verify|reset> <email>')
  process.exit(1)
}

const psql = (sql) =>
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'shoe', '-t', '-A', '-c', sql],
    { encoding: 'utf8', cwd: new URL('../../', import.meta.url).pathname },
  ).trim()

const escape = (value) => `'${String(value).replace(/'/g, "''")}'`

const userId = psql(`SELECT id FROM users WHERE email = ${escape(email.toLowerCase())};`)
if (!userId) {
  console.error(`No account for ${email}. Register at ${SHOP_URL}/register first.`)
  process.exit(1)
}

// Same shape as the service: 48 random bytes, hex, stored as SHA-256 only.
const token = crypto.randomBytes(48).toString('hex')
const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

if (kind === 'verify') {
  const already = psql(`SELECT email_verified_at IS NOT NULL FROM users WHERE id = ${escape(userId)};`)
  if (already === 't') {
    console.log(`${email} is already verified — nothing to do.`)
    process.exit(0)
  }
  // Supersede outstanding tokens first, so "resend" never leaves two live links.
  psql(`UPDATE email_verification_tokens SET used_at = now() WHERE user_id = ${escape(userId)} AND used_at IS NULL;`)
  psql(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES (${escape(userId)}, ${escape(tokenHash)}, now() + interval '24 hours');`,
  )
  console.log(`\n  ${SHOP_URL}/verify-email?token=${token}\n\n  Expires in 24 hours.`)
} else {
  psql(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = ${escape(userId)} AND used_at IS NULL;`)
  psql(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES (${escape(userId)}, ${escape(tokenHash)}, now() + interval '1 hour');`,
  )
  console.log(`\n  ${SHOP_URL}/reset-password?token=${token}\n\n  Expires in 1 hour.`)
}
