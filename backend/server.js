import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { getAddress, id } from 'ethers'
import express from 'express'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  readPaperArchive,
  readQuestionBank,
  readUserRecords,
  writePaperArchive,
  writeQuestionBank,
} from './database.js'
import {
  decryptQuestion,
  encryptQuestion,
  normalizeEncryptedQuestion,
  QuestionDecryptionError,
} from './question-encryption.js'
import {
  assertAuthConfiguration,
  AuthError,
  authenticateUser,
  createAccessToken,
  registerUser,
  TokenValidationError,
  verifyAccessToken,
} from './auth.js'
import {
  BlockchainConfigurationError,
  PaperAccessVerificationError,
  createPaperAccessAuthorization,
  getPaperLedgerEvents,
  isBlockchainConfigured,
  registerPaperOnChain,
  verifyPaperAccessTransaction,
} from './blockchain.js'
import {
  createPaperSchedule,
  getPaperAccessError,
  getPublicPaperReleaseAt,
  isPublicPaperReleased,
  previewDurationMilliseconds,
} from './paper-policy.js'
import {
  chooseRandomQuestions,
  getQuestionCategories,
} from './question-categories.js'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const app = express()
const port = Number(process.env.PORT || 3001)
const questionEditorEmail = (
  process.env.QUESTION_EDITOR_EMAIL || 'vaibhahoke.dev1@gmail.com'
).trim().toLowerCase()
let paperStoreQueue = Promise.resolve()

function withPaperStoreLock(operation) {
  const result = paperStoreQueue.then(operation, operation)
  paperStoreQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const readPapers = readPaperArchive
const writePapers = writePaperArchive

function getPaperSummary(paper, includePreviewDetails = false) {
  return {
    paperId: paper.paperId,
    title: paper.title,
    topic: paper.topic,
    generatedAt: paper.generatedAt,
    examAt: paper.examAt,
    releaseAt: paper.releaseAt,
    publicReleaseAt: getPublicPaperReleaseAt(paper),
    isTestPaper: paper.isTestPaper === true,
    createdBy: paper.createdBy,
    totalMarks: paper.totalMarks,
    questionCount: Array.isArray(paper.questions) ? paper.questions.length : 0,
    topics: Array.isArray(paper.questions)
      ? [...new Set(paper.questions.map((question) => question.topic))]
      : [],
    blockchain: paper.blockchain,
    previewUsed: Boolean(paper.previewSession),
    ...(includePreviewDetails && paper.previewSession
      ? { previewExpiresAt: paper.previewSession.expiresAt }
      : {}),
  }
}

function loadAdminWalletBindings() {
  const value = process.env.QUESTION_ADMIN_WALLET_BINDINGS
  if (!value) {
    return new Map()
  }

  let bindings
  try {
    bindings = JSON.parse(value)
  } catch {
    throw new Error(
      'QUESTION_ADMIN_WALLET_BINDINGS must be a JSON object mapping admin emails to MetaMask addresses.',
    )
  }

  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new Error(
      'QUESTION_ADMIN_WALLET_BINDINGS must be a JSON object mapping admin emails to MetaMask addresses.',
    )
  }

  const normalizedBindings = new Map()
  const usedWallets = new Set()
  for (const [email, value] of Object.entries(bindings)) {
    if (typeof value !== 'string') {
      throw new Error(
        `QUESTION_ADMIN_WALLET_BINDINGS has an invalid wallet address for ${email}.`,
      )
    }
    let walletAddress
    try {
      walletAddress = getAddress(value)
    } catch {
      throw new Error(
        `QUESTION_ADMIN_WALLET_BINDINGS has an invalid wallet address for ${email}.`,
      )
    }
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedWallet = walletAddress.toLowerCase()
    if (!normalizedEmail || usedWallets.has(normalizedWallet)) {
      throw new Error(
        'QUESTION_ADMIN_WALLET_BINDINGS must use unique, non-empty admin emails and wallet addresses.',
      )
    }
    normalizedBindings.set(normalizedEmail, walletAddress)
    usedWallets.add(normalizedWallet)
  }
  return normalizedBindings
}

const adminWalletBindings = loadAdminWalletBindings()

