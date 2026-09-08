# PO-to-Invoice Agentic AI SaaS Platform

Production-grade, multi-tenant B2B Purchase-Order-to-Invoice Agentic AI SaaS platform with deterministic financial validation, Agentic RAG over Qdrant, asynchronous BullMQ workflow orchestration, auditability, and strict tenant isolation.

---

## System Architecture

```text
Customer Email / Upload → S3 Storage → Intake Agent → PO Extraction Agent
  → PDF extraction / OCR / Vision fallback → STRUCTURED PO
  → PO Verification Agent (required fields, Decimal.js math checks, duplicate PO check)
  → Extraction valid?
      No + retry exhausted → Human Review Center (stage: extraction)
      Yes → Validation Agent (Agentic RAG)
  → Price check:
      Catalog match? Yes → continue
                     No → Contract RAG (Qdrant vector search + rerank)
                          Policy RAG (variance threshold check)
                          Unresolved → Human Review Center (stage: validation)
  → Commercial validation passed?
      Yes → Invoice Generation Agent (Decimal.js calculations + PDFKit invoice in S3)
  → Invoice Verification Agent (cross-checks invoice ↔ PO, GST numbers, totals, duplicate invoice check)
      Valid?
        No → Human Review Center (stage: invoice)
        Yes → ISSUED INVOICE → Completed Workflow
```

---

## Technology Stack

- **Backend**: Node.js, Express, TypeScript (strict), Zod, Decimal.js, Mongoose, BullMQ, Redis, Qdrant REST client, PDFKit, Pino logger.
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, TanStack Query v5, Axios, React Hook Form, Zod, React Router v6, Recharts, Lucide icons.
- **Data & Vector Stores**: MongoDB Atlas / local MongoDB, Qdrant Vector DB, Amazon S3 / local storage provider, Redis / in-memory runner.
- **Provider Abstractions**:
  - LLM: `Mistral Small` → `Groq Llama 3.3 70B` → `OpenRouter` → `Dev Mock`.
  - Document AI: `Mistral OCR` / `Vision Fallback` / `Dev Mock`.
  - Storage: `Amazon S3` (presigned URLs) / `Dev Mock`.
  - Vector DB: `Qdrant` (strict tenant isolation filtering) / `Dev Mock`.

---

## Public REST API Contract (§B3)

All endpoints strictly follow the contract envelopes:
- **Single Resource**: `{ "id": "...", ... }`
- **List Resource**: `{ "data": [ ... ], "pagination": { "page": 1, "pageSize": 20, "total": 100, "totalPages": 5 } }`
- **Error**: `{ "code": "VALIDATION_ERROR", "message": "...", "details": {}, "requestId": "..." }`
- **PO Upload**: `POST /api/v1/pos` returns `202 Accepted` with `{ "poId": "...", "jobId": "...", "status": "PROCESSING" }`
- **Invoice Download**: `GET /api/v1/invoices/{id}/download` returns `{ "url": "...", "expiresAt": "..." }` (short-lived presigned URL)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Email & password authentication |
| `POST` | `/api/v1/auth/refresh` | Rotate and issue new JWT tokens |
| `GET`  | `/api/v1/auth/me` | Current authenticated user and tenant |
| `GET`  | `/api/v1/dashboard/summary` | KPI cards aggregation |
| `GET`  | `/api/v1/dashboard/analytics` | Pipeline status and volume trend metrics |
| `POST` | `/api/v1/pos` | Upload PO document (returns `202 Accepted`) |
| `GET`  | `/api/v1/pos` | Paginated purchase order list |
| `GET`  | `/api/v1/pos/:poId` | Single purchase order details & original doc URL |
| `GET`  | `/api/v1/pos/:poId/status` | Status polling endpoint |
| `POST` | `/api/v1/pos/:poId/retry` | Manual retry on `FAILED` purchase order |
| `GET`  | `/api/v1/invoices` | Paginated invoices list |
| `GET`  | `/api/v1/invoices/:invoiceId` | Single invoice details |
| `GET`  | `/api/v1/invoices/:invoiceId/download` | Fetch short-lived presigned download URL |
| `GET`  | `/api/v1/reviews` | List human reviews (filterable by `?stage=extraction\|validation\|invoice`) |
| `GET`  | `/api/v1/reviews/:reviewId` | Review details with multi-source evidence array |
| `POST` | `/api/v1/reviews/:reviewId/approve` | Approve exception and resume workflow |
| `POST` | `/api/v1/reviews/:reviewId/reject` | Reject exception with stage-specific outcome |
| `GET`  | `/api/v1/customers` | Customer directory |
| `GET`  | `/api/v1/customers/:customerId` | Customer details with 1-to-N contracts list |
| `POST` | `/api/v1/customers/:customerId/contracts` | Contract ingestion and Qdrant chunk indexing |
| `GET`  | `/api/v1/users` | Read-only user list for v1 |
| `GET`  | `/api/v1/audit/:entityId` | Immutable bounded audit trail |
| `GET`  | `/api/docs/openapi.json` | Authoritative OpenAPI 3.0 specification |

---

## Running Locally

### 1. Backend

```bash
cd backend
npm install
npm test          # Run Vitest test suite
npm run build     # Verify TypeScript compilation
npm run dev       # Start API server on http://localhost:4000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run build     # Compile and build Vite SPA
npm run dev       # Launch frontend on http://localhost:5173
```

### 3. Docker Compose (Full Stack with DBs)

```bash
docker-compose up --build
```
This launches:
- Backend API on port `4000`
- MongoDB on port `27017`
- Redis on port `6379`
- Qdrant on port `6333`
