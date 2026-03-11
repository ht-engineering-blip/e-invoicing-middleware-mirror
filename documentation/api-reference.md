# API Reference

**Base URL**: `http://localhost:3000` (configurable via `APP_PORT`)
**API Version prefix**: `/v1`
**OpenAPI / Swagger UI**: `GET /v1/docs`

All responses follow this envelope:

```json
{ "success": true|false, "data": {}, "error": "string", "message": "string" }
```

Pagination responses add:
```json
{ "success": true, "data": [], "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 } }
```

---

## Authentication Headers

| Header | Used For |
|--------|---------|
| `x-admin-key` | Admin endpoints |
| `x-api-key` | Tenant API access |
| `Authorization: Bearer <jwt>` | Tenant / team member JWT |
| `x-webhook-key` | Inbound webhook signature verification |
| `x-idempotency-key` | Optional idempotency for webhook events |

---

## Health Check

| Method | Path | Auth | Response |
|--------|------|------|---------|
| GET | `/` | None | `{ success, message, version, apiVersion }` |

---

## Auth Routes — `/v1/auth`

### `POST /v1/auth`
Tenant email/password login.

**Body**:
```json
{ "email": "tenant@company.com", "password": "secret" }
```
**Response**:
```json
{
  "success": true,
  "token": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": "24h",
  "tenant": { "tenantId": "...", "businessName": "...", "status": "active" }
}
```

---

### `POST /v1/auth/team-member`
Team member login.

**Body**: `{ "email", "password" }`
**Response**: `{ "success", "token", "user": { "userId", "email", "role", "tenantId" } }`

---

### `POST /v1/auth/oauth/firs`
FIRS OAuth — authenticates with FIRS and creates tenant if new.

**Body**: `{ "email", "password", "mock"?: boolean }`
**Response**: `{ "success", "business", "token", "tenantExists": boolean }`

---

### `POST /v1/auth/forgot-password`
Send password reset email.

**Body**: `{ "email" }`
**Response**: `{ "success", "message" }`

---

### `POST /v1/auth/reset-password`
Reset password with a token received by email.

**Body**: `{ "token", "password" }`
**Response**: `{ "success", "message" }`

---

### `GET /v1/auth/validate-reset-token/:token`
Check if a password reset token is still valid.

**Response**: `{ "success", "valid": boolean, "email": "..." }`

---

### `GET /v1/auth/me`
**Auth**: JWT / API key
Return the currently authenticated identity.

**Response**: `{ "success", "data": { "type": "tenant"|"team_member", "id", "businessName", "email", ... } }`

---

### `POST /v1/auth/set-password`
**Auth**: Set-password JWT (from activation email)
Set account password for first login.

**Body**: `{ "password" }`
**Response**: `{ "success", "token", "expiresIn" }`

---

### `POST /v1/auth/refresh`
**Auth**: JWT
Refresh an expiring JWT token.

**Response**: `{ "success", "token", "expiresIn" }`

---

## Tenant Routes — `/v1/tenants`

### `POST /v1/tenants`
**Auth**: `x-admin-key`
Create a new tenant. Sends a welcome + activation email.

**Body**:
```json
{
  "businessName": "Acme Ltd",
  "tin": "12345678-0001",
  "contactEmail": "admin@acme.com",
  "contactPhone": "+2348012345678",
  "erpSystem": "SAP"
}
```
**Response**: `{ "success", "data": <TenantDocument> }`

---

### `GET /v1/tenants`
**Auth**: `x-admin-key`
List tenants with pagination.

**Query**: `page`, `limit`, `status` (onboarding|active|suspended|inactive)
**Response**: `{ "success", "data": [], "pagination": {} }`

---

### `GET /v1/tenants/:tenantId`
**Auth**: `x-admin-key` or JWT (own tenant)
Get a single tenant's full document.

---

### `PATCH /v1/tenants/:tenantId`
**Auth**: `x-admin-key`
Update tenant fields (businessName, limits, features, etc.).

---

### `POST /v1/tenants/:tenantId/activate`
**Auth**: `x-admin-key`
Set tenant status to `active`.

---

### `POST /v1/tenants/:tenantId/suspend`
**Auth**: `x-admin-key`
Set tenant status to `suspended`.

---

### `DELETE /v1/tenants/:tenantId`
**Auth**: `x-admin-key`
Permanently delete tenant and all related data.

---

### `POST /v1/tenants/:tenantId/api-keys`
**Auth**: JWT
Create an API key for the tenant.

**Body**: `{ "name", "description"?, "expiresAt"? }`
**Response**:
```json
{
  "success": true,
  "data": {
    "key": "eim_xxxxxxxxxxxx",
    "keyId": "...",
    "keyPrefix": "eim_xxxx",
    "name": "Production Key",
    "expiresAt": null
  },
  "warning": "Store this key now — it will never be shown again."
}
```

---

### `GET /v1/tenants/:tenantId/api-keys`
**Auth**: JWT
List all API keys for a tenant (hashed — plaintext not returned).

---

### `DELETE /v1/tenants/:tenantId/api-keys/:keyId`
**Auth**: JWT
Revoke an API key.

