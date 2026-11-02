import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { TextDecoder } from 'node:util'
import process from 'node:process'

export const encryptedQuestionPrefix = 'enc:v1:'

export class QuestionDecryptionError extends Error {}

function getEncryptionKey(value = process.env.QUESTION_ENCRYPTION_KEY) {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(
      'QUESTION_ENCRYPTION_KEY must be set to a 64-character hexadecimal key.',
    )
  }
  return Buffer.from(value, 'hex')
}

function decodePayload(value) {
  const normalizedValue = value.replace(/\s/g, '')
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedValue) ||
    normalizedValue.length % 4 === 1
  ) {
    return null
  }

  const decoded = Buffer.from(normalizedValue, 'base64')
  if (
    decoded.toString('base64').replace(/=+$/, '') !==
    normalizedValue.replace(/=+$/, '')
  ) {
    return null
  }
  return decoded
}

function decodeLegacyQuestion(value) {
  const payload = decodePayload(value.slice(encryptedQuestionPrefix.length))
  if (!payload?.length) {
    return null
  }

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(payload)
  } catch {
    return null
  }

  const containsControlCharacter = Array.from(text).some((character) => {
    const code = character.codePointAt(0)
    return (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    )
  })
  if (!/\p{L}/u.test(text) || containsControlCharacter) {
    return null
  }
  return text
}

export function encryptQuestion(question, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(key), iv)
  const ciphertext = Buffer.concat([
    cipher.update(question, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, tag, ciphertext]).toString('base64')
  return `${encryptedQuestionPrefix}${payload}`
}

export function decryptQuestion(question, key) {
  if (
    typeof question !== 'string' ||
    !question.startsWith(encryptedQuestionPrefix)
  ) {
    throw new QuestionDecryptionError(
      'The paper contains a question that is not encrypted.',
    )
  }

  const encryptionKey = getEncryptionKey(key)
  const encrypted = decodePayload(
    question.slice(encryptedQuestionPrefix.length),
  )
  if (!encrypted) {
    throw new QuestionDecryptionError(
      'The encrypted question payload is invalid.',
    )
  }

  const legacyQuestion = decodeLegacyQuestion(question)
  if (legacyQuestion !== null) {
    return legacyQuestion
  }
  if (encrypted.length < 28) {
    throw new QuestionDecryptionError(
      'The encrypted question payload is invalid.',
    )
  }

  const iv = encrypted.subarray(0, 12)
  const tag = encrypted.subarray(12, 28)
  const ciphertext = encrypted.subarray(28)
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new QuestionDecryptionError(
      'The paper could not be decrypted. The encryption key may not match the key used to encrypt it, or the data may be damaged.',
    )
  }
}

export function normalizeEncryptedQuestion(question, key) {
  if (
    typeof question === 'string' &&
    question.startsWith(encryptedQuestionPrefix)
  ) {
    const legacyQuestion = decodeLegacyQuestion(question)
    if (legacyQuestion === null) {
      decryptQuestion(question, key)
      return question
    }

    return encryptQuestion(legacyQuestion, key)
  }
  return encryptQuestion(question, key)
}
