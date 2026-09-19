# Price Tracker Monorepo

A robust, enterprise-grade e-commerce product price and inventory tracking application built for automated data ingestion, real-time price monitoring, and historical price visualization.

## Architecture

This project is organized as a monorepo with two top-level components:

- **`/backend`**: Node.js 20 + Express + TypeScript service
  - Strict TypeScript configuration with ESLint & Prettier
  - Zod-based environment validation on boot with loud crash prevention
  - Pino structured JSON logging with end-to-end `X-Correlation-ID` propagation
  - Centralized error handling and unhandled rejection/exception management
  - Graceful shutdown handling on `SIGTERM` and `SIGINT`
  - Modular layered architecture (`routes`, `services`, `scraper`, `db`, `lib`, `types`, `config`)
- **`/frontend`**: React 18 + Vite + TypeScript web application
  - React Router for client-side routing
  - TanStack Query (React Query) for state management and caching
  - Recharts for historical price trend charting
  - Tailwind CSS for modern, responsive styling
  - Centralized typed API client reading from `VITE_API_BASE_URL`

For reconnaissance analysis of the target mock storefront (`https://demo.inelabteamdev.com/`), see [docs/RECON.md](docs/RECON.md).

## Getting Started

### Prerequisites

- Node.js 20+ (recommended: Node 20 or 22)
- npm 10+

### Setup

1. **Backend Setup**:
   ```bash
   cd backend
   cp .env.example .env
   npm install
   npm run dev
   ```
   The backend will start at `http://localhost:4000` (configurable via `PORT`).
   Verify health: `curl http://localhost:4000/health`

2. **Frontend Setup**:
   ```bash
   cd frontend
   cp .env.example .env
   npm install
   npm run dev
   ```
   The frontend will start at `http://localhost:5173`.

## Environment Variables

### Backend (`/backend/.env`)

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | HTTP port the Express server listens on | `4000` |
| `NODE_ENV` | Application environment (`development`, `production`, `test`) | `development` |
| `CORS_ORIGIN` | Allowed CORS origin URL | `http://localhost:5173` |
| `LOG_LEVEL` | Pino logging level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) | `info` |

### Frontend (`/frontend/.env`)

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Base URL for the backend API | `http://localhost:4000/api` |

## Available Scripts

### Backend
- `npm run dev`: Starts development server with auto-reload using `tsx`.
- `npm run build`: Compiles TypeScript to `dist/`.
- `npm start`: Runs compiled JavaScript from `dist/index.js`.
- `npm run lint`: Checks code with ESLint.
- `npm run format`: Formats code with Prettier.

### Frontend
- `npm run dev`: Starts Vite local dev server with HMR.
- `npm run build`: Compiles TypeScript and builds production assets to `dist/`.
- `npm run preview`: Previews the production build locally.
- `npm run lint`: Checks code with ESLint.
- `npm run format`: Formats code with Prettier.
