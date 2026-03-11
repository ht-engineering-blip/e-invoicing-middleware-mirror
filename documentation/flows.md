# Activity Flows

Mermaid diagrams for every major operation in the system.

---

## 1. Tenant Onboarding

```mermaid
sequenceDiagram
    actor Admin
    actor Tenant
    participant API as API Server
    participant DB as MongoDB
    participant Email as SMTP

    Admin->>API: POST /v1/tenants\n{businessName, tin, contactEmail, erpSystem}
    API->>DB: Create tenant (status: onboarding)
    API->>DB: Create TenantOnboarding record
    API->>Email: Send welcome email with activation link
    API-->>Admin: 201 { tenantId, status: 'onboarding' }

    Tenant->>API: GET /v1/tenants/activate/:token
    API->>API: Verify activation JWT (12h expiry)
    API->>DB: Mark registration step complete
    API-->>Tenant: { setPasswordToken, redirectUrl }

    Tenant->>API: POST /v1/auth/set-password\n{ password }
    API->>DB: Hash + store password
    API-->>Tenant: { token } (full JWT)

    Tenant->>API: PUT /v1/tenants/:tenantId/credentials\n{ certificate, publicKey }
    API->>DB: Encrypt + store FIRS credentials
    API->>DB: Mark firsProvisioning step complete
    API-->>Tenant: { hasCredentials: true }

    Tenant->>API: PUT /v1/tenants/:tenantId/erp-sync\n{ name, baseUrl, endpoint, auth }
    API->>DB: Store ERP sync config
    API->>DB: Mark erpConfiguration step complete
    API-->>Tenant: { success }

    Tenant->>API: POST /v1/tenants/:tenantId/webhook/generate
    API->>API: Generate webhookPath (16-char hex)\nGenerate webhookSecret\nStore SHA-256 hash
    API->>DB: Save webhookPath + secretHash in tenant.metadata
    API-->>Tenant: { webhookUrl, webhookSecret }

    Tenant->>API: POST /v1/tenants/:tenantId/webhook/test
    API->>DB: Mark testing step complete → status: completed
    API-->>Tenant: { testResult }
```

---

## 2. API Key Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active : POST /api-keys\nReturns plaintext once
    Active --> Revoked : DELETE /api-keys/:keyId\nReason recorded
    Active --> Expired : expiresAt < now
    Active --> Active : POST /api-keys/:keyId/rotate\n(revokes old, creates new)
    Revoked --> [*]
    Expired --> [*]
```

---

## 3. Tenant Authentication (API Key)

```mermaid
flowchart TD
    A[Request with x-api-key] --> B[SHA-256 hash the key]
    B --> C{Find ApiKey by hash}
    C -->|Not found| E1[401 Unauthorized]
    C -->|Found| D{status === 'active'?}
    D -->|No| E2[401 Unauthorized]
    D -->|Yes| F{expiresAt check}
    F -->|Expired| E3[401 Unauthorized]
    F -->|Valid| G{Find Tenant}
    G -->|Not found| E4[401 Unauthorized]
    G -->|Found| H{tenant.status === 'active'?}
    H -->|No| E5[401 Tenant suspended]
    H -->|Yes| I[Set auth context\nUpdate lastUsedAt]
    I --> J[Execute route handler]
```

---

## 4. Outbound Invoice — Full Workflow

```mermaid
flowchart TD
    A[POST /v1/workflow/outbound\nRaw ERP invoice] --> B[OutboundWorkflowService]
    B --> C[Store OutboundInvoice\nstatus: CREATED]

    C --> D{Dictionary exists\nfor erpSystem?}
    D -->|No| D1[Reject: run dictionary setup first]
    D -->|Yes| E[Transform\nMap ERP fields → FIRS UBL]
    E --> F[status: TRANSFORMED]

    F --> G[Validate\nCheck against FIRS schema]
    G --> H{Valid?}
    H -->|No, autoFix=true| I[Attempt auto-fix\nRe-validate up to maxRetries]
    H -->|No, autoFix=false| J[status: FAILED\nReturn errors]
    I --> H
    H -->|Yes| K[status: VALIDATED]

    K --> L[Sign\nRSA-OAEP with tenant certificate]
    L --> M[status: SIGNED]

    M --> N[Generate IRN\nEncrypt invoiceNumber+timestamp]
    N --> O[status: IRN_GENERATED]

    O --> P[Transmit\nPOST to FIRS API]
    P --> Q{FIRS accepted?}
    Q -->|No| R[status: FAILED\nLog FIRS error]
    Q -->|Yes| S[status: TRANSMITTED\nStore FIRS response]

    S --> T[Confirm Status\nVerify FIRS acknowledgment]
    T --> U[Generate QR Code]
    U --> V[status: DELIVERED]

    V --> W{VAT report\nrequired?}
    W -->|Yes| X[Report VAT to FIRS]
    W -->|No| Y[Return response\n{ irn, qrCode }]
    X --> Y
