# Modules

All application code lives under `src/`. Shared infrastructure is under `src/@lib/`. Business logic is split into feature modules under `src/v1/`.

---

## Directory Map

```
src/
├── @config/          Configuration (app, db, jwt, firs, ai, smtp, redis)
├── @lib/             Shared adapters, utilities, and infrastructure
├── middlewares/      Elysia middleware (auth, error handler)
├── v1/               All versioned API modules
│   ├── admin/        Admin-only configuration endpoints
│   ├── auth/         Authentication and session management
│   ├── audit/        Audit log storage (scaffold)
│   ├── invoicing/    Individual invoice operation endpoints
│   ├── tenants/      Tenant CRUD, API keys, onboarding, team
│   ├── webhook/      Inbound webhook reception and SSE streaming
│   └── workflow/     Invoice processing pipeline + async job definitions
├── index.ts          API server entry point
└── worker.ts         Background job worker entry point
```

---

## `src/@lib/` — Shared Libraries

### `adapters/firs/`
FIRS API client. All FIRS HTTP calls go through here.

| Export | Purpose |
|--------|---------|
| `FirsService` | OAuth login, invoice transmission, QR code generation, invoice decryption, user info, VAT reporting |

### `adapters/llm/`
Azure OpenAI client for invoice dictionary generation.

| Export | Purpose |
|--------|---------|
| `LLMService` | `generateInvoiceDictionary(sample, metadata)` — sends a sample invoice to GPT-4 and returns a structured field mapping |
| `prompts.ts` | Prompt templates for dictionary and FIRS schema generation |

### `adapters/mongo/`
MongoDB connection management.

| Export | Purpose |
|--------|---------|
| `connectMongo()` | Connects to MongoDB using config; called on first request |
| `ModelWrapper` | Query builder wrapper — supports `_eq`, `_in`, `_iexact` query operators and handles `businessId` scoping |

### `adapters/rest/`
Base HTTP client.

| Export | Purpose |
|--------|---------|
| `RestClient` | Axios-based base class with interceptors, timeout handling, and error mapping |

### `crypto.ts`
Encryption and decryption utilities.

| Export | Purpose |
|--------|---------|
| `encrypt(data)` | AES-256-GCM symmetric encryption |
| `decrypt(data)` | AES-256-GCM decryption |
| `encryptWithPublicKey(data, pubKey)` | RSA-OAEP public-key encryption (used for IRN embedding) |

### `messaging/`
Email service.

| Export | Purpose |
|--------|---------|
| `Mailer` | `sendMail({ to, subject, html })` — sends email via SMTP using Handlebars templates |

### `queue/agenda.ts`
Agenda job queue singleton.

| Export | Purpose |
|--------|---------|
| `agenda` | Singleton `Agenda` instance connected to MongoDB. Import to schedule (`agenda.now()`) or define (`agenda.define()`) jobs. |

### `logger/`
Structured logger.

| Export | Purpose |
|--------|---------|
| `logger` | `logger.info/warn/error/debug(message, meta?)` |

### `errors/`
Custom error classes.

| Class | Status | Purpose |
|-------|--------|---------|
| `AppError` | configurable | Base error with status code |
| `UnauthorizedError` | 401 | Auth failures |
| `ForbiddenError` | 403 | Access control violations |
| `NotFoundError` | 404 | Missing resources |

---

## `src/middlewares/`

### `auth.ts`
Provides three Elysia plugins:

| Plugin | Header | Validates |
|--------|--------|-----------|
| `requireAdmin` | `x-admin-key` | Matches `DEFAULT_ADMIN_KEY` env var |
| `requireAuth` | `x-api-key` or `Authorization: Bearer` | API key hash lookup or JWT decode |
| `requireJwt` | `Authorization: Bearer` | JWT only |

Sets `ctx.auth` with `{ tenantId, businessId, businessName, type, scopes, isAdmin }`.

---

## `src/v1/admin/` — Admin Module

**Route prefix**: `/v1/admin`
**Auth**: All routes require `x-admin-key`

### Submodules

#### `routes/firs-config.routes.ts`
Manage the global FIRS UBL schema dictionary used for validation.

- `GET /config/firs-dictionary` — retrieve stored FIRS field schema
- `PUT /config/firs-dictionary` — regenerate from a sample invoice (calls LLM)

#### `routes/erp-config.routes.ts`
Manage per-ERP schema dictionaries.

