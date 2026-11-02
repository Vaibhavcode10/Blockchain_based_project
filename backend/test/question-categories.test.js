import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseRandomQuestions,
  getQuestionCategories,
} from '../question-categories.js'

function question(qid, topic, categories = [topic]) {
  return {
    qid,
    topic,
    categories,
    question: `enc:v1:${qid}`,
    marks: 10,
  }
}

test('counts each question once per category and includes its topic', () => {
  const questions = [
    question('Q001', 'Java', ['Programming', 'Java']),
    question('Q002', 'Arrays', ['Programming']),
    question('Q003', 'Java', ['Java']),
  ]

  assert.deepEqual(getQuestionCategories(questions), [
    { name: 'Arrays', count: 1 },
    { name: 'Java', count: 2 },
    { name: 'Programming', count: 2 },
  ])
})

test('uses the legacy topic as the category for existing questions', () => {
  const legacyQuestion = {
    qid: 'Q001',
    topic: 'Arrays',
    question: 'enc:v1:Q001',
    marks: 10,
  }

  assert.deepEqual(getQuestionCategories([legacyQuestion]), [
    { name: 'Arrays', count: 1 },
  ])
})

test('selects only questions assigned to the requested category', () => {
  const questions = Array.from({ length: 12 }, (_, index) =>
    question(`Q${index}`, index < 10 ? 'Java' : 'DSA'),
  )

  const selected = chooseRandomQuestions(questions, 'Java')

  assert.equal(selected.length, 10)
  assert.ok(selected.every((entry) => entry.topic === 'Java'))
  assert.equal(chooseRandomQuestions(questions, 'DSA'), null)
})
