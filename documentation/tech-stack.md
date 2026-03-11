# Technology Stack

## Runtime & Framework

| Component | Technology | Version | Notes |
|-----------|-----------|---------|-------|
| Runtime | **Bun** | ^1.3.9 | Replaces Node.js — faster startup, native TS |
| Web Framework | **Elysia** | latest | Bun-native, TypeScript-first, OpenAPI built-in |
| Language | **TypeScript** | ^5.9.3 | Strict mode, full type safety |
| Database | **MongoDB** | 7.0 (Docker) | Document store for all persistence |
| ODM | **Mongoose** | ^9.1.3 | Schema definitions, query building |

---

## Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `elysia` | latest | HTTP server framework |
| `@elysiajs/openapi` | ^1.4.13 | Auto-generated Swagger / OpenAPI 3.0 docs at `/v1/docs` |
| `@elysiajs/cors` | ^1.4.1 | CORS headers for webhook endpoints |
| `elysia-remote-dts` | ^1.0.3 | Remote TypeScript type definitions (DTS endpoint) |
| `mongoose` | ^9.1.3 | MongoDB ODM — schemas, models, queries |
| `jsonwebtoken` | ^9.0.3 | JWT signing and verification |
| `zod` | ^4.3.5 | Runtime schema validation |
| `axios` | ^1.13.2 | HTTP client for FIRS API and ERP webhooks |
| `nodemailer` | ^7.0.12 | SMTP email delivery |
| `handlebars` | ^4.7.8 | Email template engine |
| `qrcode` | ^1.5.4 | QR code generation for transmitted invoices |
| `agenda` | ^6.2.3 | MongoDB-backed background job scheduler |
| `@agendajs/mongo-backend` | latest | Agenda v6 MongoDB storage backend |
| `agendash` | ^8.2.1 | Web dashboard for monitoring Agenda jobs |
| `express` | ^5.2.1 | Used solely to mount Agendash UI in the worker |
| `firs-einvoicing` | 1.0.13 | Official FIRS e-invoicing SDK (encrypt/decrypt/sign) |
| `uuid` | ^13.0.0 | UUID v4 generation for chain IDs and event IDs |
| `json-spread` | ^1.0.1 | Flattens nested JSON for field-path extraction |
| `@faker-js/faker` | ^10.2.0 | Mock invoice generation in sandbox endpoints |
| `debug` | ^4.4.3 | Debug namespaced logging |

---

## Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.9.3 | TypeScript compiler (`bunx tsc --noEmit`) |
| `bun-types` | latest | Bun global type definitions |
| `@types/jsonwebtoken` | ^9.0.10 | JWT type definitions |
| `@types/nodemailer` | ^7.0.5 | Nodemailer type definitions |
| `@types/qrcode` | ^1.5.6 | QR code type definitions |
| `@types/agenda` | ^4.1.4 | Agenda type definitions |
| `@types/express` | ^5.0.6 | Express type definitions |
| `@types/debug` | ^4.1.12 | Debug type definitions |

---

## Infrastructure (docker-compose.yml)

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `mongodb` | `mongo:7.0` | 27017 | Primary database |
| `redis` | `redis:7-alpine` | 6379 | Cache (configured, optional) |
| `mongo-express` | `mongo-express:latest` | 8081 | MongoDB web UI for development |
| `worker` | `Dockerfile.worker` | 3001 | Job worker + Agendash dashboard |

---

## Build & Deployment

### Dockerfile (API Server — Production)
- Multi-stage build using `bun:1.1`
- `bun build --compile` → single binary (`server`)
- Final image: `gcr.io/distroless/base` (no shell, minimal attack surface)
- Exposes port 3000

### Dockerfile.worker (Job Worker)
- Single-stage build using `bun:1.1`
- Runs `bun run src/worker.ts` directly (no compilation)
- Must retain `node_modules` — Agendash serves static assets from the filesystem at runtime
- Exposes port 3001 (Agendash)

### Scripts

```json
{
  "dev":        "bun run --watch src/index.ts",
  "worker":     "bun run src/worker.ts",
  "worker:dev": "bun run --watch src/worker.ts"
}
```

---

## External Services

| Service | Provider | Protocol | Purpose |
|---------|----------|----------|---------|
| FIRS API | Federal Inland Revenue Service | HTTPS/REST | Invoice submission, IRN, VAT |
| LLM | Azure OpenAI (GPT-4 Turbo) | HTTPS/REST | Dictionary generation |
| Email | SMTP (Harp Sandbox) | SMTP/2525 | Transactional emails |
| MongoDB | Self-hosted / Atlas | MongoDB | Primary database |
| Redis | Self-hosted / Redis Cloud | Redis | Rate limiting / caching |