**Body**: `{ "reason"? }`

---

### `POST /v1/tenants/:tenantId/api-keys/:keyId/rotate`
**Auth**: JWT
Revoke an existing key and create a new one.

**Body**: `{ "reason"?, "sendEmail"?: boolean }`
**Response**: `{ "success", "data": { newKey } }`

---

### `GET /v1/tenants/api-keys`
**Auth**: `x-admin-key`
List all API keys across all tenants.

**Query**: `page`, `limit`, `status`, `tenantId`

---

### `PUT /v1/tenants/:tenantId/erp-sync`
**Auth**: JWT
Configure the ERP system that the tenant pulls invoices from.

**Body**:
```json
{
  "name": "SAP Production",
  "method": "GET",
  "baseUrl": "https://sap.example.com",
  "endpoint": "/api/invoices",
  "auth": { "type": "bearer", "token": "..." },
  "payloadTemplate": {}
}
```

---

### `GET /v1/tenants/:tenantId/erp-sync`
**Auth**: JWT
Get the current ERP sync configuration.

---

### `GET /v1/tenants/activate/:token`
**Auth**: None (activation link token)
Validate an activation token and return a one-time set-password token.

**Response**: `{ "success", "data": { "tenantId", "setPasswordToken", "redirectUrl" } }`

---

### `PUT /v1/tenants/:tenantId/credentials`
**Auth**: JWT
Upload FIRS certificate and public key.

**Body**: `{ "certificate": "PEM string", "publicKey": "PEM string" }`

---

### `POST /v1/tenants/:tenantId/webhook/generate`
**Auth**: JWT
Generate a unique webhook URL and HMAC secret for this tenant.

**Response**:
```json
{
  "success": true,
  "data": {
    "webhookUrl": "https://api.example.com/v1/webhook/inbound/cddd16ced2469b0c",
    "webhookSecret": "whs_xxxxx",
    "webhookPath": "cddd16ced2469b0c"
  }
}
```

---

### `POST /v1/tenants/:tenantId/webhook/test`
**Auth**: JWT
Send a test webhook event to validate the endpoint.

**Body**: `{ "testPayload"?: {} }`

---

## Workflow Routes — `/v1/workflow`

### `POST /v1/workflow/outbound`
**Auth**: API key or JWT
Submit an invoice for the full outbound pipeline (transform → validate → sign → generate-IRN → transmit).

**Body**: Raw invoice object from ERP (any format — mapped by schema dictionary)
**Response**:
```json
{
  "status": true,
  "data": {
    "irn": "IRN-...",
    "qrCode": "data:image/png;base64,...",
    "transmitted": true,
    "validationResult": {},
    "signedInvoice": {}
  }
}
```

---

### `POST /v1/workflow/inbound`
**Auth**: API key or JWT
Process an inbound invoice received from FIRS.

**Body**: Raw invoice from FIRS
**Response**: `{ "status", "data": { "qrCode", ... } }`

---

### `POST /v1/workflow/transform`
**Auth**: API key or JWT
Transform a raw ERP invoice into FIRS UBL format using the schema dictionary.

**Body**: `{ "invoice": {}, "source_type": "SAP" }`
**Response**: `{ "success", "data": <transformed UBL invoice> }`

---

### `POST /v1/workflow/transform/dictionary/erp`
**Auth**: API key or JWT (admin-level in practice)
Use LLM to generate an ERP-to-FIRS field mapping from a sample invoice.

**Body**: `{ "erp": "SAP", "invoice": {}, "metadata"?: {} }`
**Response**: `{ "success", "data": { "schema_id", "fields_count", "fields": [] } }`

---

### `POST /v1/workflow/transform/dictionary/firs`
**Auth**: API key or JWT
Generate the canonical FIRS UBL schema from a sample.

**Body**: `{ "invoice": {}, "metadata"?: {} }`

---

## Invoicing Routes — `/v1/workflow/invoices`

Individual step endpoints for fine-grained integration.

### `POST /v1/workflow/invoices/generate-irn`
**Auth**: API key or JWT
Generate an Invoice Reference Number.

**Body**: `{ "invoiceNumber": "INV-001", "issueDate"?: "2024-01-15" }`
**Response**: `{ "success", "data": { "irn": "IRN-..." } }`

---

### `POST /v1/workflow/invoices/transform`
**Auth**: API key or JWT
Transform invoice format.

---

### `POST /v1/workflow/invoices/validate`
**Auth**: API key or JWT
Validate invoice against FIRS schema.

**Response**: `{ "success", "valid": true|false, "errors": [] }`

---

### `POST /v1/workflow/invoices/sign`
**Auth**: API key or JWT
Digitally sign an invoice with the tenant's certificate.

**Response**: `{ "success", "data": <signedInvoice> }`

---

### `POST /v1/workflow/invoices/transmit`
**Auth**: API key or JWT
Send a signed invoice to FIRS.

**Body**: `{ "irn": "IRN-...", "invoice": {} }`
**Response**: `{ "success", "data": { "transmitted", "firsResponse" } }`

---

## Transaction Logs — `/v1/workflow/invoices`

