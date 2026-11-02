const releaseLeadMilliseconds = 72 * 60 * 60 * 1000
const postExamPublicDelayMilliseconds = 24 * 60 * 60 * 1000
export const previewDurationMilliseconds = 15 * 60 * 1000

export function createPaperSchedule(
  examAtValue,
  now = Date.now(),
  isTestPaper = false,
) {
  if (typeof examAtValue !== 'string') {
    throw new RangeError('Choose the exam date and time before creating the paper.')
  }

  const examAtMilliseconds = Date.parse(examAtValue)
  if (!Number.isFinite(examAtMilliseconds) || examAtMilliseconds <= now) {
    throw new RangeError('The exam date and time must be in the future.')
  }

  return {
    examAt: new Date(examAtMilliseconds).toISOString(),
    releaseAt: new Date(examAtMilliseconds - releaseLeadMilliseconds).toISOString(),
    publicReleaseAt: new Date(
      isTestPaper
        ? now
        : examAtMilliseconds + postExamPublicDelayMilliseconds,
    ).toISOString(),
  }
}

export function getPublicPaperReleaseAt(paper) {
  if (paper?.isTestPaper === true) {
    const releaseAtMilliseconds = Date.parse(
      paper.publicReleaseAt || paper.generatedAt,
    )
    return Number.isFinite(releaseAtMilliseconds)
      ? new Date(releaseAtMilliseconds).toISOString()
      : null
  }

  const examAtMilliseconds = Date.parse(paper?.examAt)
  return Number.isFinite(examAtMilliseconds)
    ? new Date(
        examAtMilliseconds + postExamPublicDelayMilliseconds,
      ).toISOString()
    : null
}

export function isPublicPaperReleased(paper, now = Date.now()) {
  if (paper?.isTestPaper === true) {
    return true
  }

  const publicReleaseAt = getPublicPaperReleaseAt(paper)
  return publicReleaseAt !== null && now >= Date.parse(publicReleaseAt)
}

export function isPaperReleased(paper, now = Date.now()) {
  const releaseAtMilliseconds = Date.parse(paper?.releaseAt)
  return Number.isFinite(releaseAtMilliseconds) && now >= releaseAtMilliseconds
}

export function getPaperAccessError(
  paper,
  { mode, isEditor, userId, viewerAddress, transactionHash, now = Date.now() },
) {
  if (mode === 'preview') {
    if (!isEditor) {
      return {
        status: 403,
        message: 'Only the super-admin can preview a paper early.',
      }
    }
    if (isPaperReleased(paper, now)) {
      return {
        status: 409,
        message: 'The scheduled release has started. Open the paper using viewer access.',
      }
    }

    const preview = paper?.previewSession
    if (preview) {
      if (
        preview.userId !== userId ||
        preview.viewerAddress?.toLowerCase() !== viewerAddress?.toLowerCase() ||
        (transactionHash &&
          preview.transactionHash?.toLowerCase() !== transactionHash.toLowerCase())
      ) {
        return {
          status: 403,
          message: 'This paper’s one-time preview has already been used.',
        }
      }
      if (now >= Date.parse(preview.expiresAt)) {
        return { status: 403, message: 'The 15-minute preview has expired.' }
      }
    }
    return null
  }

  if (mode === 'viewer' && !paper?.isTestPaper && !isPaperReleased(paper, now)) {
    return {
      status: 403,
      message: `Viewer access opens on ${new Date(paper.releaseAt).toLocaleString()}.`,
    }
  }
  return null
}
