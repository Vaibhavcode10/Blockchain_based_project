import { useEffect, useState } from 'react'
import { BrowserProvider, Contract } from 'ethers'
import './App.css'

const tokenStorageKey = 'anti-paper-leak-token'
const themeStorageKey = 'paper-vault-theme'
const sepoliaChainId = 11155111n
const questionPaperVaultAbi = [
  'function accessPaper(uint256 paperId, bytes32 appUserId, uint256 deadline, uint256 nonce, bytes signature)',
]

function getDefaultExamDateTime() {
  const defaultDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  defaultDate.setMinutes(defaultDate.getMinutes() - defaultDate.getTimezoneOffset())
  return defaultDate.toISOString().slice(0, 16)
}

function getPaperMetadata(paper) {
  return {
    ...paper,
    questions: undefined,
    accessMode: undefined,
  }
}

async function readApiResponse(response) {
  const body = await response.text()
  let result

  try {
    result = body ? JSON.parse(body) : null
  } catch {
    throw new Error(
      `Backend returned a non-JSON response (HTTP ${response.status}). Make sure the backend is running with "npm run dev:backend".`,
    )
  }

  if (!result) {
    throw new Error(
      `Backend returned an empty response (HTTP ${response.status}). Make sure the backend is running with "npm run dev:backend".`,
    )
  }

  if (!response.ok) {
    throw new Error(result.error || `Request failed (HTTP ${response.status}).`)
  }

  return result
}

function shortenAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function PublicAuditPage({ theme, onThemeToggle }) {
  const [records, setRecords] = useState([])
  const [papers, setPapers] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [openedPapers, setOpenedPapers] = useState({})
  const [loadingPaperId, setLoadingPaperId] = useState('')
  const [paperError, setPaperError] = useState(null)

  useEffect(() => {
    let isCurrent = true

    async function loadRecords() {
      setIsLoading(true)
      try {
        const response = await fetch('/api/audit/accesses')
        const result = await readApiResponse(response)
        if (isCurrent) {
          setRecords(result.records)
          setPapers(result.papers)
          setError('')
        }
      } catch (auditError) {
        if (isCurrent) {
          setError(
            auditError instanceof TypeError
              ? 'The audit service is not reachable.'
              : auditError.message,
          )
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false)
        }
      }
    }

    loadRecords()
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    const initialUpdate = window.setTimeout(
      () => setCurrentTime(Date.now()),
      0,
    )
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000)
    return () => {
      window.clearTimeout(initialUpdate)
      window.clearInterval(timer)
    }
  }, [])

  async function openPaper(paperId) {
    if (openedPapers[paperId]) {
      setOpenedPapers((current) => {
        const next = { ...current }
        delete next[paperId]
        return next
      })
      return
    }

    setLoadingPaperId(paperId)
    setPaperError(null)
    try {
      const response = await fetch(
        `/api/public/papers/${encodeURIComponent(paperId)}`,
      )
      const result = await readApiResponse(response)
      setOpenedPapers((current) => ({ ...current, [paperId]: result }))
    } catch (loadError) {
      setPaperError({
        paperId,
        message:
          loadError instanceof TypeError
            ? 'The paper service is not reachable.'
            : loadError.message,
      })
    } finally {
      setLoadingPaperId('')
    }
  }

  return (
    <div className="workspace-layout">
      <aside className="workspace-sidebar">
        <a className="workspace-brand" href="/" aria-label="Paper Vault home">
          <span className="workspace-brand-mark" aria-hidden="true">✦</span>
          <span>Paper Vault<small>SECURE WORKSPACE</small></span>
        </a>
        <span className="sidebar-label">WORKSPACE</span>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          <a className="workspace-nav-item" href="/">
            <span className="nav-item-icon" aria-hidden="true">▤</span>
            <span>Papers</span>
          </a>
          <a
            className="workspace-nav-item active"
            href="/audit"
            aria-current="page"
          >
            <span className="nav-item-icon" aria-hidden="true">◷</span>
            <span>Public access log</span>
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon" aria-hidden="true">◇</span>
          <div>
            <strong>Public paper ledger</strong>
            <span>Paper releases and access activity, verified on Sepolia.</span>
          </div>
        </div>
      </aside>
      <main className="app-shell">
        <div className="workspace-topbar">
          <div className="workspace-breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>Public access log</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="theme-toggle"
              type="button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              aria-pressed={theme === 'dark'}
              onClick={onThemeToggle}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
          </div>
        </div>
      <header className="page-header">
        <div className="page-header-copy">
        <span className="eyebrow">PUBLIC PAPER LEDGER</span>
        <h1>Paper activity & releases</h1>
        <p>
          Creation and admin-access records are verified on Sepolia. Paper
          questions stay private until 24 hours after the scheduled exam, then
          become publicly available without sign-in.
        </p>
        </div>
        <span className="page-header-art" aria-hidden="true">✦</span>
      </header>
      {isLoading && <p role="status">Loading access records…</p>}
      {error && <p className="message error-message" role="alert">{error}</p>}
      {!isLoading && !error && papers.length === 0 && (
        <p>No papers have been registered yet.</p>
      )}
      {!isLoading && !error && (
        <div className="public-paper-list" aria-label="Public paper ledger">
          {papers.map((paper) => {
            const releaseTime = Date.parse(paper.publicReleaseAt)
            const isReleased =
              paper.isReleased ||
              (Number.isFinite(releaseTime) && currentTime >= releaseTime)
            const paperRecords = records.filter(
              (record) => record.paperId === paper.paperId,
            )
            const openedPaper = openedPapers[paper.paperId]

            return (
              <article className="paper-card public-paper-card" key={paper.paperId}>
                <div className="paper-details">
                  <div className="paper-header">
                    <div>
                      <span className="eyebrow">QUESTION PAPER</span>
                      <h2>{paper.title}</h2>
                      <p className="paper-topic">{paper.topic}</p>
                    </div>
                    <div className="paper-total">
                      <strong>{paper.totalMarks}</strong>
                      <span>total marks</span>
                    </div>
                  </div>
                  <div className="public-paper-meta">
                    <p>
                      Created by <strong>{paper.createdBy || 'Unknown'}</strong>
                      {paper.generatedAt &&
                        <> · {new Date(paper.generatedAt).toLocaleString()}</>}
                    </p>
                    <p>Exam: {new Date(paper.examAt).toLocaleString()}</p>
                    <p>
                      Public release:{' '}
                      {paper.isTestPaper
                        ? 'Immediately (test paper)'
                        : new Date(paper.publicReleaseAt).toLocaleString()}
                    </p>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${paper.registrationTransactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View paper registration transaction
                    </a>
                  </div>
                  <section aria-label={`Activity for ${paper.title}`}>
                    <h3>On-chain activity</h3>
                    {paperRecords.length === 0 ? (
                      <p>No creation or access events were found for this paper.</p>
                    ) : (
                      <div className="question-list">
                        {paperRecords.map((record) => (
                          <article
                            className="question-item"
                            key={record.transactionHash}
                          >
                            <div className="question-item-header">
                              <span className="question-topic">
                                {record.account}
                              </span>
                              <span className="question-marks">
                                {new Date(record.occurredAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="question-item-body">
                              <p>{record.action}</p>
                              {record.walletAddress ? (
                                <p>
                                  Wallet:{' '}
                                  <code title={record.walletAddress}>
                                    {shortenAddress(record.walletAddress)}
                                  </code>
                                </p>
                              ) : (
                                <p>
                                  Creator wallet is available in the transaction
                                  details.
                                </p>
                              )}
                              <a
                                href={`https://sepolia.etherscan.io/tx/${record.transactionHash}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View Sepolia transaction
                              </a>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                  <div className="public-paper-actions">
                    {isReleased ? (
                      <button
                        className="generate-button"
                        type="button"
                        disabled={loadingPaperId === paper.paperId}
                        onClick={() => openPaper(paper.paperId)}
                      >
                        {loadingPaperId === paper.paperId
                          ? 'Loading paper…'
                          : openedPaper
                            ? 'Hide questions'
                            : 'View released paper'}
                      </button>
                    ) : (
                      <p className="form-hint">
                        Questions are hidden until 24 hours after the exam.
                      </p>
                    )}
                    {paperError?.paperId === paper.paperId && (
                      <p className="message error-message" role="alert">
                        {paperError.message}
                      </p>
                    )}
                  </div>
                  {openedPaper && (
                    <div className="paper-details public-paper-questions">
                      <p className="encryption-note">
                        This paper is publicly released. Anyone can view or copy
                        these questions.
                      </p>
                      <div className="question-list">
                        {openedPaper.questions.map((question) => (
                          <article
                            key={question.qid}
                            className="question-item"
                          >
                            <div className="question-item-header">
                              <span className="question-topic">
                                {question.topic}
                              </span>
                              <span className="question-marks">
                                {question.marks} marks
                              </span>
                            </div>
                            <div className="question-item-body">
                              <span className="question-meta">{question.qid}</span>
                              <p>{question.question}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
      </main>
    </div>
  )
}

function App() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem(themeStorageKey)
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  })
  const [token, setToken] = useState(
    () => sessionStorage.getItem(tokenStorageKey) || '',
  )
  const [user, setUser] = useState(null)
  const [isAuthenticating, setIsAuthenticating] = useState(Boolean(token))
  const [authMode, setAuthMode] = useState('register')
  const [authName, setAuthName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [activePage, setActivePage] = useState('generate')
  const [paper, setPaper] = useState(null)
  const [papers, setPapers] = useState([])
  const [questionCategories, setQuestionCategories] = useState([])
  const [currentTime, setCurrentTime] = useState(0)
  const [paperTitle, setPaperTitle] = useState('')
  const [paperTopic, setPaperTopic] = useState('')
  const [examDateTime, setExamDateTime] = useState(getDefaultExamDateTime)
  const [isTestPaper, setIsTestPaper] = useState(false)
  const [isPaperOpen, setIsPaperOpen] = useState(false)
  const [isLoggingAccess, setIsLoggingAccess] = useState(false)
  const [accessMessage, setAccessMessage] = useState('')
  const [accessTransactionHash, setAccessTransactionHash] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAddingQuestion, setIsAddingQuestion] = useState(false)
  const [questionText, setQuestionText] = useState('')
  const [topic, setTopic] = useState('')
  const [selectedQuestionCategories, setSelectedQuestionCategories] = useState([])
  const [formMessage, setFormMessage] = useState('')
  const [backendStatus, setBackendStatus] = useState('')
  const [isCheckingBackend, setIsCheckingBackend] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  useEffect(() => {
    const updateTime = () => setCurrentTime(Date.now())
    const initialUpdate = window.setTimeout(updateTime, 0)
    const interval = window.setInterval(updateTime, 30_000)
    return () => {
      window.clearTimeout(initialUpdate)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let isCurrent = true
    if (!token) {
      return () => {
        isCurrent = false
      }
    }

    async function restoreSession() {
      setIsAuthenticating(true)
      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const result = await readApiResponse(response)
        if (isCurrent) {
          setUser(result.user)
          setAuthMessage('')
        }
      } catch (sessionError) {
        if (isCurrent) {
          sessionStorage.removeItem(tokenStorageKey)
          setToken('')
          setUser(null)
          setIsAuthenticating(false)
          setAuthMessage(
            sessionError instanceof TypeError
              ? 'Could not reach the backend. Start it with "npm run dev:backend" and sign in again.'
              : 'Your session expired. Please sign in again.',
          )
        }
      } finally {
        if (isCurrent) {
          setIsAuthenticating(false)
        }
      }
    }

    restoreSession()
    return () => {
      isCurrent = false
    }
  }, [token])

  useEffect(() => {
    let isCurrent = true
    if (!token || !user?.canViewPapers) {
      return () => {
        isCurrent = false
      }
    }

    async function loadPapers() {
      try {
        const response = await fetch('/api/question-papers', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const result = await readApiResponse(response)
        if (isCurrent) {
          setPapers(result.papers)
          setPaper((currentPaper) =>
            result.papers.find(
              (savedPaper) => savedPaper.paperId === currentPaper?.paperId,
            ) ||
            result.papers[0] ||
            null,
          )
        }
        const categoriesResponse = await fetch('/api/question-categories', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const categoryResult = await readApiResponse(categoriesResponse)
        if (isCurrent) {
          setQuestionCategories(categoryResult.categories)
        }
      } catch (loadError) {
        if (isCurrent) {
          setError(
            loadError instanceof TypeError
              ? 'Could not load saved papers because the backend is not reachable.'
              : loadError.message,
          )
        }
      }
    }

    loadPapers()
    return () => {
      isCurrent = false
    }
  }, [token, user?.canViewPapers])

  useEffect(() => {
    if (!isPaperOpen || paper?.accessMode !== 'preview' || !paper.previewExpiresAt) {
      return undefined
    }

    const remainingMilliseconds = Date.parse(paper.previewExpiresAt) - Date.now()
    const timeout = window.setTimeout(() => {
      setPaper(getPaperMetadata(paper))
      setIsPaperOpen(false)
      setAccessMessage('The 15-minute super-admin preview has expired.')
    }, Math.max(remainingMilliseconds, 0))
    return () => window.clearTimeout(timeout)
  }, [isPaperOpen, paper])

  if (window.location.pathname === '/audit') {
    return (
      <PublicAuditPage
        theme={theme}
        onThemeToggle={() =>
          setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')
        }
      />
    )
  }

  async function handleAuthSubmit(event) {
    event.preventDefault()
    setIsSubmittingAuth(true)
    setAuthMessage('')

    try {
      const isRegistering = authMode === 'register'
      const response = await fetch(
        isRegistering ? '/api/auth/register' : '/api/auth/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(isRegistering ? { name: authName } : {}),
            email: authEmail,
            password: authPassword,
          }),
        },
      )
      const result = await readApiResponse(response)

      if (isRegistering) {
        setAuthMode('login')
        setAuthPassword('')
        setAuthMessage(result.message)
      } else {
        sessionStorage.setItem(tokenStorageKey, result.token)
        setUser(result.user)
        setToken(result.token)
      }
    } catch (authError) {
      setAuthMessage(
        authError instanceof TypeError
          ? 'Backend is not reachable. Start it with "npm run dev:backend" and try again.'
          : authError.message,
      )
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(tokenStorageKey)
    setToken('')
    setUser(null)
    setPaper(null)
    setPapers([])
    setIsPaperOpen(false)
    setError('')
    setBackendStatus('')
    setFormMessage('')
    setAuthMessage('')
    setAuthMode('login')
  }

  async function handleCheckBackend() {
    setIsCheckingBackend(true)
    setBackendStatus('')

    try {
      const response = await fetch('/api/health')
      const result = await readApiResponse(response)
      setBackendStatus(
        result.status === 'ok'
          ? result.blockchainConfigured
            ? result.adminWalletAllowlistConfigured
              ? 'Backend, Sepolia vault, and three admin wallets are configured.'
              : 'Sepolia vault is configured, but the three-admin wallet allowlist is incomplete.'
            : 'Backend is connected, but Sepolia vault setup is incomplete.'
          : 'Unexpected health response.',
      )
    } catch (healthError) {
      setBackendStatus(
        healthError instanceof TypeError
          ? 'Backend is not reachable. Start it with "npm run dev:backend".'
          : healthError.message,
      )
    } finally {
      setIsCheckingBackend(false)
    }
  }

  async function handleGeneratePaper() {
    const selectedCategory = questionCategories.find(
      (category) => category.name === paperTopic,
    )
    if (!paperTitle.trim() || !selectedCategory || !examDateTime) {
      setError('Enter a paper title, select a subject, and choose the exam date and time.')
      return
    }
    if (selectedCategory.count < 10) {
      setError(
        `${selectedCategory.name} has ${selectedCategory.count} questions. Add or assign at least 10 questions to this subject before generating a paper.`,
      )
      return
    }

    setIsGenerating(true)
    setError('')
    setAccessMessage('')
    setAccessTransactionHash('')

    try {
      const response = await fetch('/api/question-papers/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: paperTitle.trim(),
          topic: paperTopic.trim(),
          examAt: new Date(examDateTime).toISOString(),
          isTestPaper,
        }),
      })
      const result = await readApiResponse(response)
      if (result.title !== paperTitle.trim()) {
        throw new Error(
          'The backend did not save the paper title. Restart the backend and try again.',
        )
      }
      const metadata = getPaperMetadata(result)
      setPaper(metadata)
      setPapers((savedPapers) => [
        metadata,
        ...savedPapers.filter((savedPaper) => savedPaper.paperId !== metadata.paperId),
      ])
      setIsPaperOpen(false)
    } catch (generationError) {
      setError(
        generationError instanceof TypeError
          ? 'Backend is not reachable. Start it with "npm run dev:backend" and try again.'
          : generationError.message,
      )
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleTogglePaper(paperToOpen = paper) {
    if (!paperToOpen) {
      return
    }

    if (isPaperOpen && paper?.paperId === paperToOpen.paperId) {
      setPaper((currentPaper) => getPaperMetadata(currentPaper))
      setIsPaperOpen(false)
      return
    }

    const releaseTime = Date.parse(paperToOpen.releaseAt)
    const isReleased =
      paperToOpen.isTestPaper ||
      (Number.isFinite(releaseTime) && currentTime >= releaseTime)
    const previewExpiresAt = Date.parse(paperToOpen.previewExpiresAt)
    const hasActivePreview =
      paperToOpen.previewUsed &&
      Number.isFinite(previewExpiresAt) &&
      currentTime < previewExpiresAt
    const canPreview =
      user.canAddQuestions &&
      !isReleased &&
      (!paperToOpen.previewUsed || hasActivePreview)

    if (!isReleased && !canPreview) {
      return
    }

    setPaper(paperToOpen)
    setIsPaperOpen(false)
    setAccessMessage('')
    setAccessTransactionHash('')

    if (!window.ethereum) {
      setAccessMessage('Install MetaMask and connect it to Sepolia to log paper access.')
      return
    }

    setIsLoggingAccess(true)
    setAccessMessage('')
    setAccessTransactionHash('')

    try {
      const provider = new BrowserProvider(window.ethereum)
      const network = await provider.getNetwork()
      if (network.chainId !== sepoliaChainId) {
        throw new Error('Switch MetaMask to the Sepolia test network and try again.')
      }

      if (!user.walletAddress) {
        throw new Error('This account has no pre-approved MetaMask wallet.')
      }

      await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      const signerAddress = await signer.getAddress()
      if (signerAddress.toLowerCase() !== user.walletAddress.toLowerCase()) {
        throw new Error(
          `MetaMask is connected to ${signerAddress}, but this account is approved for ${user.walletAddress}. Switch to the approved account in MetaMask and try again.`,
        )
      }

      const accessMode =
        user.canAddQuestions && currentTime < Date.parse(paperToOpen.releaseAt)
          ? 'preview'
          : 'viewer'
      if (
        accessMode === 'preview' &&
        !window.confirm(
          'Warning: this is the super-admin’s one-time 15-minute preview and will be recorded on Sepolia. Once decrypted, the questions can still be copied or photographed. Continue?',
        )
      ) {
        return
      }
      const authorizationResponse = await fetch(
        `/api/question-papers/${encodeURIComponent(paperToOpen.paperId)}/access-authorization`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ mode: accessMode }),
        },
      )
      const authorization = await readApiResponse(authorizationResponse)
      let transactionHash = authorization.transactionHash
      if (!authorization.activePreview) {
        const vault = new Contract(
          paperToOpen.blockchain.contractAddress,
          questionPaperVaultAbi,
          signer,
        )
        const transaction = await vault.accessPaper(
          paperToOpen.blockchain.paperId,
          authorization.appUserId,
          authorization.deadline,
          authorization.nonce,
          authorization.signature,
        )
        transactionHash = transaction.hash
        setAccessTransactionHash(transactionHash)
        setAccessMessage('Waiting for the access transaction to be confirmed on Sepolia…')
        const receipt = await transaction.wait()
        if (!receipt || receipt.status !== 1) {
          throw new Error('The access transaction did not succeed.')
        }
      }

      const contentResponse = await fetch(
        `/api/question-papers/${encodeURIComponent(paperToOpen.paperId)}/content`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            transactionHash,
            mode: accessMode,
          }),
        },
      )
      const content = await readApiResponse(contentResponse)
      const openedPaper = {
        ...paperToOpen,
        questions: content.questions,
        accessMode,
        previewExpiresAt: content.previewExpiresAt,
        previewUsed: accessMode === 'preview' || paperToOpen.previewUsed,
      }
      setPaper(openedPaper)
      if (accessMode === 'preview') {
        setPapers((savedPapers) =>
          savedPapers.map((savedPaper) =>
            savedPaper.paperId === paperToOpen.paperId
              ? {
                  ...savedPaper,
                  previewUsed: true,
                  previewExpiresAt: content.previewExpiresAt,
                }
              : savedPaper,
          ),
        )
      }
      setAccessTransactionHash(transactionHash)
      setAccessMessage(
        accessMode === 'preview'
          ? `Super-admin preview is open until ${new Date(content.previewExpiresAt).toLocaleString()}. This preview is audited and cannot be repeated after it expires.`
          : 'Access logged on Sepolia.',
      )
      setIsPaperOpen(true)
    } catch (accessError) {
      setAccessMessage(
        accessError instanceof Error
          ? accessError.message
          : 'Could not log paper access with MetaMask.',
      )
    } finally {
      setIsLoggingAccess(false)
    }
  }

  async function handleAddQuestion(event) {
    event.preventDefault()
    setIsAddingQuestion(true)
    setFormMessage('')

    try {
      const response = await fetch('/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: questionText,
          topic,
          categories: selectedQuestionCategories,
        }),
      })
      const result = await readApiResponse(response)
      setQuestionCategories((currentCategories) => {
        const counts = new Map(
          currentCategories.map((category) => [category.name, category.count]),
        )
        for (const category of result.categories) {
          counts.set(category, (counts.get(category) || 0) + 1)
        }
        return [...counts]
          .map(([name, count]) => ({ name, count }))
          .sort((left, right) => left.name.localeCompare(right.name))
      })
      setFormMessage(
        `${result.qid} added successfully. The question is encrypted in the local database.`,
      )
      setQuestionText('')
      setTopic('')
      setSelectedQuestionCategories([])
    } catch (addError) {
      setFormMessage(
        addError instanceof TypeError
          ? 'Backend is not reachable. Start it with "npm run dev:backend" and try again.'
          : addError.message,
      )
    } finally {
      setIsAddingQuestion(false)
    }
  }

  if (isAuthenticating && !user) {
    return (
      <main className="auth-page">
        <section className="auth-loading" role="status">
          <span className="auth-mark" aria-hidden="true">✦</span>
          <p>Verifying your secure session…</p>
        </section>
      </main>
    )
  }

  if (!user) {
    const isRegistering = authMode === 'register'

    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-brand-panel">
            <span className="auth-brand">
              <span className="auth-mark" aria-hidden="true">✦</span>
              Paper Vault
            </span>
            <div className="auth-brand-copy">
              <span className="auth-brand-eyebrow">YOUR STUDY SPACE</span>
              <h2>Prepare with confidence.</h2>
              <p>
                Create and organize question papers in a private space built
                for focused learning.
              </p>
            </div>
            <div className="auth-feature">
              <span aria-hidden="true">✓</span>
              <p><strong>Private by design</strong><br />Your account keeps your workspace yours.</p>
            </div>
            <span className="auth-brand-orbit auth-brand-orbit-one" aria-hidden="true" />
            <span className="auth-brand-orbit auth-brand-orbit-two" aria-hidden="true" />
          </div>

          <div className="auth-form-panel">
            <span className="eyebrow">QUESTION PAPER VAULT</span>
            <h1>{isRegistering ? 'Create your account' : 'Welcome back'}</h1>
            <p className="auth-intro">
              {isRegistering
                ? 'Register to get started with your secure paper workspace.'
                : 'Sign in to continue to your question paper workspace.'}
            </p>

            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {isRegistering && (
                <>
                  <label htmlFor="auth-name">Full name</label>
                  <input
                    id="auth-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    maxLength={80}
                    placeholder="Your name"
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                    required
                  />
                </>
              )}
              <label htmlFor="auth-email">Email address</label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                placeholder="you@example.com"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                required
              />
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                minLength={isRegistering ? 8 : undefined}
                maxLength={128}
                placeholder={isRegistering ? 'At least 8 characters' : 'Enter your password'}
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                required
              />
              {authMessage && (
                <p
                  className={`auth-message ${authMessage.startsWith('Account created.') ? 'auth-message-info' : 'auth-message-error'}`}
                  role={authMessage.startsWith('Account created.') ? 'status' : 'alert'}
                >
                  {authMessage}
                </p>
              )}
              <button
                className="generate-button auth-submit"
                type="submit"
                disabled={isSubmittingAuth}
              >
                {isSubmittingAuth
                  ? isRegistering ? 'Creating account…' : 'Signing in…'
                  : isRegistering ? 'Create account' : 'Sign in'}
              </button>
            </form>

            <p className="auth-switch">
              {isRegistering ? 'Already have an account?' : 'New to Paper Vault?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setAuthMode(isRegistering ? 'login' : 'register')
                  setAuthMessage('')
                }}
              >
                {isRegistering ? 'Sign in' : 'Create an account'}
              </button>
            </p>
            <p className="auth-switch">
              Student? <a href="/audit">View public paper ledger</a>
            </p>
            <p className="auth-security-note">
              <span aria-hidden="true">♢</span> Passwords are securely hashed. Sessions expire after 2 hours.
            </p>
          </div>
        </section>
      </main>
    )
  }

  if (!user.canViewPapers) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-form-panel">
            <span className="eyebrow">ACCOUNT NOT APPROVED</span>
            <h1>Paper access is restricted</h1>
            <p className="auth-intro">
              This account does not have a pre-approved MetaMask wallet. Ask
              the project administrator to add this account and wallet to the
              admin allowlist.
            </p>
            <p className="auth-switch">
              <a href="/audit">View public paper access log</a>
            </p>
            <button className="health-button" type="button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <div className="workspace-layout">
      <aside className="workspace-sidebar">
        <a className="workspace-brand" href="/" aria-label="Paper Vault home">
          <span className="workspace-brand-mark" aria-hidden="true">✦</span>
          <span>Paper Vault<small>SECURE WORKSPACE</small></span>
        </a>
        <span className="sidebar-label">WORKSPACE</span>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          <button
            type="button"
            className={`workspace-nav-item ${activePage === 'generate' ? 'active' : ''}`}
            aria-current={activePage === 'generate' ? 'page' : undefined}
            onClick={() => setActivePage('generate')}
          >
            <span className="nav-item-icon" aria-hidden="true">▤</span>
            <span>{user.canAddQuestions ? 'Paper generator' : 'Scheduled papers'}</span>
            <span className="nav-item-count">{papers.length}</span>
          </button>
          {user.canAddQuestions && (
            <button
              type="button"
              className={`workspace-nav-item ${activePage === 'add' ? 'active' : ''}`}
              aria-current={activePage === 'add' ? 'page' : undefined}
              onClick={() => {
                setActivePage('add')
                setFormMessage('')
              }}
            >
              <span className="nav-item-icon" aria-hidden="true">＋</span>
              <span>Add a question</span>
            </button>
          )}
          <a className="workspace-nav-item" href="/audit">
            <span className="nav-item-icon" aria-hidden="true">◷</span>
            <span>Public access log</span>
            <span className="nav-item-external" aria-hidden="true">↗</span>
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon" aria-hidden="true">◇</span>
          <div>
            <strong>Protected by design</strong>
            <span>Questions stay encrypted until access is approved.</span>
          </div>
        </div>
        <div className="sidebar-profile">
          <span className="profile-avatar" aria-hidden="true">
            {user.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="profile-copy">
            <strong>{user.name}</strong>
            <small>{user.canAddQuestions ? 'Super admin' : 'Approved viewer'}</small>
          </span>
          <span className="profile-status" title="Signed in" />
        </div>
      </aside>
      <main className="app-shell">
        <div className="workspace-topbar">
          <div className="workspace-breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>{activePage === 'generate' ? 'Papers' : 'Question bank'}</strong>
          </div>
          <div className="topbar-actions">
            {user.walletAddress && (
              <span className="wallet-chip" title={user.walletAddress}>
                <span className="wallet-indicator" />
                {shortenAddress(user.walletAddress)}
              </span>
            )}
            <button
              className="theme-toggle"
              type="button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button className="sign-out-button" type="button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      <header className="page-header">
        <div className="page-header-copy">
        <span className="eyebrow">QUESTION PAPER VAULT</span>
        <h1>
          {activePage === 'generate'
            ? user.canAddQuestions
              ? 'Paper generator'
              : 'Paper vault'
            : 'Add a question'}
        </h1>
        <p>
          {activePage === 'generate'
            ? user.canAddQuestions
              ? 'Create a 100-mark paper from your question bank, choose the exam date, and preview it once before release.'
              : 'View scheduled papers and open them only after their scheduled release time.'
            : 'Enter a question in plain text. The backend encrypts it before saving it to your local question bank.'}
        </p>
        </div>
        <span className="page-header-art" aria-hidden="true">✦</span>
      </header>

      {activePage === 'add' && user.canAddQuestions && (
        <section className="form-card" aria-labelledby="add-question-title">
          <div className="form-card-heading">
            <h2 id="add-question-title">New question</h2>
            <span className="form-mark-value">10 marks</span>
          </div>
          <p className="form-hint">
            Question text is encrypted before storage and stays encrypted in
            generated papers. The question ID remains readable. Stored in
            <code> backend/local_db/questions.json</code>. Added by {user.name}.
          </p>
          <form className="question-form" onSubmit={handleAddQuestion}>
            <label htmlFor="question-topic">Topic</label>
            <input
              id="question-topic"
              name="topic"
              type="text"
              maxLength={120}
              placeholder="e.g. Programming Fundamentals"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              required
            />

            <fieldset className="category-fieldset">
              <legend>Also assign to subjects</legend>
              <p className="form-hint">
                The question topic is always included. Select any additional
                subjects this question should be available under.
              </p>
              <div className="category-options">
                {questionCategories.map((category) => (
                  <label className="category-option" key={category.name}>
                    <input
                      type="checkbox"
                      checked={selectedQuestionCategories.includes(category.name)}
                      onChange={(event) =>
                        setSelectedQuestionCategories((current) =>
                          event.target.checked
                            ? [...new Set([...current, category.name])]
                            : current.filter((name) => name !== category.name),
                        )
                      }
                    />
                    <span>{category.name} ({category.count})</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label htmlFor="question-text">Question</label>
            <textarea
              id="question-text"
              name="question"
              rows={5}
              maxLength={5000}
              placeholder="Enter the question in plain text..."
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
              required
            />

            <button
              className="generate-button"
              type="submit"
              disabled={isAddingQuestion}
            >
              {isAddingQuestion ? 'Encrypting and saving…' : 'Encrypt and add question'}
            </button>
          </form>
          {formMessage && (
            <p
              className={`message ${formMessage.includes('added successfully') ? 'success-message' : 'error-message'}`}
              role={formMessage.includes('added successfully') ? 'status' : 'alert'}
            >
              {formMessage}
            </p>
          )}
        </section>
      )}

      {activePage === 'generate' && (
        <>
      <section className="generator-card" aria-labelledby="generator-title">
        <div className="generator-copy">
          <span className="card-icon" aria-hidden="true">✦</span>
          <div>
            <h2 id="generator-title">
              {user.canAddQuestions ? 'Create a scheduled paper' : 'Paper vault'}
            </h2>
            <p>
              {user.canAddQuestions
                ? 'Only the super-admin can generate papers. Viewer access opens 72 hours before the exam.'
                : 'You can see scheduled papers here. Decryption is available only from 72 hours before the exam.'}
            </p>
          </div>
        </div>
        <div className="generator-actions">
          <button
            className="health-button"
            type="button"
            onClick={handleCheckBackend}
            disabled={isCheckingBackend}
          >
            {isCheckingBackend ? 'Checking…' : 'Test backend'}
          </button>
        </div>
      </section>

        {user.canAddQuestions && (
          <form
            className="form-card schedule-card"
            aria-labelledby="paper-details-title"
            onSubmit={(event) => {
              event.preventDefault()
              handleGeneratePaper()
            }}
          >
            <div className="form-card-heading">
              <h2 id="paper-details-title">New paper details</h2>
            </div>
            <p className="form-hint">
              Paper title and topic are stored in plain text and visible to
              approved admins; only question text is encrypted. Viewer access
              opens 72 hours before the exam. The super-admin can open a
              one-time 15-minute preview.
            </p>
            <label className="test-paper-toggle" htmlFor="test-paper-toggle">
              <input
                id="test-paper-toggle"
                type="checkbox"
                checked={isTestPaper}
                onChange={(event) => setIsTestPaper(event.target.checked)}
              />
              <span className="test-paper-toggle-switch" aria-hidden="true" />
              <span className="test-paper-toggle-copy">
                <strong>Create as a test paper</strong>
                <span>
                  Keep encryption and access auditing enabled, but let approved
                  viewers open it immediately. The one-time preview stays unchanged.
                </span>
              </span>
            </label>
            <label className="schedule-label" htmlFor="paper-title-input">
              Paper title
            </label>
            <input
              id="paper-title-input"
              className="schedule-input"
              type="text"
              maxLength={120}
              placeholder="e.g. Midterm Examination"
              value={paperTitle}
              onChange={(event) => setPaperTitle(event.target.value)}
              required
            />
            <label className="schedule-label" htmlFor="paper-topic-input">
              Paper subject
            </label>
            <select
              id="paper-topic-input"
              className="schedule-input"
              value={paperTopic}
              onChange={(event) => setPaperTopic(event.target.value)}
              required
            >
              <option value="">Select a subject</option>
              {questionCategories.map((category) => (
                <option value={category.name} key={category.name}>
                  {category.name} ({category.count} questions)
                </option>
              ))}
            </select>
            {paperTopic &&
              (questionCategories.find((category) => category.name === paperTopic)?.count ?? 0) <
                10 && (
                <p className="form-hint">
                  This subject needs at least 10 questions before a paper can be generated.
                  Add questions and assign them to this subject.
                </p>
              )}
            <label className="schedule-label" htmlFor="exam-date-time">
              Exam date and time
            </label>
            <input
              id="exam-date-time"
              className="schedule-input"
              type="datetime-local"
              value={examDateTime}
              onChange={(event) => setExamDateTime(event.target.value)}
              required
            />
            <button
              className="generate-button"
              type="submit"
              disabled={
                isGenerating ||
                !paperTitle.trim() ||
                !paperTopic ||
                (questionCategories.find((category) => category.name === paperTopic)?.count ?? 0) < 10 ||
                !examDateTime
              }
            >
              {isGenerating ? 'Generating paper…' : 'Generate 100-mark paper'}
            </button>
          </form>
      )}

      {backendStatus && (
        <p
          className={`message ${backendStatus === 'Backend and Sepolia vault are configured.' ? 'success-message' : 'error-message'}`}
          role="status"
        >
          {backendStatus}
        </p>
      )}

      {error && (
        <p className="message error-message" role="alert">
          {error}
        </p>
      )}

      <section className="paper-archive" aria-labelledby="saved-papers-title">
        <div className="paper-archive-heading">
          <div>
            <span className="eyebrow">SAVED PAPERS</span>
            <h2 id="saved-papers-title">Scheduled papers</h2>
          </div>
          <span>{papers.length} paper{papers.length === 1 ? '' : 's'}</span>
        </div>
        {papers.length === 0 ? (
          <p>No scheduled papers have been created yet.</p>
        ) : (
          <div className="paper-archive-list">
            {papers.map((savedPaper) => {
              const isSelected = paper?.paperId === savedPaper.paperId
              const isOpen = isSelected && isPaperOpen
              const releaseTime = Date.parse(savedPaper.releaseAt)
              const isReleased =
                savedPaper.isTestPaper ||
                (Number.isFinite(releaseTime) && currentTime >= releaseTime)
              const previewExpiresAt = Date.parse(savedPaper.previewExpiresAt)
              const hasActivePreview =
                savedPaper.previewUsed &&
                Number.isFinite(previewExpiresAt) &&
                currentTime < previewExpiresAt
              const canPreview =
                user.canAddQuestions &&
                !isReleased &&
                (!savedPaper.previewUsed || hasActivePreview)
              const canOpen = isReleased || canPreview
              const isActionDisabled = isLoggingAccess || (!isOpen && !canOpen)
              const releaseStatus = isReleased
                ? savedPaper.isTestPaper
                  ? 'Test paper — available immediately'
                  : 'Available to view'
                : user.canAddQuestions && canPreview
                  ? savedPaper.previewUsed
                    ? 'Continue your 15-minute preview'
                    : `One-time preview available · Opens for viewers ${new Date(savedPaper.releaseAt).toLocaleString()}`
                  : user.canAddQuestions && savedPaper.previewUsed
                    ? `Preview expired · Opens ${new Date(savedPaper.releaseAt).toLocaleString()}`
                    : savedPaper.releaseAt
                      ? `Viewer access opens ${new Date(savedPaper.releaseAt).toLocaleString()}`
                      : 'No release schedule'

              return (
                <article
                  className={`paper-archive-item ${isSelected ? 'selected' : ''} ${isOpen ? 'paper-archive-item-open' : ''}`}
                  key={savedPaper.paperId}
                >
                  <div className="paper-archive-card-heading">
                    <div className="paper-archive-card-title">
                      <strong>{savedPaper.title || 'Question paper'}</strong>
                      <span className="paper-archive-subject">
                        {savedPaper.topic || 'No topic'}
                      </span>
                    </div>
                    <button
                      className="paper-view-button"
                      type="button"
                      aria-label={`${isOpen ? 'Hide' : 'Open'} ${savedPaper.title || 'question paper'}`}
                      aria-pressed={isOpen}
                      aria-expanded={isOpen}
                      aria-controls={`paper-questions-${savedPaper.paperId}`}
                      title={isOpen ? 'Hide paper' : canOpen ? 'Open paper' : releaseStatus}
                      disabled={isActionDisabled}
                      onClick={() => handleTogglePaper(savedPaper)}
                    >
                      {isLoggingAccess && isSelected ? (
                        <span className="paper-view-spinner" aria-hidden="true" />
                      ) : (
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                          <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
                          <circle cx="12" cy="12" r="2.75" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <span className="paper-archive-detail">
                    <span className="paper-archive-detail-label">EXAM</span>
                    <span>{new Date(savedPaper.examAt).toLocaleString()}</span>
                  </span>
                  <span className="paper-archive-status">
                    <span
                      className={`paper-status-dot ${isReleased || canPreview ? 'available' : ''}`}
                      aria-hidden="true"
                    />
                    {releaseStatus}
                  </span>
                  {accessMessage && isSelected && (
                    <p
                      className={`message ${
                        accessMessage === 'Access logged on Sepolia.' ||
                        accessMessage.startsWith('Super-admin preview is open')
                          ? 'success-message'
                          : 'error-message'
                      }`}
                      role={
                        accessMessage === 'Access logged on Sepolia.' ||
                        accessMessage.startsWith('Waiting') ||
                        accessMessage.startsWith('Super-admin preview is open')
                          ? 'status'
                          : 'alert'
                      }
                    >
                      {accessMessage}{' '}
                      {accessTransactionHash && (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${accessTransactionHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction
                        </a>
                      )}
                    </p>
                  )}
                  {isOpen && (
                    <div
                      className="paper-details paper-card-inline"
                      id={`paper-questions-${savedPaper.paperId}`}
                    >
                      <div className="paper-header">
                        <div>
                          <span className="eyebrow">QUESTION PAPER</span>
                          <h2>{paper.title || 'Paper questions'}</h2>
                          {paper.topic && <p className="paper-topic">{paper.topic}</p>}
                        </div>
                        <div className="paper-total">
                          <strong>{paper.totalMarks}</strong>
                          <span>total marks</span>
                        </div>
                      </div>
                      <p className="saved-note">
                        Created by <strong>{paper.createdBy}</strong>
                      </p>
                      <p className="encryption-note">
                        Question text remains encrypted in storage. It is revealed here
                        only after your approved wallet's access transaction is verified.
                      </p>
                      <div className="question-list">
                        {paper.questions?.map((question) => (
                          <article key={question.qid} className="question-item">
                            <div className="question-item-header">
                              <span className="question-topic">{question.topic}</span>
                              <span className="question-marks">{question.marks} marks</span>
                            </div>
                            <div className="question-item-body">
                              <span className="question-meta">{question.qid}</span>
                              <p>{question.question}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
        </>
      )}
      </main>
    </div>
  )
}

export default App