- `POST /config/erp` — create/update dictionary for a specific ERP type
- `GET /config/erp` — list all ERP dictionaries

#### `routes/reference.routes.ts`
Static reference data for frontend builders.

- `GET /config/reference/events` — all invoice event types (filterable by category/direction)
- `GET /config/reference/workflow-actions` — all workflow action definitions (sorted by order)

Constants exported from this file (`INVOICE_EVENT_TYPES`, `WORKFLOW_ACTIONS`) are also consumed by `event-routing.routes.ts` for validation.

#### `routes/event-routing.routes.ts`
Per-tenant event routing configuration — maps event types to ordered workflow action lists.

- `GET /tenants/:tenantId/event-routing` — get all routes (enriched with reference metadata)
- `POST /tenants/:tenantId/event-routing/routes` — add a new route
- `PATCH /tenants/:tenantId/event-routing/routes/:routeId` — update a route
- `DELETE /tenants/:tenantId/event-routing/routes/:routeId` — remove a route
- `PUT /tenants/:tenantId/event-routing` — replace entire config (bulk import)
- `DELETE /tenants/:tenantId/event-routing` — clear all routes

#### `routes/sandbox.routes.ts`
Developer tooling — generates mock invoices for testing.

### Models
- **SystemConfig** (`system_configs`) — keyed config store for FIRS and ERP schema dictionaries
- **EventRouting** (`event_routing_configs`) — per-tenant event→actions mapping

---

## `src/v1/auth/` — Auth Module

**Route prefix**: `/v1/auth`
**Auth**: Most routes are public; `GET /me`, `POST /set-password`, `POST /refresh` require JWT

### Submodules

#### Routes
- `POST /` — Tenant login (email + password)
- `POST /team-member` — Team member login
- `POST /oauth/firs` — FIRS OAuth login (registers business if new)
- `POST /forgot-password` — Send password reset email
- `POST /reset-password` — Reset password with token
- `GET /validate-reset-token/:token` — Validate reset token
- `GET /me` — Get current authenticated identity
- `POST /set-password` — Set password on first activation
- `POST /refresh` — Refresh JWT

#### `services/`
`AuthService` — JWT creation with configurable expiry, password hashing, token validation

#### `utils/access-checks.ts`
Helper guards used in route handlers:
- `onlyAdmin(auth)` — throws if not admin
- `onlyTenant(auth)` — throws if not tenant
- `onlyTeamMember(auth)` — throws if not team member

### Models
- **PasswordReset** — token, email, expiresAt, used flag

---

## `src/v1/tenants/` — Tenant Module

**Route prefix**: `/v1/tenants`
**Auth**: Admin key for CRUD; JWT/API key for self-management

### Submodules

#### `routes/admin.ts`
Full tenant lifecycle management (admin only):
- Create, list, get, update, activate, suspend, delete tenants
- List/create/rotate/revoke API keys across all tenants
- Configure ERP sync settings
- Update onboarding status

#### `routes/onboarding.routes.ts`
Tenant activation and onboarding flows:
- `GET /activate/:token` — validate activation link, return set-password token
- `PUT /:tenantId/credentials` — upload FIRS certificate and public key
- `POST /:tenantId/webhook/generate` — generate webhook URL and secret
- `POST /:tenantId/webhook/test` — send test webhook event

#### `routes/team.routes.ts`
Team member management:
- Create/list/update/remove team members per tenant
- Send invitation emails

#### `routes/settings.routes.ts`
Tenant self-service settings (JWT required)

#### `services/tenant.service.ts`
Core business logic:
- `createTenant()` — validates TIN uniqueness, hashes password, sends activation email
- `generateApiKey()` — creates SHA-256-hashed key, returns plaintext only once
- `rotateApiKey()` — revokes old key, creates new one
- `listAllApiKeys()` — cross-tenant key listing for admin
- `updateErpSyncConfig()` — store ERP pull configuration
- `getTenantByEmail()` — case-insensitive exact email match

### Models
- **Tenant** (`tenants`) — core tenant document
- **ApiKey** (`api_keys`) — hashed API keys with metadata
- **TeamMember** (`team_members`) — team member accounts per tenant
- **TenantOnboarding** (`tenant_onboardings`) — onboarding step tracking

---

## `src/v1/workflow/` — Workflow Module

**Route prefix**: `/v1/workflow`
**Auth**: API key or JWT

This is the largest module. It owns invoice processing in both directions.

### Submodules