function getAccountCapabilities(user) {
  const walletAddress = adminWalletBindings.get(user.email.toLowerCase()) || null
  return {
    walletAddress,
    canViewPapers:
      adminWalletBindings.size === 3 && Boolean(walletAddress),
    canAddQuestions: user.email.toLowerCase() === questionEditorEmail,
  }
}

function isAdminWalletAllowlistConfigured() {
  return (
    adminWalletBindings.size === 3 &&
    adminWalletBindings.has(questionEditorEmail)
  )
}

app.use(express.json({ limit: '16kb' }))

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'question-paper-api',
    blockchainConfigured: isBlockchainConfigured(),
    adminWalletAllowlistConfigured: isAdminWalletAllowlistConfigured(),
  })
})

app.post('/api/auth/register', async (request, response) => {
  const name = request.body?.name
  const email = request.body?.email
  const password = request.body?.password

  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    name.trim().length > 80 ||
    typeof email !== 'string' ||
    email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 128
  ) {
    response.status(400).json({
      error: 'Enter a name, valid email, and password between 8 and 128 characters.',
    })
    return
  }

  if (email.trim().toLowerCase() === questionEditorEmail) {
    response.status(403).json({
      error: 'This email is reserved for the question editor. Sign in to its existing account.',
    })
    return
  }

  try {
    assertAuthConfiguration()
    const user = await registerUser(name.trim(), email.trim().toLowerCase(), password)
    response.status(201).json({
      message: 'Account created. You can now sign in.',
      user,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      response.status(error.status).json({ error: error.message })
      return
    }
    if (error.message === 'JWT_SECRET must be set to at least 32 characters.') {
      response.status(503).json({
        error: 'Authentication is not configured. Add a JWT_SECRET of at least 32 characters to the project .env file and restart the backend.',
      })
      return
    }
    console.error('Failed to register an account:', error)
    response.status(500).json({ error: 'Could not create your account. Please try again.' })
  }
})

app.post('/api/auth/login', async (request, response) => {
  const email = request.body?.email
  const password = request.body?.password

  if (
    typeof email !== 'string' ||
    email.trim().length > 254 ||
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > 128
  ) {
    response.status(400).json({ error: 'Enter your email and password.' })
    return
  }

  try {
    assertAuthConfiguration()
    const user = await authenticateUser(email.trim().toLowerCase(), password)
    if (!user) {
      response.status(401).json({ error: 'Email or password is incorrect.' })
      return
    }

    response.json({
      token: createAccessToken(user),
      user: {
        ...user,
        ...getAccountCapabilities(user),
      },
    })
  } catch (error) {
    if (error.message === 'JWT_SECRET must be set to at least 32 characters.') {
      response.status(503).json({
        error: 'Authentication is not configured. Add a JWT_SECRET of at least 32 characters to the project .env file and restart the backend.',
      })
      return
    }
    console.error('Failed to sign in:', error)
    response.status(500).json({ error: 'Could not sign in. Please try again.' })
  }
})

function requireAuth(request, response, next) {
  const authorization = request.get('authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!token) {
    response.status(401).json({ error: 'Sign in to continue.' })
    return
  }

  try {
    request.authUser = verifyAccessToken(token)
    next()
  } catch (error) {
    if (error instanceof TokenValidationError) {
      response.status(401).json({ error: error.message })
      return
    }
    console.error('Failed to validate an access token:', error)
    response.status(500).json({ error: 'Could not validate your session.' })
  }
}

app.get('/api/auth/me', requireAuth, (request, response) => {
  response.json({
    user: {
      ...request.authUser,
      ...getAccountCapabilities(request.authUser),
    },
  })
})

function requirePaperViewer(request, response, next) {
  if (
    !isAdminWalletAllowlistConfigured() ||
    !adminWalletBindings.has(request.authUser.email.toLowerCase())
  ) {
    response.status(403).json({
      error: 'This account is not configured as an approved paper viewer.',
    })
    return
  }
  next()
}

function requireQuestionEditor(request, response, next) {
  if (request.authUser.email !== questionEditorEmail) {
    response.status(403).json({
      error: 'Only the configured question editor can add questions.',
    })
    return
  }
  next()
}

app.get(
  '/api/question-categories',
  requireAuth,
  requirePaperViewer,
  async (_request, response) => {
    try {
      const questions = await readQuestionBank()
      response.json({ categories: getQuestionCategories(questions) })
    } catch (error) {
      console.error('Failed to retrieve question categories:', error)
      response.status(500).json({ error: 'Could not retrieve question categories.' })
    }
  },
)

