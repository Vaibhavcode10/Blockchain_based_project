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

For the deployed frontend, add `VITE_BACKEND_URL` in the frontend's Vercel project settings with the value `https://blockchain-based-project-delta.vercel.app` (no trailing slash), then redeploy. In the backend's Vercel project, set `FRONTEND_URL` to the frontend's deployed origin (for example, `https://your-frontend.vercel.app`) so browser API requests are allowed. Multiple frontend origins can be comma-separated. Leave these variables empty locally to use the Vite proxy and local frontend origins.

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
