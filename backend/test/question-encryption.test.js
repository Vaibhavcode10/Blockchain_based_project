import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import {
  decryptQuestion,
  encryptQuestion,
  encryptedQuestionPrefix,
  normalizeEncryptedQuestion,
  QuestionDecryptionError,
} from '../question-encryption.js'

const key = '1'.repeat(64)

test('encrypts and decrypts questions with AES-256-GCM', () => {
  const encrypted = encryptQuestion('What is AES-GCM?', key)

  assert.ok(encrypted.startsWith(encryptedQuestionPrefix))
  assert.equal(decryptQuestion(encrypted, key), 'What is AES-GCM?')
})

test('reads legacy base64 questions and re-encrypts them for new papers', () => {
  const legacy = `${encryptedQuestionPrefix}${Buffer.from(
    'What is the probability of getting a head?',
  ).toString('base64')}`
  const legacyWithWhitespace = legacy.replace(
    'V2hhd',
    'V2hh d',
  )

  assert.equal(
    decryptQuestion(legacyWithWhitespace, key),
    'What is the probability of getting a head?',
  )

  const normalized = normalizeEncryptedQuestion(legacyWithWhitespace, key)
  assert.notEqual(normalized, legacyWithWhitespace)
  assert.equal(
    decryptQuestion(normalized, key),
    'What is the probability of getting a head?',
  )
})

test('does not treat damaged or wrongly-keyed ciphertext as legacy text', () => {
  const encrypted = encryptQuestion('Protected question', key)

  assert.throws(
    () => decryptQuestion(encrypted, '2'.repeat(64)),
    QuestionDecryptionError,
  )
  assert.throws(
    () => decryptQuestion(`${encryptedQuestionPrefix}not-base64!`, key),
    QuestionDecryptionError,
  )
})