app.post(
  '/api/question-papers/generate',
  requireAuth,
  requireQuestionEditor,
  requirePaperViewer,
  async (request, response) => {
    const title = request.body?.title
    const topic = request.body?.topic
    const isTestPaper = request.body?.isTestPaper ?? false
    if (
      typeof title !== 'string' ||
      title.trim().length === 0 ||
      title.trim().length > 120 ||
      typeof topic !== 'string' ||
      topic.trim().length === 0 ||
      topic.trim().length > 120 ||
      typeof isTestPaper !== 'boolean'
    ) {
      response.status(400).json({
        error: 'Enter a paper title and topic, each up to 120 characters, and a valid test-paper setting.',
      })
      return
    }

    try {
      let schedule
      try {
        schedule = createPaperSchedule(
          request.body?.examAt,
          Date.now(),
          isTestPaper,
        )
      } catch (error) {
        response.status(400).json({ error: error.message })
        return
      }

      let source = await readQuestionBank()
      if (!getQuestionCategories(source).some((category) => category.name === topic.trim())) {
        response.status(422).json({
          error: 'Select a subject that has questions in the question bank.',
        })
        return
      }

      let sourceChanged = false
      source = source.map((question) => {
        if (typeof question?.question !== 'string') {
          return question
        }

        const encryptedQuestion = normalizeEncryptedQuestion(
          question.question,
        )
        if (encryptedQuestion === question.question) {
          return question
        }

        sourceChanged = true
        return { ...question, question: encryptedQuestion }
      })
      if (sourceChanged) {
        await writeQuestionBank(source)
      }

      const questions = chooseRandomQuestions(source, topic.trim())
      if (!questions) {
        response.status(422).json({
          error: `The ${topic.trim()} category needs at least 10 questions worth 10 marks each. Add or assign more questions to this category.`,
        })
        return
      }

      const paper = {
        paperId: randomUUID(),
        title: title.trim(),
        topic: topic.trim(),
        generatedAt: new Date().toISOString(),
        ...schedule,
        isTestPaper,
        createdBy: request.authUser.name,
        totalMarks: 100,
        questions,
      }

      try {
        paper.blockchain = await registerPaperOnChain(paper)
      } catch (error) {
        console.error('Failed to register a question paper on Sepolia:', error)
        response.status(error instanceof BlockchainConfigurationError ? 503 : 502).json({
          error:
            error instanceof BlockchainConfigurationError
              ? error.message
              : 'Could not register the paper on Sepolia. Check the RPC connection, wallet funds, and deployed contract.',
        })
        return
      }

      await withPaperStoreLock(async () => {
        const papers = await readPapers()
        papers.push(paper)
        await writePapers(papers)
      })
      response.status(201).json(paper)
    } catch (error) {
      console.error('Failed to generate a question paper:', error)
      response.status(500).json({
        error: 'Could not generate the question paper. Check the local question bank and try again.',
      })
    }
  },
)

app.get(
  '/api/question-papers',
  requireAuth,
  requirePaperViewer,
  async (request, response) => {
    try {
      const papers = await readPapers()
      const isEditor = request.authUser.email === questionEditorEmail
      response.json({
        papers: papers
          .map((paper) => getPaperSummary(paper, isEditor))
          .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt)),
      })
    } catch (error) {
      console.error('Failed to retrieve question papers:', error)
      response.status(500).json({ error: 'Could not retrieve the saved papers.' })
    }
  },
)

