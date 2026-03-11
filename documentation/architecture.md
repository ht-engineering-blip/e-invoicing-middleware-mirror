# Architecture

## System Overview

The E-Invoicing Middleware is composed of two independently deployable processes:

1. **API Server** (`src/index.ts`) — Handles all HTTP requests from clients, admins, and ERP systems.
2. **Job Worker** (`src/worker.ts`) — Runs background jobs for invoice processing. Hosts the Agendash dashboard.

Both processes share the same MongoDB instance. The API process enqueues jobs; the worker processes them.

---

## Component Diagram

```mermaid
graph TB
    subgraph Clients
        AD[Admin Dashboard]
        ERP[ERP System]
        FIRS_CLIENT[FIRS Platform]
        WH_SENDER[Webhook Sender]
    end

    subgraph API_SERVER["API Server (Bun + Elysia, port 3000)"]
        AUTH[Auth Module\n/v1/auth]
        TENANTS[Tenant Module\n/v1/tenants]
        WORKFLOW[Workflow Module\n/v1/workflow]
        WEBHOOK[Webhook Module\n/v1/webhook]
        ADMIN[Admin Module\n/v1/admin]
        INVOICING[Invoicing Module\n/v1/workflow/invoices]
    end

    subgraph WORKER["Job Worker (Bun, port 3001)"]
        AGENDA[Agenda Scheduler]
        JOBS[Job Definitions\n9 job types]
        AGENDASH[Agendash UI\nhttp://localhost:3001]
    end

    subgraph MONGODB["MongoDB"]
        COL_TENANTS[(tenants)]
        COL_APIKEYS[(api_keys)]
        COL_OUTBOUND[(outbound_invoices)]
        COL_INBOUND[(inbound_invoices)]
        COL_WEBHOOK[(webhook_events)]
        COL_DICT[(invoice_schema_dictionaries)]
        COL_ROUTING[(event_routing_configs)]
        COL_QUEUE[(job_queue)]
        COL_AUDIT[(audit_logs)]
    end

    subgraph EXTERNAL["External Services"]
        FIRS_API[FIRS API\neivc-k6z6d.ondigitalocean.app]
        LLM[Azure OpenAI\nGPT-4 Turbo]
        SMTP[SMTP\nHarp Sandbox :2525]
    end

    AD -->|x-admin-key| ADMIN
    AD -->|JWT / x-api-key| TENANTS
    ERP -->|x-api-key| WORKFLOW
    FIRS_CLIENT -->|x-webhook-key| WEBHOOK
    WH_SENDER -->|x-webhook-key| WEBHOOK

    AUTH --> COL_TENANTS
    TENANTS --> COL_TENANTS
    TENANTS --> COL_APIKEYS
    WORKFLOW --> COL_OUTBOUND
    WORKFLOW --> COL_INBOUND
    WORKFLOW --> COL_DICT
    WEBHOOK --> COL_WEBHOOK
    WEBHOOK --> COL_ROUTING
    ADMIN --> COL_DICT
    ADMIN --> COL_ROUTING

    WEBHOOK -->|scheduleJobChain| COL_QUEUE
    WORKFLOW -->|scheduleJobChain| COL_QUEUE

    AGENDA -->|poll every 2s| COL_QUEUE
    AGENDA --> JOBS
    JOBS --> COL_OUTBOUND
    JOBS --> COL_INBOUND
    JOBS --> COL_WEBHOOK

    JOBS -->|transmit| FIRS_API
    JOBS -->|sign / QR| FIRS_API
    ADMIN -->|generate dictionary| LLM
    TENANTS -->|welcome / reset| SMTP
```

---

## Module Dependency Graph