### `GET /v1/workflow/invoices/outbound`
**Auth**: API key or JWT
List outbound invoices with pagination.

**Query**: `page`, `limit`, `status`, `from` (date), `to` (date)
**Response**: `{ "success", "data": [], "pagination": {} }`

---

### `GET /v1/workflow/invoices/inbound`
**Auth**: API key or JWT
List inbound invoices.

---

### `GET /v1/workflow/invoices/outbound/:irn`
**Auth**: API key or JWT
Get a single outbound invoice by IRN.

---

### `GET /v1/workflow/invoices/inbound/:irn`
**Auth**: API key or JWT
Get a single inbound invoice by IRN.

---

## Webhook Routes — `/v1/webhook`

### `POST /v1/webhook/inbound/:webhookPath`
**Auth**: `x-webhook-key` (HMAC-verified against stored `webhookSecretHash`)

Receive an inbound webhook event. Performs idempotency check, stores event, resolves routing rules, schedules job chain.

**Headers**:
- `x-webhook-key`: Required. HMAC key for signature verification.
- `x-idempotency-key`: Optional. If omitted, SHA-256 of `tenantId:eventType:payload` is used.

**Body**:
```json
{
  "eventType": "invoice.received",
  "payload": { "irn": "...", "supplierTIN": "...", ... }
}
```

**Response**:
```json
{
  "success": true,
  "eventId": "evt_xxxx",
  "routing": {
    "matchedRoutes": 1,
    "scheduledActions": ["transform", "validate", "transmit"]
  }
}
```

**Error**: `409 Conflict` if idempotency key already processed (and not failed).

---

### `GET /v1/webhook/listen/:webhookPath`
**Auth**: None
Server-Sent Events stream. Connect to receive real-time events for a specific webhook path.

**Response**: `text/event-stream`

```
event: webhook
data: {"eventId":"evt_xxx","eventType":"invoice.received","payload":{...},"timestamp":"..."}

event: ping
data: {"timestamp":"..."}
```

Events are emitted every time a webhook is received on this path. `ping` events fire every 30 seconds to keep the connection alive.

---

## Admin Routes — `/v1/admin`

**Auth**: All admin routes require `x-admin-key`

### Event Routing

#### `GET /v1/admin/tenants/:tenantId/event-routing`
Get all event routing rules for a tenant, enriched with event and action metadata.

**Response**:
```json
{
  "success": true,
  "data": {
    "tenantId": "...",
    "total": 2,
    "routes": [
      {
        "routeId": "abc123",
        "event": { "id": "invoice.received", "name": "Invoice Received", "category": "inbound", "direction": "inbound" },
        "actions": [{ "id": "transform", "name": "Transform Invoice", "order": 2 }],
        "enabled": true,
        "description": null
      }
    ]
  }
}
```

---

#### `POST /v1/admin/tenants/:tenantId/event-routing/routes`
Add a new routing rule.

**Body**:
```json
{
  "event": "invoice.received",
  "actions": ["transform", "validate", "transmit"],
  "enabled": true,
  "description": "Process inbound invoices"
}
```

---

#### `PATCH /v1/admin/tenants/:tenantId/event-routing/routes/:routeId`
Partially update an existing route.

**Body**: Any subset of `{ event, actions, enabled, description }`

---

#### `DELETE /v1/admin/tenants/:tenantId/event-routing/routes/:routeId`
Remove a single routing rule.

---

#### `PUT /v1/admin/tenants/:tenantId/event-routing`
Replace the entire routing config at once (bulk save from frontend builder).

**Body**: `{ "routes": [{ "event", "actions", "enabled"?, "description"?, "routeId"? }] }`

---

#### `DELETE /v1/admin/tenants/:tenantId/event-routing`
Clear all routing rules for a tenant.

---

### Reference Data

#### `GET /v1/admin/config/reference/events`
List all available invoice event types.

**Query**: `category` (platform|erp|all), `direction` (inbound|outbound|all)
**Response**: `{ "success", "data": [{ "id", "name", "category", "direction", "description" }] }`

---

#### `GET /v1/admin/config/reference/workflow-actions`
List all available workflow actions (sorted by execution order).

**Query**: `category` (outbound|inbound|reporting|all)
**Response**: `{ "success", "data": [{ "id", "name", "order", "category", "description", "endpoint" }] }`

---

### FIRS Dictionary

#### `GET /v1/admin/config/firs-dictionary`
Get the stored FIRS UBL field schema.

---

#### `PUT /v1/admin/config/firs-dictionary`
Regenerate the FIRS dictionary from a sample invoice using LLM.

**Body**: `{ "invoice": {}, "metadata"?: {} }`

---

### Sandbox

#### `POST /v1/admin/sandbox/test-webhook`
Send a test webhook event to a tenant's configured webhook URL.

**Body**: `{ "tenantId", "eventType"?, "payload"? }`

---

#### `POST /v1/admin/sandbox/generate-mock-invoice`
Generate a realistic mock invoice for testing.

**Body**: `{ "tenantId", "erpSystem"? }`
**Response**: `{ "success", "data": <mock invoice> }`
