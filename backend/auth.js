import { Buffer } from 'node:buffer'
import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import process from 'node:process'
import { insertUserRecord, readUserRecords } from './database.js'

const scryptAsync = promisify(scrypt)
const tokenLifetimeSeconds = 2 * 60 * 60
let userStoreQueue = Promise.resolve()

export class AuthError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export class TokenValidationError extends Error {}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters.')
  }
  return secret
}

export function assertAuthConfiguration() {
  getJwtSecret()
}

function withUserStoreLock(operation) {
  const result = userStoreQueue.then(operation, operation)
  userStoreQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const readUsers = readUserRecords

async function derivePasswordHash(password, salt) {
  return scryptAsync(password, salt, 64)
}

export async function registerUser(name, email, password) {
  return withUserStoreLock(async () => {
    const users = await readUsers()
    if (users.some((user) => user.email === email)) {
      throw new AuthError(409, 'An account with this email already exists.')
    }

    const salt = randomBytes(16)
    const passwordHash = await derivePasswordHash(password, salt)
    const user = {
      id: randomUUID(),
      name,
      email,
      passwordSalt: salt.toString('hex'),
      passwordHash: passwordHash.toString('hex'),
      createdAt: new Date().toISOString(),
    }

    users.push(user)
    await insertUserRecord(user)
    return { id: user.id, name: user.name, email: user.email }
  })
}

export async function authenticateUser(email, password) {
  return withUserStoreLock(async () => {
    const users = await readUsers()
    const user = users.find((entry) => entry.email === email)
    const salt = user ? Buffer.from(user.passwordSalt, 'hex') : Buffer.alloc(16)
    const expectedHash = user
      ? Buffer.from(user.passwordHash, 'hex')
      : Buffer.alloc(64)

    if (salt.length !== 16 || expectedHash.length !== 64) {
      throw new Error('The stored account credentials are invalid.')
    }

    const passwordHash = await derivePasswordHash(password, salt)
    if (!timingSafeEqual(passwordHash, expectedHash) || !user) {
      return null
    }

    return { id: user.id, name: user.name, email: user.email }
  })
}

export function createAccessToken(user) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  )
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      name: user.name,
      email: user.email,
      iss: 'anti-paper-leak',
      aud: 'question-paper-api',
      iat: now,
      exp: now + tokenLifetimeSeconds,
    }),
  ).toString('base64url')
  const unsignedToken = `${header}.${payload}`
  const signature = createHmac('sha256', getJwtSecret())
    .update(unsignedToken)
    .digest('base64url')

  return `${unsignedToken}.${signature}`
}

export function verifyAccessToken(token) {
  const secret = getJwtSecret()
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new TokenValidationError('Invalid access token.')
  }

  let header
  let payload
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new TokenValidationError('Invalid access token.')
  }

  if (
    !header ||
    typeof header !== 'object' ||
    header.alg !== 'HS256' ||
    header.typ !== 'JWT' ||
    !payload ||
    typeof payload !== 'object'
  ) {
    throw new TokenValidationError('Invalid access token.')
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest()
  const receivedSignature = Buffer.from(parts[2], 'base64url')
  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new TokenValidationError('Invalid access token.')
  }

  const now = Math.floor(Date.now() / 1000)
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.name !== 'string' ||
    typeof payload.email !== 'string' ||
    payload.iss !== 'anti-paper-leak' ||
    payload.aud !== 'question-paper-api' ||
    typeof payload.exp !== 'number' ||
    payload.exp <= now
  ) {
    throw new TokenValidationError('Invalid or expired access token.')
  }

  return { id: payload.sub, name: payload.name, email: payload.email }
}
