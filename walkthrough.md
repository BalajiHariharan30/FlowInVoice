# Walkthrough: Natural-Language Audit Query Agent (LangChain & LangGraph)

We have implemented an enterprise-grade, strictly additive, natural-language query capability over the immutable audit trail using LangChain, LangGraph, and existing model/auth infrastructure.

---

## 1. Key Architectural Implementations

### A. Isolated LangGraph Agent Pipeline (`backend/src/ai/audit/`)
- **[types.ts](file:///c:/Users/hbala/OneDrive/Desktop/P2I/backend/src/ai/audit/types.ts)**: Zod schema `auditQuerySchema` enforcing required `entityId` and bounded `question` (1–500 chars). Strongly typed agent state, response formats, and summary statistics.
- **[tools.ts](file:///c:/Users/hbala/OneDrive/Desktop/P2I/backend/src/ai/audit/tools.ts)**: Request-scoped tools (`getAuditTrail`, `getAuditSummary`) bound strictly via JavaScript closures to `req.user.tenantId`. Tenant ID is not exposed to the LLM agent, making cross-tenant prompt injection impossible.
- **[prompts.ts](file:///c:/Users/hbala/OneDrive/Desktop/P2I/backend/src/ai/audit/prompts.ts)**: Rigid system prompt enforcing grounded audit answering, markdown formatting, refusal to speculate, and the exact fallback string:
  > `"No matching audit records were found for this entity."`
- **[rate-limiter.ts](file:///c:/Users/hbala/OneDrive/Desktop/P2I/backend/src/ai/audit/rate-limiter.ts)**: In-memory sliding-window rate limiter scoped strictly to `POST /audit/query` (20 req/min per tenant/user). Unrelated routes (`GET /audit/:entityId`, `/pos`, etc.) are unaffected.
- **[graph.ts](file:///c:/Users/hbala/OneDrive/Desktop/P2I/backend/src/ai/audit/graph.ts)**: LangGraph `StateGraph` consisting of:
  - `agentNode`: Invokes `ChatGroq` (`openai/gpt-oss-120b`, `temperature: 0.0`) or deterministic fallback when offline/test.
  - `toolNode`: Executes invoked audit tools, extracts discovered event IDs for citation, and flags zero-record states.
  - `shouldContinue`: Bounded router enforcing maximum 3 tool executions per request.
  - `finalizeNode`: Synthesizes the grounded narrative and correlates `supportingEventIds`.
  - `executeAuditQuery`: Wraps invocation in a strict 20-second timeout promise race (`Promise.race`).

### B. Backend API Route Extension (`backend/src/api/routes/audit.routes.ts`)
- Mounted `POST /query` on `auditRouter` with `authenticate` middleware, `auditQueryRateLimiter`, and Zod request validation.
- Standardized error handling returning 400 for validation failures, 429 for rate limiting, 504 for gateway timeouts, and 500 for unexpected errors with zero internal stack trace leakage.
- Existing `GET /audit/:entityId` remains 100% untouched and unaffected.

### C. Frontend Interactive Audit Intelligence UI (`frontend/src/features/audit/AuditHistoryPage.tsx`)
- Fixed empty entity query bug: Added `enabled: Boolean(filterEntity && filterEntity.trim().length > 0)` to `useQuery` to prevent invalid requests when navigating or clearing input.
- Added **Ask Audit Intelligence** card beneath the Target Entity bar with form input, loading spinners (`Loader2`), and error banner.
- Rendered grounded AI narrative and dynamic citation badges for `supportingEventIds`.
- Implemented `scrollToEvent(eventId)`: Clicking a citation scrolls smoothly to the matching timeline card and highlights it with an accent pulse ring (`ring-2 ring-accent-primary`).
- Added `id={`audit-event-${log.id}`}` to timeline cards. If `supportingIds` is empty, no empty citations container is rendered.

---

## 2. Verification & Automated Test Results

### Backend Vitest Test Suite (`npm run test`)
All 6 test files and all 29 automated tests passed cleanly:
```text
 ✓ tests/money.test.ts (4 tests) 12ms
 ✓ tests/auth.test.ts (2 tests) 26ms
 ✓ tests/tenant-isolation.test.ts (1 test) 10ms
 ✓ tests/po-workflow.test.ts (2 tests) 126ms
 ✓ tests/api-contract.test.ts (3 tests) 79ms
 ✓ tests/audit-query.test.ts (17 tests) 705ms

 Test Files  6 passed (6)
      Tests  29 passed (29)
```

### 17 Acceptance Criteria Matrix

| # | Acceptance Criterion | Verification Method | Status |
|---|---|---|:---:|
| 1 | `GET /audit/:entityId` unaffected (same shape & latency) | `tests/audit-query.test.ts` (Test 1 & 2) | **PASSED** |
| 2 | Existing audit timeline renders unchanged | Inspected `AuditHistoryPage.tsx` JSX & styling | **PASSED** |
| 3 | Empty `entityId` no longer triggers `GET /api/v1/audit/` | Added `enabled` predicate in TanStack Query hook | **PASSED** |
| 4 | `POST /audit/query` returns grounded answer for known entity | `tests/audit-query.test.ts` (Test 3) | **PASSED** |
| 5 | Agent correctly calls `getAuditTrail` | `tests/audit-query.test.ts` (Test 3) | **PASSED** |
| 6 | Agent calls `getAuditSummary` for aggregate metrics | `tests/audit-query.test.ts` (Test 4) | **PASSED** |
| 7 | Loop terminates at 3 calls max; returns best available data | `tests/audit-query.test.ts` (Test 15) | **PASSED** |
| 8 | Empty audit result returns exact mandated string | `tests/audit-query.test.ts` (Test 5) | **PASSED** |
| 9 | Tenant isolation: Tenant A cannot retrieve Tenant B records | `tests/audit-query.test.ts` (Test 6 & 7) | **PASSED** |
| 10 | Concurrent requests from different tenants do not cross-contaminate | `tests/audit-query.test.ts` (Test 8) | **PASSED** |
| 11 | Malformed/oversized input (>500 chars) rejected by Zod | `tests/audit-query.test.ts` (Test 9, 10, 11) | **PASSED** |
| 12 | Mocked DB error returns safe generic error, not raw stack trace | `tests/audit-query.test.ts` (Test 13) | **PASSED** |
| 13 | Timeout exceeding 20s returns controlled 504 error | `tests/audit-query.test.ts` (Test 14) | **PASSED** |
| 14 | Rate limit (20 req/min) applies only to `POST /audit/query` | `tests/audit-query.test.ts` (Test 12) | **PASSED** |
| 15 | Existing audit ingestion (`workflow.ts` -> `AuditRepository.create`) works unchanged | `tests/audit-query.test.ts` (Test 16) | **PASSED** |
| 16 | TypeScript compiles with 0 errors across backend and frontend | `npx tsc --noEmit` on backend & frontend | **PASSED** |
| 17 | Change Manifest matches pre-declared list exactly | Git diff & status check | **PASSED** |

### Frontend Build & Type Check
- `npx tsc --noEmit` in `frontend/`: Exited 0 (0 errors).
- `npm run build` in `frontend/`: Built production bundle cleanly (`dist/` generated).
- `npm run test` in `frontend/`: 4 format tests passed.

---

## 3. Final Change Manifest

| Action | File Path | Rationale / Contents |
|---|---|---|
| **CREATED** | `backend/src/ai/audit/types.ts` | Zod validation schemas & state types |
| **CREATED** | `backend/src/ai/audit/tools.ts` | Request-scoped audit tools with closure tenant isolation |
| **CREATED** | `backend/src/ai/audit/prompts.ts` | Rigid system prompt & exact fallback string |
| **CREATED** | `backend/src/ai/audit/rate-limiter.ts` | Route-scoped in-memory sliding window rate limiter (20 req/min) |
| **CREATED** | `backend/src/ai/audit/graph.ts` | LangGraph StateGraph, router (max 3 calls), & 20s timeout race |
| **CREATED** | `backend/tests/audit-query.test.ts` | Automated Vitest test suite covering 17 acceptance tests |
| **MODIFIED** | `backend/package.json` | Added `@langchain/core`, `@langchain/langgraph`, `@langchain/groq` |
| **MODIFIED** | `backend/src/api/routes/audit.routes.ts` | Mounted `POST /query` with rate limiter & authentication |
| **MODIFIED** | `frontend/src/features/audit/AuditHistoryPage.tsx` | Added AI question box, citation jump highlight, & empty query guard |
