import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPaperSchedule,
  getPaperAccessError,
  getPublicPaperReleaseAt,
  isPublicPaperReleased,
  isPaperReleased,
  previewDurationMilliseconds,
} from '../paper-policy.js'

const now = Date.parse('2026-10-25T00:00:00.000Z')

test('sets the release time exactly 72 hours before the exam', () => {
  const schedule = createPaperSchedule('2026-11-01T10:30:00.000Z', now)

  assert.equal(schedule.examAt, '2026-11-01T10:30:00.000Z')
  assert.equal(schedule.releaseAt, '2026-10-29T10:30:00.000Z')
  assert.equal(schedule.publicReleaseAt, '2026-11-02T10:30:00.000Z')
})

test('makes the public paper available exactly 24 hours after the exam', () => {
  const paper = { examAt: '2026-11-01T10:30:00.000Z' }

  assert.equal(
    getPublicPaperReleaseAt(paper),
    '2026-11-02T10:30:00.000Z',
  )
  assert.equal(
    isPublicPaperReleased(paper, Date.parse('2026-11-02T10:29:59.999Z')),
    false,
  )
  assert.equal(
    isPublicPaperReleased(paper, Date.parse('2026-11-02T10:30:00.000Z')),
    true,
  )
  assert.equal(isPublicPaperReleased({}, now), false)
})

test('makes test papers publicly available immediately', () => {
  const schedule = createPaperSchedule(
    '2026-11-01T10:30:00.000Z',
    now,
    true,
  )
  const testPaper = {
    ...schedule,
    isTestPaper: true,
  }

  assert.equal(schedule.publicReleaseAt, new Date(now).toISOString())
  assert.equal(isPublicPaperReleased(testPaper, now), true)
  assert.equal(isPublicPaperReleased(testPaper, now - 60_000), true)
})

test('does not release until the exact scheduled time', () => {
  const paper = { releaseAt: '2026-10-29T10:30:00.000Z' }

  assert.equal(isPaperReleased(paper, Date.parse('2026-10-29T10:29:59.999Z')), false)
  assert.equal(isPaperReleased(paper, Date.parse('2026-10-29T10:30:00.000Z')), true)
})

test('rejects missing, invalid, and past exam dates', () => {
  assert.throws(() => createPaperSchedule(undefined, now), RangeError)
  assert.throws(() => createPaperSchedule('not-a-date', now), RangeError)
  assert.throws(() => createPaperSchedule('2026-10-24T10:00:00.000Z', now), RangeError)
})

test('keeps the super-admin preview session limited to 15 minutes', () => {
  assert.equal(previewDurationMilliseconds, 15 * 60 * 1000)
})

test('blocks viewers until release while allowing the super-admin preview', () => {
  const paper = { releaseAt: '2026-10-29T10:30:00.000Z' }
  const access = {
    mode: 'viewer',
    isEditor: false,
    userId: 'viewer-id',
    viewerAddress: '0xviewer',
    now: Date.parse('2026-10-29T10:29:59.999Z'),
  }

  assert.equal(getPaperAccessError(paper, access).status, 403)
  assert.equal(getPaperAccessError(paper, { ...access, now: Date.parse(paper.releaseAt) }), null)
  assert.equal(
    getPaperAccessError(paper, { ...access, mode: 'preview', isEditor: true }),
    null,
  )
  assert.equal(
    getPaperAccessError(paper, { ...access, mode: 'preview', isEditor: false }).status,
    403,
  )
})

test('allows immediate audited viewer access to test papers before scheduled release', () => {
  const paper = {
    isTestPaper: true,
    releaseAt: '2026-10-29T10:30:00.000Z',
  }
  const access = {
    mode: 'viewer',
    isEditor: false,
    userId: 'viewer-id',
    viewerAddress: '0xviewer',
    now: Date.parse('2026-10-25T00:00:00.000Z'),
  }

  assert.equal(getPaperAccessError(paper, access), null)
  assert.equal(
    getPaperAccessError({ ...paper, isTestPaper: false }, access).status,
    403,
  )
})

test('limits an early preview to its original user, wallet, transaction, and 15-minute window', () => {
  const paper = {
    isTestPaper: true,
    releaseAt: '2026-10-29T10:30:00.000Z',
    previewSession: {
      userId: 'editor-id',
      viewerAddress: '0xEditor',
      transactionHash: '0xpreview',
      expiresAt: '2026-10-25T00:15:00.000Z',
    },
  }
  const access = {
    mode: 'preview',
    isEditor: true,
    userId: 'editor-id',
    viewerAddress: '0xeditor',
    transactionHash: '0xpreview',
    now,
  }

  assert.equal(getPaperAccessError(paper, access), null)
  assert.equal(
    getPaperAccessError(paper, { ...access, transactionHash: '0xother' }).status,
    403,
  )
  assert.equal(
    getPaperAccessError(paper, { ...access, userId: 'other-user' }).status,
    403,
  )
  assert.equal(
    getPaperAccessError(paper, {
      ...access,
      now: Date.parse('2026-10-25T00:15:00.000Z'),
    }).status,
    403,
  )
})
