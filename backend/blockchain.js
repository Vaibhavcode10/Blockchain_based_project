import {
  Contract,
  AbiCoder,
  JsonRpcProvider,
  Wallet,
  getAddress,
  id,
  keccak256,
  getBytes,
  toUtf8Bytes,
} from 'ethers'
import process from 'node:process'

const sepoliaChainId = 11155111n
const paperLedgerCacheMilliseconds = 30_000
let paperLedgerCache
let paperLedgerCacheExpiresAt = 0
let paperLedgerFetch
const vaultAbi = [
  'function admin() view returns (address)',
  'function createPaper(uint256 paperId, string paperHash)',
  'function papers(uint256 paperId) view returns (string paperHash, bool exists)',
  'function accessNonces(address viewer) view returns (uint256)',
  'function accessPaper(uint256 paperId, bytes32 appUserId, uint256 deadline, uint256 nonce, bytes signature)',
  'event PaperCreated(uint256 indexed paperId, string paperHash)',
  'event PaperAccessed(uint256 indexed paperId, address indexed viewer, bytes32 indexed appUserId, uint256 timestamp)',
]

export class BlockchainConfigurationError extends Error {}
export class PaperAccessVerificationError extends Error {}

export function isBlockchainConfigured() {
  return Boolean(
    process.env.ALCHEMY_SEPOLIA_URL &&
      process.env.PRIVATE_KEY &&
      process.env.QUESTION_PAPER_VAULT_ADDRESS,
  )
}

function getReadOnlyBlockchainConfiguration() {
  const rpcUrl = process.env.ALCHEMY_SEPOLIA_URL
  const vaultAddress = process.env.QUESTION_PAPER_VAULT_ADDRESS

  if (!rpcUrl || !vaultAddress) {
    throw new BlockchainConfigurationError(
      'Blockchain is not configured. Set ALCHEMY_SEPOLIA_URL and QUESTION_PAPER_VAULT_ADDRESS in the project .env file.',
    )
  }

  try {
    return {
      rpcUrl,
      vaultAddress: getAddress(vaultAddress),
    }
  } catch {
    throw new BlockchainConfigurationError(
      'QUESTION_PAPER_VAULT_ADDRESS must be a valid deployed contract address.',
    )
  }
}

function getBlockchainConfiguration() {
  const configuration = getReadOnlyBlockchainConfiguration()
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new BlockchainConfigurationError(
      'Blockchain writes are not configured. Set PRIVATE_KEY in the project .env file.',
    )
  }
  return { ...configuration, privateKey }
}

export async function registerPaperOnChain(paper) {
  const { rpcUrl, privateKey, vaultAddress } = getBlockchainConfiguration()
  const provider = new JsonRpcProvider(rpcUrl)
  const network = await provider.getNetwork()
  if (network.chainId !== sepoliaChainId) {
    throw new BlockchainConfigurationError(
      'ALCHEMY_SEPOLIA_URL must connect to the Sepolia test network.',
    )
  }

  const wallet = new Wallet(privateKey, provider)
  const vault = new Contract(vaultAddress, vaultAbi, wallet)
  const admin = await vault.admin()
  if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new BlockchainConfigurationError(
      'The PRIVATE_KEY wallet must be the QuestionPaperVault contract admin.',
    )
  }

  const blockchainPaperId = BigInt(id(paper.paperId))
  const paperHash = keccak256(toUtf8Bytes(JSON.stringify(paper)))
  const transaction = await vault.createPaper(blockchainPaperId, paperHash)
  const receipt = await transaction.wait()
  if (!receipt || receipt.status !== 1) {
    throw new Error('The paper registration transaction did not succeed.')
  }

  return {
    network: 'Sepolia',
    chainId: Number(network.chainId),
    contractAddress: vaultAddress,
    paperId: blockchainPaperId.toString(),
    paperHash,
    transactionHash: receipt.hash,
  }
}

export async function createPaperAccessAuthorization({
  paperId,
  userId,
  viewerAddress,
}) {
  const { rpcUrl, privateKey, vaultAddress } = getBlockchainConfiguration()
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    const network = await provider.getNetwork()
    if (network.chainId !== sepoliaChainId) {
      throw new BlockchainConfigurationError(
        'ALCHEMY_SEPOLIA_URL must connect to the Sepolia test network.',
      )
    }

    const wallet = new Wallet(privateKey, provider)
    const vault = new Contract(vaultAddress, vaultAbi, wallet)
    const admin = await vault.admin()
    if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new BlockchainConfigurationError(
        'The PRIVATE_KEY wallet must be the QuestionPaperVault contract admin.',
      )
    }

    const blockchainPaperId = BigInt(id(paperId))
    const [, exists] = await vault.papers(blockchainPaperId)
    if (!exists) {
      throw new BlockchainConfigurationError(
        'This paper is not registered in the configured QuestionPaperVault.',
      )
    }

    const normalizedViewer = getAddress(viewerAddress)
    const appUserId = id(userId)
    const nonce = await vault.accessNonces(normalizedViewer)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60)
    const encodedAuthorization = AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'uint256', 'address', 'bytes32', 'uint256', 'uint256'],
      [
        network.chainId,
        vaultAddress,
        blockchainPaperId,
        normalizedViewer,
        appUserId,
        deadline,
        nonce,
      ],
    )
    const authorizationHash = keccak256(encodedAuthorization)
    const signature = await wallet.signMessage(getBytes(authorizationHash))

    return {
      appUserId,
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      signature,
    }
  } finally {
    await provider.destroy()
  }
}