```mermaid
graph LR
    subgraph "@lib (shared)"
        MONGO_ADAPTER[mongo adapter]
        FIRS_ADAPTER[firs adapter]
        LLM_ADAPTER[llm adapter]
        CRYPTO[crypto utils]
        QUEUE[agenda queue]
        LOGGER[logger]
        MAILER[mailer]
    end

    AUTH_MOD[auth module] --> MONGO_ADAPTER
    AUTH_MOD --> MAILER

    TENANT_MOD[tenant module] --> MONGO_ADAPTER
    TENANT_MOD --> CRYPTO
    TENANT_MOD --> MAILER
    TENANT_MOD --> FIRS_ADAPTER

    WORKFLOW_MOD[workflow module] --> MONGO_ADAPTER
    WORKFLOW_MOD --> FIRS_ADAPTER
    WORKFLOW_MOD --> LLM_ADAPTER
    WORKFLOW_MOD --> QUEUE

    WEBHOOK_MOD[webhook module] --> MONGO_ADAPTER
    WEBHOOK_MOD --> QUEUE

    ADMIN_MOD[admin module] --> MONGO_ADAPTER
    ADMIN_MOD --> LLM_ADAPTER

    JOB_WORKER[job worker] --> QUEUE
    JOB_WORKER --> WORKFLOW_MOD
    JOB_WORKER --> WEBHOOK_MOD
```

---

## Request Lifecycle

```mermaid
sequenceDiagram
    participant C as Client
    participant E as Elysia (API)
    participant MW as Auth Middleware
    participant SVC as Service Layer
    participant REPO as Repository
    participant DB as MongoDB

    C->>E: HTTP Request
    E->>MW: onBeforeHandle
    MW->>MW: Validate API Key / JWT / Admin Key
    MW->>DB: Look up key hash / tenant
    DB-->>MW: Tenant document
    MW->>E: Set auth context
    E->>SVC: Route handler(auth, params, body)
    SVC->>REPO: Query / mutation
    REPO->>DB: MongoDB operation
    DB-->>REPO: Result
    REPO-->>SVC: Domain object
    SVC-->>E: Response data
    E-->>C: JSON response
```

---

## Deployment Topology

```mermaid
graph TB
    subgraph Docker_Compose["docker-compose"]
        API[API Container\nDockerfile\nport 3000]
        WORKER[Worker Container\nDockerfile.worker\nport 3001]
        MONGO[MongoDB Container\nmongo:7.0\nport 27017]
        REDIS[Redis Container\nredis:7-alpine\nport 6379]
        ME[mongo-express\nport 8081]
    end

    API --> MONGO
    WORKER --> MONGO
    ME --> MONGO
    API -.->|optional| REDIS
```

---

## Data Flow — Outbound Invoice

```mermaid
flowchart LR
    ERP_SYS[ERP System] -->|POST /v1/workflow/outbound| API_SVC[API Server]
    API_SVC -->|Store OutboundInvoice| DB[(MongoDB)]
    API_SVC -->|Enqueue job chain| JQ[(job_queue)]
    JQ -->|Poll| WORKER[Job Worker]
    WORKER --> T1[transform]
    T1 --> T2[validate]
    T2 --> T3[sign]
    T3 --> T4[generate-irn]
    T4 --> T5[transmit]
    T5 -->|POST invoice| FIRS_API[FIRS API]
    FIRS_API -->|IRN + acknowledgment| T5
    T5 --> T6[confirm-status]
    T6 --> T7[complete-outbound]
    T7 -->|Mark DELIVERED| DB
```

---

## Data Flow — Inbound Webhook

```mermaid
flowchart LR
    SRC[Webhook Sender] -->|POST /webhook/inbound/:path| WH[Webhook Handler]
    WH -->|Verify x-webhook-key| WH
    WH -->|Idempotency check| DB[(MongoDB)]
    WH -->|Store WebhookEvent| DB
    WH -->|SSE push| LISTENER[SSE Listener\n/webhook/listen/:path]
    WH -->|Resolve routing rules| DB
    WH -->|scheduleJobChain| JQ[(job_queue)]
    JQ -->|Poll| WORKER[Job Worker]
    WORKER -->|Execute actions| FIRS_API[FIRS API]
    WORKER -->|Update webhook status| DB
```
