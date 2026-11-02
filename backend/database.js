import { createClient } from '@supabase/supabase-js'
import process from 'node:process'

let supabaseClient

function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY in the project .env file.',
    )
  }

  supabaseClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return supabaseClient
}

async function readRecords(table, orderColumn) {
  const records = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await getSupabaseClient()
      .from(table)
      .select('record')
      .order(orderColumn, { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) {
      throw new Error(`Supabase ${table} read failed: ${error.message}`)
    }

    records.push(...data.map((row) => row.record))
    if (data.length < pageSize) {
      return records
    }
    offset += data.length
  }
}

async function upsertRecords(table, rows, conflictColumn) {
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100)
    const { error } = await getSupabaseClient()
      .from(table)
      .upsert(batch, { onConflict: conflictColumn })
    if (error) {
      throw new Error(`Supabase ${table} write failed: ${error.message}`)
    }
  }
}

export function readQuestionBank() {
  return readRecords('question_bank', 'qid')
}

export function writeQuestionBank(questions) {
  return upsertRecords(
    'question_bank',
    questions.map((record) => ({ qid: record.qid, record })),
    'qid',
  )
}

export function readPaperArchive() {
  return readRecords('question_papers', 'paper_id')
}

export function writePaperArchive(papers) {
  return upsertRecords(
    'question_papers',
    papers.map((record) => ({ paper_id: record.paperId, record })),
    'paper_id',
  )
}

export function readUserRecords() {
  return readRecords('app_users', 'email')
}

export function upsertUserRecords(records) {
  return upsertRecords(
    'app_users',
    records.map((record) => ({
      user_id: record.id,
      email: record.email,
      record,
    })),
    'user_id',
  )
}

export async function insertUserRecord(record) {
  const { error } = await getSupabaseClient()
    .from('app_users')
    .insert({ user_id: record.id, email: record.email, record })
  if (error) {
    throw error
  }
}