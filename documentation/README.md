# E-Invoicing Middleware — Documentation

> **Version**: 1.0.50 · **API Version**: v1 · **Runtime**: Bun + Elysia

This documentation covers the complete architecture, API surface, data models, authentication patterns, and operational flows of the E-Invoicing Middleware — a backend service that powers an e-invoicing admin platform for connecting ERP systems to the FIRS (Federal Inland Revenue Service) e-invoicing platform.

---

## Contents

| Document | Description |
|----------|-------------|
| [tech-stack.md](./tech-stack.md) | Framework, runtime, all dependencies, and dev tooling |
| [architecture.md](./architecture.md) | System components, deployment topology, Mermaid diagrams |
| [modules.md](./modules.md) | All modules, submodules, and what each one owns |
| [api-reference.md](./api-reference.md) | Every HTTP endpoint — method, path, auth, request/response |
| [auth.md](./auth.md) | All authentication mechanisms and how they work |
| [models.md](./models.md) | Every Mongoose schema and data model |
| [flows.md](./flows.md) | Mermaid activity diagrams for all major operations |
| [environment.md](./environment.md) | All environment variables grouped by service |
| [integrations.md](./integrations.md) | External APIs — FIRS, Azure OpenAI, SMTP |
| [jobs.md](./jobs.md) | Background job system — Agenda, job chain, all job definitions |

---

## Quick Start

```bash
# Install dependencies
bun install

# Run API server (development)
bun run dev

# Run background job worker (development)
bun run worker:dev

# Run both in production
bun run src/index.ts   # API on $APP_PORT (default 3000)
bun run worker         # Worker + Agendash dashboard on $AGENDASH_PORT (default 3001)
```

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Clients                                  │
│   Admin Dashboard  ·  ERP System  ·  FIRS Platform  ·  Webhooks │
└──────────────────────┬─────────────────────────┬────────────────┘
                       │ HTTP                     │ Webhook POST
              ┌────────▼────────┐       ┌─────────▼──────────┐
              │   API Server    │       │  Inbound Webhook   │
              │  Elysia / Bun   │       │  /webhook/inbound  │
              │  Port: 3000     │       │  (HMAC-verified)   │
              └────────┬────────┘       └─────────┬──────────┘
                       │                          │ scheduleJobChain()
                       │          ┌───────────────▼───────────────┐
                       │          │     MongoDB (job_queue)        │
                       │          │     Agenda Job Queue           │
                       │          └───────────────┬───────────────┘
                       │                          │ poll every 2s
                       │          ┌───────────────▼───────────────┐
                       │          │   Job Worker Process           │
                       │          │   bun run worker               │
                       │          │   Agendash UI: Port 3001       │
                       │          └───────────────────────────────┘
                       │
              ┌─────────▼──────────────────────────────────────────┐
              │                   MongoDB                           │
              │  tenants · api_keys · outbound_invoices             │
              │  inbound_invoices · webhook_events                  │
              │  invoice_schema_dictionaries · audit_logs           │
              │  event_routing_configs · job_queue                  │
              └────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Multi-Tenancy
Every resource is scoped to a `tenantId`. A tenant represents one business entity registered on the FIRS platform. Tenants authenticate with API keys or JWT tokens.

### Invoice Workflow
Invoices flow through a configurable pipeline: **transform → validate → sign → generate-IRN → transmit → confirm → complete**. Each step runs as an isolated Agenda job, so failures are isolated and retryable.

### Event-Driven Routing
Inbound webhook events are matched to per-tenant routing rules (`event_routing_configs`). Each rule maps an event type to an ordered list of workflow actions that are executed as a job chain.

### Schema Dictionaries
The system uses an LLM (Azure OpenAI GPT-4) to auto-generate ERP-to-FIRS field mapping dictionaries from a sample invoice. These dictionaries drive the transformation step, making the system configurable per ERP type without code changes.
