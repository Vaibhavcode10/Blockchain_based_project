# Anti Paper Leak

Anti Paper Leak is a web application for creating and managing exam papers with a focus on protecting question content and providing transparent access records.

## Features

- Create and organize questions by subject.
- Generate and schedule exam papers.
- Protect question content with encryption and controlled access.
- Record paper-related activity on a blockchain.
- Review published audit information through the application.

## Technology

- React and Vite
- Node.js and Express
- Supabase
- Solidity and Hardhat

## Run locally

Install the dependencies:

```sh
npm install
```

Configure the backend's required environment values in a local `.env` file, then start the backend and frontend in separate terminals:

```sh
npm run dev:backend
npm run dev
```

Deploy the backend as a Render Web Service from the repository root. Use `npm install` as the build command and `npm run dev:backend` as the start command. Set `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`), `JWT_SECRET` (at least 32 characters), and `QUESTION_ENCRYPTION_KEY` (64 hexadecimal characters) in Render's environment settings. Add blockchain environment values only if those features are enabled. After the frontend is deployed, set `FRONTEND_URL` to its origin (for example, `https://your-frontend.vercel.app`); multiple origins can be comma-separated.

For the frontend deployed separately on Vercel, set `VITE_BACKEND_URL` to the Render backend URL with no trailing slash, then redeploy the frontend. Supabase remains the persistent data store. Leave deployment variables empty locally to use the Vite proxy and local frontend origins.

The backend requires access to the configured database and blockchain services. Keep credentials and private keys out of source control and frontend code.

## Project structure

- `src/` — frontend application
- `backend/` — backend API, database integration, and smart-contract tooling
- `backend/contracts/` — Solidity contracts

## Tests

Run the frontend production build:

```sh
npm run build
```

Run the smart-contract and backend tests from the `backend` directory:

```sh
npx hardhat test
```