```

---

## 5. Inbound Webhook — Event Processing

```mermaid
sequenceDiagram
    actor Sender
    participant WH as Webhook Handler\nPOST /webhook/inbound/:path
    participant SSE as SSE Bus\nGET /webhook/listen/:path
    participant DB as MongoDB
    participant SCHED as Job Orchestrator
    participant WORKER as Job Worker

    Sender->>WH: POST with x-webhook-key
    WH->>WH: Hash x-webhook-key
    WH->>DB: Lookup tenant by webhookPath
    WH->>WH: Compare hash to stored secretHash
    alt Invalid key
        WH-->>Sender: 401 Unauthorized
    end

    WH->>WH: Compute idempotency key\n(header or SHA-256 of payload)
    WH->>DB: Check existing WebhookEvent
    alt Already processed (not FAILED)
        WH-->>Sender: 409 Conflict
    end

    WH->>DB: Store WebhookEvent (status: PENDING)
    WH->>SSE: Emit event on wh:{webhookPath} bus
    SSE-->>Client: data: { eventId, eventType, payload }

    WH->>DB: Load event_routing_configs for tenant
    WH->>WH: Filter enabled routes matching eventType
    WH->>SCHED: scheduleJobChain()\n[fire-and-forget]
    WH-->>Sender: 200 { eventId, routing }

    SCHED->>DB: Build JobChainData\nLoad tenant for authContext
    SCHED->>DB: agenda.now(firstJobName, data)

    loop For each action in chain
        WORKER->>DB: Poll job_queue
        WORKER->>WORKER: Execute job step
        alt Success
            WORKER->>DB: Merge output into context
            WORKER->>DB: Schedule next job
        else Failure
            WORKER->>DB: Mark WebhookEvent FAILED
            WORKER->>WORKER: Stop chain (do not schedule next)
        end
    end

    WORKER->>DB: Mark WebhookEvent DELIVERED
```

---

## 6. Job Chain Execution

```mermaid
flowchart LR
    START([Webhook received\nor direct API call]) --> ORCH[orchestrator.ts\nscheduleJobChain]

    ORCH --> J1[Job: Step 0\nstepIndex=0]

    J1 -->|chainNext| J2[Job: Step 1\nstepIndex=1]
    J2 -->|chainNext| J3[Job: Step 2\nstepIndex=2]
    J3 -->|chainNext| JN[Job: Step N]
    JN -->|chainNext\n nextIndex >= actions.length| DONE[Mark DELIVERED]

    J1 -->|chainFail| FAIL1[Mark FAILED\nStop chain]
    J2 -->|chainFail| FAIL2[Mark FAILED\nStop chain]
    J3 -->|chainFail| FAIL3[Mark FAILED\nStop chain]

    subgraph Context grows through chain
        CTX1[originalPayload]
        CTX2[+ transformedInvoice]
        CTX3[+ validationResult]
        CTX4[+ signedInvoice + irn]
        CTX5[+ transmissionResult]
    end

    J1 --> CTX1
    J2 --> CTX2
    J3 --> CTX3
```

---

## 7. LLM Dictionary Generation

```mermaid
sequenceDiagram
    actor Admin
    participant API as API Server
    participant LLM as Azure OpenAI GPT-4
    participant DB as MongoDB

    Admin->>API: POST /v1/workflow/transform/dictionary/erp\n{ erp: "SAP", invoice: {...} }
    API->>API: Normalize ERP type\n(uppercase, replace hyphens/spaces with _)
    API->>DB: Check if dictionary exists for ERP type
    API->>LLM: Send prompt with sample invoice\nRequest field mapping JSON
    LLM-->>API: Structured field definitions\n[{ fieldName, path, type, mapping }]
    API->>DB: Upsert InvoiceSchemaDictionary\nschema_id: "ERP-SAP-v1"
    API-->>Admin: { schema_id, fields_count, fields }

    Note over Admin,DB: Dictionary is now used automatically\nfor all SAP invoice transformations
```

---

## 8. Password Reset Flow

```mermaid
sequenceDiagram
    actor User
    participant API as API Server
    participant DB as MongoDB
    participant Email as SMTP

    User->>API: POST /v1/auth/forgot-password\n{ email }
    API->>DB: Find tenant by email (case-insensitive)
    alt Tenant not found
        API-->>User: 200 (no information leak)
    end
    API->>API: Generate reset token (UUID)
    API->>DB: Store PasswordReset { email, token, expiresAt: +1h }
    API->>Email: Send reset link\nhttps://app.example.com/reset?token=xxx
    API-->>User: { success, message: "Check your email" }

    User->>API: GET /v1/auth/validate-reset-token/:token
    API->>DB: Find PasswordReset by token
    API->>API: Check expiresAt > now && !used
    API-->>User: { valid: true, email }

    User->>API: POST /v1/auth/reset-password\n{ token, password }
    API->>DB: Find + validate token
    API->>DB: Hash new password, update tenant
    API->>DB: Mark token as used
    API-->>User: { success, message: "Password updated" }
```

---

## 9. SSE Real-Time Event Streaming

```mermaid
sequenceDiagram
    participant CLIENT as Browser / Dashboard
    participant SSE_EP as GET /webhook/listen/:path
    participant BUS as EventEmitter Bus\n(in-memory)
    participant WH_EP as POST /webhook/inbound/:path
    participant SENDER as Webhook Sender

    CLIENT->>SSE_EP: GET /webhook/listen/abc123\nAccept: text/event-stream
    SSE_EP->>SSE_EP: Register listener on bus\nwh:abc123

    loop Every 30s
        SSE_EP-->>CLIENT: event: ping\ndata: {"timestamp":"..."}
    end

    SENDER->>WH_EP: POST with eventType + payload
    WH_EP->>BUS: emit('wh:abc123', eventData)
    BUS->>SSE_EP: eventData received
    SSE_EP-->>CLIENT: event: webhook\ndata: {"eventId":...,"eventType":...}

    CLIENT->>SSE_EP: Connection closed
    SSE_EP->>BUS: Remove listener
```
