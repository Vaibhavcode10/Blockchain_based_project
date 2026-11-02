# Anti Paper Leak

## Run locally

Create a 32-byte encryption key and put it in the project-root `.env` file as
`QUESTION_ENCRYPTION_KEY=<64-character-hex-key>`. For example, generate a key
locally in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Generate a separate JWT signing secret and add it to the same `.env` file as
`JWT_SECRET=<random-secret-of-at-least-32-characters>`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Keep this key private and backed up securely. Questions encrypted with it cannot
be decrypted if it is lost. The `.env` file is ignored by Git. Keep only a
placeholder in `.env.example`; `dotenv` loads `.env`, not `.env.example`.

Start the Express backend API and Vite frontend in separate terminals from the
project root:

```sh
npm run dev:backend
npm run dev
```

You can also start the backend from its own folder with
`cd backend; npm run dev:backend`. It loads environment settings from the
project-root `.env` either way.

## Backend API

- `GET /api/health` checks that the backend is running.
- `POST /api/auth/register` accepts a name, email, and password (8–128
  characters). Accounts are stored in the Supabase `app_users` table;
  passwords are salted and hashed with scrypt.
- `POST /api/auth/login` accepts an email and password and returns an HS256 JWT
  and the signed-in user's profile. Tokens expire after two hours.
- `GET /api/auth/me` returns the profile for a valid `Authorization: Bearer
  <token>` header.
- `POST /api/questions` requires a valid JWT, accepts a question and topic as
  JSON, encrypts the question with AES-256-GCM, and stores it in
  the Supabase `question_bank` table with `marks: 10`, subject categories, and
  the signed-in user's name as `createdBy`. The question's topic is always one
  of its categories; additional existing subjects can be selected when adding
  a question.
  New questions are stored with AES-256-GCM ciphertext using an `enc:v1:`
  prefix. Legacy `enc:v1:` values that contain base64-encoded plaintext are
  migrated to AES-256-GCM when a paper is generated; older saved papers remain
  readable after access authorization.
- `POST /api/question-papers/generate` requires the super-admin's valid JWT and
  a paper title, subject, and exam date/time. It selects 10 questions worth 10
  marks each, registers the paper on Sepolia, and stores the paper snapshot in
  the Supabase `question_papers` table with its title, subject, encrypted
  questions, exam time, and release time. The title and topic are stored in
  plain text; only question text is encrypted. Viewer access
  opens 72 hours before the scheduled exam. The date/time entered in the
  browser's calendar is interpreted in that device's local timezone and stored
  as UTC.
- `GET /api/question-categories` returns each available subject and the number
  of eligible 10-mark questions assigned to it.
- `GET /api/question-papers` returns paper metadata and schedules to the three
  allowlisted admins, without returning question text.
- `POST /api/question-papers/:paperId/access-authorization` requires an
  allowlisted admin session and issues a short-lived authorization signed by
  the backend wallet for that admin's pre-approved MetaMask address. Before
  the scheduled release, this route only allows the super-admin's one-time
  preview.
- `POST /api/question-papers/:paperId/content` only returns decrypted question
  text after verifying a successful on-chain access event for the same paper,
  app account, and allowlisted wallet, and checking the release schedule. The
  super-admin's preview expires 15 minutes after it is first opened.
- `GET /api/audit/accesses` returns public on-chain access records, resolving
  paper-creation and access records to display names without exposing sign-in
  emails. Access records show successful authorizations, not proof that a paper
  was actually read. Sepolia event history is indexed through Blockscout's
  public Sepolia API and cached in the backend for 30 seconds; the ledger needs
  that explorer API to be reachable.
- Public paper questions are available to anyone exactly 24 hours after the
  scheduled exam time. The `/audit` page lists the papers, creation/access
  ledger, and public release time. The backend enforces the release time before
  returning decrypted questions. Test papers are available immediately so the
  public viewing flow can be tested without waiting; student views are not
  tracked.

Use **Add question** to submit a raw question and topic, then optionally assign
it to additional existing subjects. Each subject's question count appears
beside it in the paper generator. A subject needs at least 10 eligible
questions to generate a 100-mark paper. Only the super-admin can create a
scheduled paper; all three allowlisted admins can see the paper list, while
the two viewer admins can decrypt only after the 72-hour release time. During
development, Vite proxies `/api` requests to the backend.

## Admin wallet allowlist and public audit log

Only accounts listed in `QUESTION_ADMIN_WALLET_BINDINGS` can see and access
papers. Configure it in the project-root `.env` as a JSON object that maps each
admin's sign-in email to that admin's pre-approved MetaMask address. Include the
super-admin and both viewer-only admins. For example:

```env
QUESTION_ADMIN_WALLET_BINDINGS={"admin1@example.com":"0x...","admin2@example.com":"0x...","admin3@example.com":"0x..."}
```

Replace the example emails and addresses with the three accounts and wallet
addresses you control. A wallet address must be unique to one account. The
super-admin is the account configured by `QUESTION_EDITOR_EMAIL` (defaults to
`vaibhahoke.dev1@gmail.com`); only that account can add questions, generate
papers, or preview a paper once for 15 minutes. The other two admins can see
paper metadata but cannot generate or decrypt before the release time. Other
registered accounts cannot access papers.

Paper registration is sent by the backend wallet, and each viewer signs the
separate access transaction with their pre-approved MetaMask account. The app
checks that the connected wallet matches the address mapped to the signed-in
email. The backend additionally signs a short-lived, single-use authorization
that the contract verifies, so a password-only attacker cannot substitute
another wallet or forge another user's audit entry. The backend signer must be
the `admin` of the deployed vault. Keep `PRIVATE_KEY` exclusively in the
project-root `.env` file; it is never sent to the browser.

Admins do not receive or enter a question-decryption key. The AES encryption
key stays on the backend and is shared by the application, not by the admins.
Each person's own app login and allowlisted wallet determine who may request
decryption; access transactions are public on Sepolia. The 15-minute preview
limits the super-admin's display window, but cannot prevent copying,
photographs, or a backend operator with access to the encryption key from
seeing plaintext. The current scheduled release is enforced by the backend,
not by a cryptographic time-lock.

1. Ensure `.env` contains `ALCHEMY_SEPOLIA_URL` and `PRIVATE_KEY` for the
   Sepolia deployer account. The account needs Sepolia ETH for deployment and
   paper-registration transactions. The Hardhat network is pinned to Sepolia
   chain ID `11155111`; deployment will fail if the RPC URL connects elsewhere.
2. From the project root, deploy `QuestionPaperVault`:

   ```sh
   cd backend
   npx hardhat ignition deploy ignition/modules/QuestionPaperVault.ts --network sepolia
   ```

3. Copy the deployed contract address into the project-root `.env` as
   `QUESTION_PAPER_VAULT_ADDRESS=<deployed-address>`, then restart the backend.
4. The super-admin enters a title, topic, and exam date/time to generate the
   paper. For testing, the super-admin can enable **Create as a test paper**:
   question encryption, blockchain registration, and access auditing remain
   enabled, while the two viewer admins can open the questions immediately.
   Otherwise, the two viewer admins can see paper metadata immediately but can
   only open the questions from 72 hours before the exam. The super-admin's
   one-time 15-minute preview remains unchanged. Each access requires that
   admin's approved MetaMask wallet and a Sepolia transaction; each wallet needs
   Sepolia ETH to pay for its transaction.

The contract stores a hash and a numeric identifier, not question text. Each
access event records the paper, viewer wallet, timestamp, and opaque app-account
ID. Neither password nor email is written to the blockchain. The public
`/audit` page resolves the opaque ID to the account's display name using the
Supabase account table and lists the matching Sepolia transaction. Since the
audit page is public, account display names and wallet addresses shown there
are public.

## Supabase setup and local-data migration

1. In the Supabase dashboard, open **SQL Editor**, paste the contents of
  `backend/supabase-schema.sql`, and run it. The schema enables row-level
  security and grants table access only to the backend service role.
2. In **Project Settings → API**, copy the Project URL and a server-only Secret
  key. Put them in the project-root `.env`:

  ```env
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SECRET_KEY=your-server-only-secret-key
  ```

  If your project only provides a legacy `service_role` key, use
  `SUPABASE_SERVICE_ROLE_KEY` instead. Never put either key in frontend code
  or send it to the browser. Keep the existing `QUESTION_ENCRYPTION_KEY`; it
  must remain the same key used for the current encrypted question data.
3. From the project root, run `npm run migrate:db`. The importer uploads the
  question bank, paper archive, latest-paper snapshot, and users if a local
  users file exists. It preserves ciphertext, upgrades legacy/plain question
  text to AES-GCM in the uploaded copy, verifies imported IDs, and is safe to
  rerun. It does not change or delete any local JSON files.
4. Start the backend with `npm run dev:backend`. Normal app reads and writes now
  use Supabase; the frontend continues to call the backend API as before.

Paper metadata remains queryable JSON; question text in the question bank and
paper snapshots is encrypted before it reaches Supabase. User password hashes
are stored in the private `app_users` table.

## Contract tests

Run the vault and Hardhat example tests from the backend folder:

```sh
cd backend
npx hardhat test
```