app.post(
  '/api/question-papers/:paperId/access-authorization',
  requireAuth,
  requirePaperViewer,
  async (request, response) => {
    const { paperId } = request.params
    const mode = request.body?.mode
    if (!/^[0-9a-f-]{36}$/i.test(paperId)) {
      response.status(400).json({ error: 'Invalid paper ID.' })
      return
    }
    if (mode !== 'preview' && mode !== 'viewer') {
      response.status(400).json({ error: 'Select preview or viewer access.' })
      return
    }

    try {
      const papers = await readPapers()
      const paper = papers.find((entry) => entry?.paperId === paperId)
      if (!paper?.blockchain?.paperId) {
        response.status(404).json({ error: 'Paper not found.' })
        return
      }
      const viewerAddress = adminWalletBindings.get(
        request.authUser.email.toLowerCase(),
      )
      const accessError = getPaperAccessError(paper, {
        mode,
        isEditor: request.authUser.email === questionEditorEmail,
        userId: request.authUser.id,
        viewerAddress,
      })
      if (accessError) {
        response.status(accessError.status).json({ error: accessError.message })
        return
      }
      if (mode === 'preview' && paper.previewSession) {
        response.json({
          mode,
          activePreview: true,
          transactionHash: paper.previewSession.transactionHash,
          previewExpiresAt: paper.previewSession.expiresAt,
        })
        return
      }

      const authorization = await createPaperAccessAuthorization({
        paperId: paper.paperId,
        userId: request.authUser.id,
        viewerAddress,
      })
      response.json({ ...authorization, mode })
    } catch (error) {
      console.error('Failed to authorize paper access:', error)
      response.status(
        error instanceof BlockchainConfigurationError ? 503 : 502,
      ).json({
        error:
          error instanceof BlockchainConfigurationError
            ? error.message
            : 'Could not authorize paper access. Check the paper archive and Sepolia connection.',
      })
    }
  },
)

app.post(
  '/api/question-papers/:paperId/content',
  requireAuth,
  requirePaperViewer,
  async (request, response) => {
    const { paperId } = request.params
    const transactionHash = request.body?.transactionHash
    const mode = request.body?.mode
    if (
      !/^[0-9a-f-]{36}$/i.test(paperId) ||
      typeof transactionHash !== 'string' ||
      !/^0x[0-9a-f]{64}$/i.test(transactionHash) ||
      (mode !== 'preview' && mode !== 'viewer')
    ) {
      response.status(400).json({
        error: 'Enter a valid paper ID, access mode, and Sepolia transaction hash.',
      })
      return
    }

    try {
      const result = await withPaperStoreLock(async () => {
        const papers = await readPapers()
        const paper = papers.find((entry) => entry?.paperId === paperId)
        if (!paper?.blockchain?.paperId || !Array.isArray(paper.questions)) {
          return { status: 404, body: { error: 'Paper not found.' } }
        }

        const viewerAddress = adminWalletBindings.get(
          request.authUser.email.toLowerCase(),
        )
        const accessError = getPaperAccessError(paper, {
          mode,
          isEditor: request.authUser.email === questionEditorEmail,
          userId: request.authUser.id,
          viewerAddress,
          transactionHash,
        })
        if (accessError) {
          return {
            status: accessError.status,
            body: { error: accessError.message },
          }
        }

        let previewExpiresAt
        let decryptedQuestions
        if (mode === 'preview') {
          if (paper.previewSession) {
            const preview = paper.previewSession
            await verifyPaperAccessTransaction({
              transactionHash,
              paperId: paper.paperId,
              userId: request.authUser.id,
              viewerAddress,
            })
            previewExpiresAt = preview.expiresAt
            decryptedQuestions = paper.questions.map((question) => ({
              ...question,
              question: decryptQuestion(question.question),
            }))
          } else {
            await verifyPaperAccessTransaction({
              transactionHash,
              paperId: paper.paperId,
              userId: request.authUser.id,
              viewerAddress,
            })
            decryptedQuestions = paper.questions.map((question) => ({
              ...question,
              question: decryptQuestion(question.question),
            }))
            const startedAt = new Date()
            previewExpiresAt = new Date(
              startedAt.getTime() + previewDurationMilliseconds,
            ).toISOString()
            paper.previewSession = {
              userId: request.authUser.id,
              viewerAddress,
              transactionHash,
              startedAt: startedAt.toISOString(),
              expiresAt: previewExpiresAt,
            }
            await writePapers(papers)
          }
        } else {
          await verifyPaperAccessTransaction({
            transactionHash,
            paperId: paper.paperId,
            userId: request.authUser.id,
            viewerAddress,
          })
          decryptedQuestions = paper.questions.map((question) => ({
            ...question,
            question: decryptQuestion(question.question),
          }))
        }

        return {
          status: 200,
          body: {
            questions: decryptedQuestions,
            ...(previewExpiresAt ? { previewExpiresAt } : {}),
          },
        }
      })
      response.status(result.status).json(result.body)
    } catch (error) {
      console.error('Failed to verify access or reveal paper content:', error)
      response.status(
        error instanceof PaperAccessVerificationError
          ? 403
          : error instanceof BlockchainConfigurationError
            ? 503
            : error instanceof QuestionDecryptionError
              ? 422
            : 502,
      ).json({
        error:
          error instanceof PaperAccessVerificationError ||
          error instanceof BlockchainConfigurationError
            ? error.message
            : error instanceof QuestionDecryptionError
              ? error.message
              : 'Could not verify access or decrypt the paper. Check the transaction and encryption key.',
      })
    }
  },
)