#### `routes/outbound.routes.ts`
- `POST /outbound` — Submit invoice for outbound processing (ERP → FIRS)

#### `routes/inbound.routes.ts`
- `POST /inbound` — Trigger inbound invoice processing (FIRS → ERP)

#### `routes/transform.routes.ts`
- `POST /transform` — Transform a raw invoice using the stored schema dictionary
- `POST /transform/dictionary/erp` — Create or update an ERP schema dictionary (LLM-generated)
- `POST /transform/dictionary/firs` — Create or update the FIRS UBL schema dictionary

#### `routes/transaction-logs.routes.ts`
- `GET /invoices/outbound` — List outbound invoice history
- `GET /invoices/inbound` — List inbound invoice history
- `GET /invoices/outbound/:irn` — Get specific outbound invoice
- `GET /invoices/inbound/:irn` — Get specific inbound invoice

#### `services/workflows/outbound.service.ts`
`OutboundWorkflowService`:
- `handleOutboundWorkflow(payload, transmit?)` — orchestrates the full outbound pipeline synchronously (used in direct API calls)

#### `services/workflows/inbound.service.ts`
`InboundWorkflowService`:
- `handleInboundWorkflow(payload)` — orchestrates inbound processing

#### `services/workflows/transform.service.ts`
`TransformWorkflowService`:
- `transformInvoice(payload, authContext, sourceType?)` — maps ERP fields to FIRS UBL using the dictionary
- `upsertErpDictionary(erp, invoice, metadata)` — calls LLM, stores result
- `upsertFirsDictionary(invoice, metadata)` — calls LLM for FIRS schema

#### `jobs/`
See [jobs.md](./jobs.md) for the full background job reference.

#### `utils/transformer/`
- `v2.ts` — Field mapping engine: resolves JSON paths, handles arrays, applies transformations
- `utils.ts` — IRN generation using RSA-OAEP encryption of invoice number + timestamp

### Models
- **OutboundInvoice** (`outbound_invoices`) — invoice + workflow state + QR code
- **InboundInvoice** (`inbound_invoices`) — received invoice + payment status
- **InvoiceSchemaDictionary** (`invoice_schema_dictionaries`) — field mapping rules

---

## `src/v1/webhook/` — Webhook Module

**Route prefix**: `/v1/webhook`
**Auth**: `x-webhook-key` (HMAC signature)

### Submodules

#### `index.ts` — Routes
- `POST /inbound/:webhookPath` — Receive inbound webhook events from FIRS or third parties
- `GET /listen/:webhookPath` — SSE endpoint; subscribe to real-time events for a webhook path

#### Inbound webhook handler logic:
1. Lookup tenant by `webhookPath` stored in `tenant.metadata.webhookPath`
2. Verify `x-webhook-key` matches stored `webhookSecretHash`
3. Check idempotency — `x-idempotency-key` header or SHA-256 hash of `tenantId:eventType:payload`
4. Store `WebhookEvent` with status `PENDING`
5. Push event to SSE bus (`wh:${webhookPath}`)
6. Resolve event routing rules from `event_routing_configs`
7. Call `scheduleJobChain()` (fire-and-forget)
8. Return `{ success, eventId, routing: { matchedRoutes, scheduledActions } }`

#### SSE Bus
Uses Node.js `EventEmitter` keyed by `wh:${webhookPath}`. Multiple clients can subscribe to the same path. The `POST` handler emits; the `GET` handler yields events via async generator.

### Models
- **WebhookEvent** (`webhook_events`) — stored events with delivery tracking

---

## `src/v1/invoicing/` — Invoicing Module

**Route prefix**: `/v1/workflow/invoices`
**Auth**: API key or JWT

Exposes individual workflow steps as separate endpoints for fine-grained control.

| Endpoint | Service method |
|----------|---------------|
| `POST /generate-irn` | `InvoiceWorkflowService.generateIrn()` |
| `POST /transform` | `InvoiceWorkflowService.transformInvoice()` |
| `POST /validate` | `InvoiceWorkflowService.validateInvoice()` |
| `POST /sign` | `InvoiceWorkflowService.signInvoice()` |
| `POST /transmit` | `InvoiceWorkflowService.transmitInvoice()` |

---

## `src/v1/audit/` — Audit Module

Scaffold module — models and repository are present but routes are minimal. Intended for compliance audit trail logging.

- **AuditLog** (`audit_logs`) — records actor, action, resource, before/after changes
