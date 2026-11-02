import { config } from 'dotenv'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  readPaperArchive,
  readQuestionBank,
  readUserRecords,
  writePaperArchive,
  writeQuestionBank,
  upsertUserRecords,
} from '../database.js'
import { normalizeEncryptedQuestion } from '../question-encryption.js'

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const localDb = new URL('../local_db/', import.meta.url)
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(new URL(name, localDb), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) {
      return fallback
    }
    throw error
  }
}

function protectQuestion(question) {
  if (!question || typeof question.question !== 'string') {
    throw new Error('A question record is missing its question text.')
  }
  return {
    ...question,
    question: normalizeEncryptedQuestion(question.question),
  }
}

function protectPaper(paper) {
  if (!paper || !uuidPattern.test(paper.paperId) || !Array.isArray(paper.questions)) {
    throw new Error('A paper record has an invalid ID or question list.')
  }
  return {
    ...paper,
    questions: paper.questions.map(protectQuestion),
  }
}

function assertImportedIds(expectedIds, records, getId, label) {
  const foundIds = new Set(records.map(getId))
  const missingIds = expectedIds.filter((recordId) => !foundIds.has(recordId))
  if (missingIds.length > 0) {
    throw new Error(`Supabase verification failed for ${label}: ${missingIds.length} IDs are missing.`)
  }
}

async function migrate() {
  const [rawQuestions, rawArchive, latestPaper, rawUsers] = await Promise.all([
    readJson('questions.json'),
    readJson('question_papers.json', []),
    readJson('question_paper.json', null),
    readJson('users.json', []),
  ])

  if (!Array.isArray(rawQuestions) || !Array.isArray(rawArchive) || !Array.isArray(rawUsers)) {
    throw new Error('The local question, paper, and user stores must be JSON arrays.')
  }

  const questions = rawQuestions.map(protectQuestion)
  if (questions.some((question) => typeof question.qid !== 'string' || !question.qid)) {
    throw new Error('Every question must have a non-empty qid.')
  }

  const paperById = new Map()
  if (latestPaper) {
    const paper = protectPaper(latestPaper)
    paperById.set(paper.paperId, paper)
  }
  for (const rawPaper of rawArchive) {
    const paper = protectPaper(rawPaper)
    paperById.set(paper.paperId, paper)
  }
  const papers = [...paperById.values()]

  for (const user of rawUsers) {
    if (!user || !uuidPattern.test(user.id) || typeof user.email !== 'string') {
      throw new Error('A user record has an invalid ID or email.')
    }
  }

  await writeQuestionBank(questions)
  await writePaperArchive(papers)
  await upsertUserRecords(rawUsers)

  const [savedQuestions, savedPapers, savedUsers] = await Promise.all([
    readQuestionBank(),
    readPaperArchive(),
    readUserRecords(),
  ])
  assertImportedIds(questions.map((question) => question.qid), savedQuestions, (question) => question.qid, 'questions')
  assertImportedIds(papers.map((paper) => paper.paperId), savedPapers, (paper) => paper.paperId, 'papers')
  assertImportedIds(rawUsers.map((user) => user.id), savedUsers, (user) => user.id, 'users')

  console.log(`Imported and verified ${questions.length} questions, ${papers.length} papers, and ${rawUsers.length} users.`)
  console.log('Question ciphertext was preserved or upgraded before upload. Local JSON files were not changed.')
}

migrate().catch((error) => {
  console.error('Local data migration failed:', error.message)
  process.exitCode = 1
})