app.get('/api/public/papers', async (_request, response) => {
  try {
    const papers = await readPapers()
    response.json({
      papers: papers
        .filter((paper) => paper?.blockchain?.paperId)
        .map((paper) => ({
          paperId: paper.paperId,
          title: paper.title,
          topic: paper.topic,
          generatedAt: paper.generatedAt,
          examAt: paper.examAt,
          publicReleaseAt: getPublicPaperReleaseAt(paper),
          isReleased: isPublicPaperReleased(paper),
          isTestPaper: paper.isTestPaper === true,
          createdBy: paper.createdBy,
          totalMarks: paper.totalMarks,
          questionCount: Array.isArray(paper.questions)
            ? paper.questions.length
            : 0,
          blockchain: {
            transactionHash: paper.blockchain.transactionHash,
          },
        })),
    })
  } catch (error) {
    console.error('Failed to retrieve publicly listed papers:', error)
    response.status(500).json({ error: 'Could not retrieve public papers.' })
  }
})

app.get('/api/public/papers/:paperId', async (request, response) => {
  const { paperId } = request.params
  if (!/^[0-9a-f-]{36}$/i.test(paperId)) {
    response.status(400).json({ error: 'Invalid paper ID.' })
    return
  }

  try {
    const papers = await readPapers()
    const paper = papers.find((entry) => entry?.paperId === paperId)
    if (!paper?.blockchain?.paperId || !Array.isArray(paper.questions)) {
      response.status(404).json({ error: 'Paper not found.' })
      return
    }

    if (!isPublicPaperReleased(paper)) {
      response.status(403).json({
        error: `This paper will be publicly available on ${getPublicPaperReleaseAt(paper)}.`,
        publicReleaseAt: getPublicPaperReleaseAt(paper),
      })
      return
    }

    response.json({
      paperId: paper.paperId,
      title: paper.title,
      topic: paper.topic,
      examAt: paper.examAt,
      publicReleaseAt: getPublicPaperReleaseAt(paper),
      isTestPaper: paper.isTestPaper === true,
      createdBy: paper.createdBy,
      totalMarks: paper.totalMarks,
      questions: paper.questions.map((question) => ({
        ...question,
        question: decryptQuestion(question.question),
      })),
    })
  } catch (error) {
    console.error('Failed to retrieve a publicly released paper:', error)
    response.status(
      error instanceof QuestionDecryptionError ? 422 : 500,
    ).json({
      error:
        error instanceof QuestionDecryptionError
          ? error.message
          : 'Could not retrieve the public paper.',
    })
  }
})