export async function getPaperLedgerEvents() {
  if (paperLedgerCache && Date.now() < paperLedgerCacheExpiresAt) {
    return paperLedgerCache
  }

  if (!paperLedgerFetch) {
    paperLedgerFetch = loadPaperLedgerEvents()
  }
  try {
    return await paperLedgerFetch
  } finally {
    paperLedgerFetch = undefined
  }
}

async function loadPaperLedgerEvents() {
  const { rpcUrl, vaultAddress } = getReadOnlyBlockchainConfiguration()
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    const network = await provider.getNetwork()
    if (network.chainId !== sepoliaChainId) {
      throw new BlockchainConfigurationError(
        'ALCHEMY_SEPOLIA_URL must connect to the Sepolia test network.',
      )
    }

    const vault = new Contract(vaultAddress, vaultAbi, provider)
    const configuredStartBlock = Number(
      process.env.QUESTION_PAPER_VAULT_DEPLOYMENT_BLOCK || 0,
    )
    if (!Number.isSafeInteger(configuredStartBlock) || configuredStartBlock < 0) {
      throw new BlockchainConfigurationError(
        'QUESTION_PAPER_VAULT_DEPLOYMENT_BLOCK must be a non-negative block number.',
      )
    }

    const creationEvents = []
    const accessEvents = []
    const logsUrl = new URL(
      `/api/v2/addresses/${vaultAddress}/logs`,
      'https://eth-sepolia.blockscout.com',
    )
    logsUrl.searchParams.set('items_count', '100')
    let nextPageParams
    const seenCursors = new Set()
    do {
      const pageUrl = new URL(logsUrl)
      if (nextPageParams) {
        for (const [key, value] of Object.entries(nextPageParams)) {
          pageUrl.searchParams.set(key, String(value))
        }
      }

      const response = await fetch(pageUrl)
      if (!response.ok) {
        throw new Error(
          `Sepolia explorer returned HTTP ${response.status} while loading paper events.`,
        )
      }
      const page = await response.json()
      if (!Array.isArray(page.items)) {
        throw new Error('Sepolia explorer returned an invalid paper-event page.')
      }

      for (const item of page.items) {
        if (
          !Number.isSafeInteger(item.block_number) ||
          item.block_number < configuredStartBlock ||
          typeof item.block_timestamp !== 'string' ||
          typeof item.transaction_hash !== 'string' ||
          !Array.isArray(item.topics) ||
          typeof item.data !== 'string'
        ) {
          continue
        }
        const event = vault.interface.parseLog({
          address: vaultAddress,
          topics: item.topics.filter((topic) => typeof topic === 'string'),
          data: item.data,
        })
        if (event?.name === 'PaperCreated') {
          creationEvents.push({
            paperId: event.args.paperId.toString(),
            timestamp: Math.floor(Date.parse(item.block_timestamp) / 1000),
            transactionHash: item.transaction_hash,
          })
        } else if (event?.name === 'PaperAccessed') {
          accessEvents.push({
            paperId: event.args.paperId.toString(),
            walletAddress: event.args.viewer,
            appUserId: event.args.appUserId,
            timestamp: Number(event.args.timestamp),
            transactionHash: item.transaction_hash,
          })
        }
      }

      nextPageParams = page.next_page_params
      if (nextPageParams) {
        const cursor = JSON.stringify(nextPageParams)
        if (seenCursors.has(cursor)) {
          throw new Error('Sepolia explorer repeated its paper-event cursor.')
        }
        seenCursors.add(cursor)
      }
    } while (nextPageParams)

    const records = [
      ...creationEvents.map((event) => ({ type: 'created', ...event })),
      ...accessEvents.map((event) => ({ type: 'access', ...event })),
    ]

    paperLedgerCache = records.sort(
      (left, right) => left.timestamp - right.timestamp,
    )
    paperLedgerCacheExpiresAt = Date.now() + paperLedgerCacheMilliseconds
    return paperLedgerCache
  } finally {
    await provider.destroy()
  }
}

export async function verifyPaperAccessTransaction({
  transactionHash,
  paperId,
  userId,
  viewerAddress,
}) {
  const { rpcUrl, vaultAddress } = getReadOnlyBlockchainConfiguration()
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    const network = await provider.getNetwork()
    if (network.chainId !== sepoliaChainId) {
      throw new BlockchainConfigurationError(
        'ALCHEMY_SEPOLIA_URL must connect to the Sepolia test network.',
      )
    }

    const receipt = await provider.getTransactionReceipt(transactionHash)
    if (!receipt || receipt.status !== 1) {
      throw new PaperAccessVerificationError(
        'The Sepolia access transaction is missing or did not succeed.',
      )
    }

    const vault = new Contract(vaultAddress, vaultAbi, provider)
    const eventTopic = vault.interface.getEvent('PaperAccessed').topicHash
    const expectedPaperId = BigInt(id(paperId))
    const expectedUserId = id(userId)
    const expectedViewer = getAddress(viewerAddress).toLowerCase()
    const hasMatchingAccess = receipt.logs.some((log) => {
      if (
        log.address.toLowerCase() !== vaultAddress.toLowerCase() ||
        log.topics[0] !== eventTopic
      ) {
        return false
      }

      const event = vault.interface.parseLog(log)
      return (
        event.args.paperId === expectedPaperId &&
        event.args.viewer.toLowerCase() === expectedViewer &&
        event.args.appUserId.toLowerCase() === expectedUserId.toLowerCase()
      )
    })

    if (!hasMatchingAccess) {
      throw new PaperAccessVerificationError(
        'The transaction does not contain an access record for this account, wallet, and paper.',
      )
    }
  } finally {
    await provider.destroy()
  }
}
