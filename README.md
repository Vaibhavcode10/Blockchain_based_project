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