app.get('/api/audit/accesses', async (_request, response) => {
  try {
    const [events, papers, users] = await Promise.all([
      getPaperLedgerEvents(),
      readPapers(),
      readUserRecords(),
    ])
    if (!Array.isArray(papers) || !Array.isArray(users)) {
      throw new Error('The local paper or user store is not a list.')
    }

    const paperByBlockchainId = new Map(
      papers.map((paper) => [paper.blockchain?.paperId, paper]),
    )
    const usersById = new Map(users.map((user) => [id(user.id), user]))
    const adminEmailsByWallet = new Map(
      [...adminWalletBindings].map(([email, walletAddress]) => [
        walletAddress.toLowerCase(),
        email,
      ]),
    )
    const papersWithRelease = papers
      .filter((paper) => paper?.blockchain?.paperId)
      .map((paper) => ({
        paperId: paper.paperId,
        blockchainPaperId: paper.blockchain.paperId,
        title: paper.title,
        topic: paper.topic,
        generatedAt: paper.generatedAt,
        examAt: paper.examAt,
        publicReleaseAt: getPublicPaperReleaseAt(paper),
        createdBy: paper.createdBy,
        isTestPaper: paper.isTestPaper === true,
        isReleased: isPublicPaperReleased(paper),
        totalMarks: paper.totalMarks,
        questionCount: Array.isArray(paper.questions)
          ? paper.questions.length
          : 0,
        registrationTransactionHash: paper.blockchain.transactionHash,
      }))
    const records = events.map((event) => {
      const paper = paperByBlockchainId.get(event.paperId)
        const email = event.walletAddress
          ? adminEmailsByWallet.get(event.walletAddress.toLowerCase())
          : null
        const appUser = event.appUserId ? usersById.get(event.appUserId) : null
        const isMatchingAdmin = Boolean(
          appUser && email === appUser.email.toLowerCase(),
        )
      return {
        paperId: paper?.paperId || null,
        paperTitle: paper?.title || 'Unknown paper',
        type: event.type,
        account:
          event.type === 'created'
            ? paper?.createdBy || 'Unknown creator'
            : isMatchingAdmin
              ? appUser.name
              : 'Unknown approved admin',
        action:
          event.type === 'created'
            ? 'Paper registered on Sepolia'
            : paper?.previewSession?.transactionHash?.toLowerCase() ===
                event.transactionHash.toLowerCase()
              ? 'Super-admin preview authorized'
              : 'Paper access authorized',
        walletAddress: event.walletAddress || null,
        occurredAt: new Date(event.timestamp * 1000).toISOString(),
        transactionHash: event.transactionHash,
      }
    })

    response.json({
      papers: papersWithRelease,
      records: records.sort(
        (left, right) =>
          Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
      ),
    })
  } catch (error) {
    console.error('Failed to retrieve paper access audit events:', error)
    response.status(
      error instanceof BlockchainConfigurationError ? 503 : 502,
    ).json({
      error:
        error instanceof BlockchainConfigurationError
          ? error.message
          : 'Could not retrieve the on-chain paper access log.',
    })
  }
})

app.post('/api/questions', requireAuth, requireQuestionEditor, async (request, response) => {
  const questionText = request.body?.question
  const topic = request.body?.topic
  const requestedCategories = request.body?.categories ?? []

  if (
    typeof questionText !== 'string' ||
    questionText.trim().length === 0 ||
    questionText.length > 5000 ||
    typeof topic !== 'string' ||
    topic.trim().length === 0 ||
    topic.length > 120 ||
    !Array.isArray(requestedCategories) ||
    requestedCategories.some(
      (category) =>
        typeof category !== 'string' ||
        category.trim().length === 0 ||
        category.trim().length > 120,
    )
  ) {
    response.status(400).json({
      error: 'Enter a question (up to 5,000 characters) and topic (up to 120 characters).',
    })
    return
  }

  try {
    const source = await readQuestionBank()
    const existingCategories = new Set(
      getQuestionCategories(source).map((category) => category.name),
    )
    const categories = [
      ...new Set([
        topic.trim(),
        ...requestedCategories.map((category) => category.trim()),
      ]),
    ]
    if (categories.some((category) => category !== topic.trim() && !existingCategories.has(category))) {
      response.status(400).json({
        error: 'Select existing question subjects or use the question topic to add a new subject.',
      })
      return
    }

    const nextId = source.reduce((highest, entry) => {
      const match = /^Q(\d+)$/.exec(entry?.qid ?? '')
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0) + 1
    const savedQuestion = {
      qid: `Q${String(nextId).padStart(3, '0')}`,
      question: encryptQuestion(questionText.trim()),
      topic: topic.trim(),
      categories,
      marks: 10,
      createdBy: request.authUser.name,
    }

    source.push(savedQuestion)
    await writeQuestionBank(source)
    response.status(201).json({
      qid: savedQuestion.qid,
      topic: savedQuestion.topic,
      categories: savedQuestion.categories,
      marks: savedQuestion.marks,
      createdBy: savedQuestion.createdBy,
    })
  } catch (error) {
    console.error('Failed to add a question:', error)
    response.status(500).json({
      error:
        error.message ===
        'QUESTION_ENCRYPTION_KEY must be set to a 64-character hexadecimal key.'
          ? error.message
          : 'Could not add the question. Check the encryption key and local question bank.',
    })
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log(`Question paper API listening at http://127.0.0.1:${port}`)
})
