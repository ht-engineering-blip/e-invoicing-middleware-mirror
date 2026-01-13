# E-Invoicing Middleware - Technology Stack

## Document Information
- **Version**: 1.0
- **Date**: 2026-01-13
- **Status**: Final
- **Framework**: ElysiaJS with Bun Runtime

---

## Core Technology Stack

### Runtime & Framework
- **Bun** v1.x - JavaScript/TypeScript runtime and package manager
- **ElysiaJS** v1.x - High-performance web framework built for Bun
- **TypeScript** v5.x - Type-safe development

### Database & Caching
- **MongoDB** v7.x - Primary database for multi-tenant data
  - Native driver: `mongodb` npm package
  - Schema validation with TypeScript interfaces
- **Redis** v7.x - Caching and session management
  - Client: `ioredis`
  - Use cases: API rate limiting, webhook retry queues, session storage

### Message Queue
- **BullMQ** - Job queue for async processing
  - Built on Redis
  - Use cases: Webhook delivery, invoice processing, notification sending
  - Retry mechanisms for failed jobs

### Authentication & Security
- **@elysiajs/jwt** - JWT token generation and validation
- **@elysiajs/bearer** - Bearer token authentication
- **bcrypt** or **argon2** - Password hashing
- **nanoid** - Generate unique IDs (tenant IDs, service IDs)
- **crypto** (built-in) - Encryption/decryption for FIRS integration

### API & HTTP
- **@elysiajs/cors** - CORS middleware
- **@elysiajs/swagger** - OpenAPI/Swagger documentation
- **@elysiajs/static** - Static file serving
- **axios** or **undici** - HTTP client for FIRS API calls

### Validation & Schema
- **@elysiajs/t** - Type validation (Elysia's built-in TypeBox)
- **zod** (optional) - Additional runtime validation if needed

### Logging & Monitoring
- **pino** - High-performance JSON logger
- **pino-pretty** - Pretty-print logs in development
- **@sentry/bun** - Error tracking and monitoring
- **prometheus-client** - Metrics collection

### Webhooks & Event Processing
- **BullMQ** - Webhook queue management
- **node-cron** or **bun-cron** - Scheduled tasks (cleanup, reports)

### File Processing
- **qrcode** - QR code generation for invoices
- **pdf-lib** - PDF manipulation if needed
- **sharp** - Image processing for QR codes

### Testing
- **bun:test** - Built-in Bun test runner
- **@elysiajs/eden** - Type-safe API testing
- **mongodb-memory-server** - In-memory MongoDB for testing

### Development Tools
- **tsx** - TypeScript execution (if needed)
- **prettier** - Code formatting
- **eslint** - Linting
- **husky** - Git hooks

---

## Project Structure (Microservices Monorepo)

```
e-invoicing-middleware/
├── apps/
│   ├── api-gateway/              # API Gateway service
│   │   ├── src/
│   │   │   ├── index.ts         # Entry point
│   │   │   ├── routes/          # Route definitions
│   │   │   ├── middlewares/     # Auth, rate limiting, tenant context
│   │   │   └── config/          # Configuration
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── tenant-service/           # Tenant Management Service
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   ├── controllers/
│   │   │   ├── repositories/
│   │   │   ├── models/
│   │   │   └── services/
│   │   └── package.json
│   │
│   ├── transformation-service/   # Invoice Transformation Service
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── transformers/    # ERP-specific transformers
│   │   │   │   ├── sage-x3.ts
│   │   │   │   ├── sage-300.ts
│   │   │   │   ├── sap.ts
│   │   │   │   ├── quickbooks.ts
│   │   │   │   └── zoho.ts
│   │   │   ├── mappers/         # Field mapping logic
│   │   │   └── schemas/         # FIRS schema definitions
│   │   └── package.json
│   │
│   ├── validation-service/       # Invoice Validation Service
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── validators/
│   │   │   ├── auto-fix/        # Auto-fix logic
│   │   │   └── firs-client/     # FIRS API client
│   │   └── package.json
│   │
│   ├── workflow-service/         # Invoice Workflow Service
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── workflows/
│   │   │   │   ├── outbound.ts  # Outbound workflow
│   │   │   │   └── inbound.ts   # Inbound workflow
│   │   │   ├── state-machine/   # Workflow state management
│   │   │   └── orchestrator/    # Workflow orchestration
│   │   └── package.json
│   │
│   ├── webhook-service/          # Webhook Service
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── handlers/        # Webhook handlers
│   │   │   ├── queue/           # BullMQ queue setup
│   │   │   └── retry/           # Retry logic
│   │   └── package.json
│   │
│   ├── integration-service/      # FIRS Integration Service
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── firs-client/     # FIRS API client
│   │   │   ├── encryption/      # Certificate management
│   │   │   └── auth/            # FIRS authentication
│   │   └── package.json
│   │
│   ├── audit-service/            # Audit Service
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── loggers/
│   │   │   └── reporters/       # Compliance reports
│   │   └── package.json
│   │
│   └── notification-service/     # Notification Service
│       ├── src/
│       │   ├── index.ts
│       │   ├── providers/       # Email/SMS providers
│       │   └── templates/       # Notification templates
│       └── package.json
│
├── packages/
│   ├── shared/                   # Shared utilities
│   │   ├── src/
│   │   │   ├── types/           # Shared TypeScript types
│   │   │   ├── constants/       # Constants
│   │   │   ├── utils/           # Utility functions
│   │   │   └── errors/          # Custom error classes
│   │   └── package.json
│   │
│   ├── database/                 # Database package
│   │   ├── src/
│   │   │   ├── mongo/           # MongoDB connection
│   │   │   ├── redis/           # Redis connection
│   │   │   ├── models/          # Mongoose models
│   │   │   └── repositories/    # Repository pattern
│   │   └── package.json
│   │
│   └── logger/                   # Logger package
│       ├── src/
│       │   └── index.ts
│       └── package.json
│
├── config/                       # Configuration files
│   ├── development.json
│   ├── staging.json
│   └── production.json
│
├── docker/                       # Docker configurations
│   ├── Dockerfile.gateway
│   ├── Dockerfile.service
│   └── docker-compose.yml
│
├── scripts/                      # Utility scripts
│   ├── setup-dev.sh
│   ├── migrate.ts
│   └── seed.ts
│
├── tests/                        # Integration tests
│   ├── e2e/
│   └── integration/
│
├── .env.example
├── .gitignore
├── bun.lockb
├── bunfig.toml                   # Bun configuration
├── package.json                  # Root package.json (workspace)
├── tsconfig.json                 # Root TypeScript config
├── REQUIREMENTS.md
├── TECH_STACK.md
└── README.md
```

---

## Microservices Communication

### Service-to-Service Communication
1. **Synchronous (HTTP/REST)**
   - Direct HTTP calls between services
   - Use ElysiaJS's built-in HTTP client or axios
   - Service discovery via environment variables

2. **Asynchronous (Message Queue)**
   - BullMQ for job processing
   - Event-driven architecture
   - Webhook delivery queue

### API Gateway Routing
```typescript
API Gateway (Port 3000)
├── /api/tenants/*          → Tenant Service (Port 3001)
├── /api/transform/*        → Transformation Service (Port 3002)
├── /api/validate/*         → Validation Service (Port 3003)
├── /api/workflow/*         → Workflow Service (Port 3004)
├── /api/webhook/*          → Webhook Service (Port 3005)
├── /api/integration/*      → Integration Service (Port 3006)
├── /api/audit/*            → Audit Service (Port 3007)
└── /api/notifications/*    → Notification Service (Port 3008)
```

---

## ElysiaJS-Specific Patterns

### 1. Plugin Architecture
```typescript
// Tenant context plugin
import { Elysia } from 'elysia';

export const tenantPlugin = new Elysia({ name: 'tenant' })
  .derive(async ({ headers }) => {
    const tenantId = headers['x-tenant-id'];
    // Load tenant from database
    return { tenant };
  });
```

### 2. Middleware Pattern
```typescript
// Rate limiting middleware
import { Elysia } from 'elysia';

export const rateLimitMiddleware = new Elysia()
  .onBeforeHandle(async ({ tenant, redis }) => {
    // Implement rate limiting logic
  });
```

### 3. Type-Safe Routes
```typescript
import { Elysia, t } from 'elysia';

export const invoiceRoutes = new Elysia()
  .post('/invoice/submit', async ({ body, tenant }) => {
    // Handle invoice submission
  }, {
    body: t.Object({
      invoiceNumber: t.String(),
      customerName: t.String(),
      // ... other fields
    })
  });
```

### 4. Error Handling
```typescript
import { Elysia } from 'elysia';

export const errorHandler = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400;
      return { success: false, error: 'Validation error' };
    }
    // Handle other errors
  });
```

---

## Database Schema Design

### Multi-Tenant Isolation Strategy
```typescript
// All collections include businessId for tenant filtering
interface BaseDocument {
  _id: ObjectId;
  businessId: string;        // Tenant isolation
  createdAt: Date;
  updatedAt: Date;
}

// Example: Outbound Invoice
interface OutboundInvoiceDocument extends BaseDocument {
  tenantId: string;
  irn: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  // ... other fields
}
```

### MongoDB Collections
- `tenants` - Tenant configurations
- `outbound_invoices` - Outbound invoices (AR)
- `inbound_invoices` - Inbound invoices (AP)
- `audit_logs` - Audit trail
- `webhook_events` - Webhook delivery logs
- `api_keys` - Tenant API keys
- `onboarding` - Tenant onboarding records

---

## Environment Variables

```env
# Application
NODE_ENV=development
PORT=3000
API_VERSION=v1

# Database
MONGODB_URI=mongodb://localhost:27017/e-invoicing
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRY=24h

# FIRS API
FIRS_API_BASE_URL=https://api.firs.gov.ng
FIRS_TIMEOUT=30000

# Services (for API Gateway)
TENANT_SERVICE_URL=http://localhost:3001
TRANSFORMATION_SERVICE_URL=http://localhost:3002
VALIDATION_SERVICE_URL=http://localhost:3003
WORKFLOW_SERVICE_URL=http://localhost:3004
WEBHOOK_SERVICE_URL=http://localhost:3005
INTEGRATION_SERVICE_URL=http://localhost:3006
AUDIT_SERVICE_URL=http://localhost:3007
NOTIFICATION_SERVICE_URL=http://localhost:3008

# Monitoring
SENTRY_DSN=your-sentry-dsn
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_STANDARD=100
RATE_LIMIT_PREMIUM=1000
RATE_LIMIT_WINDOW=60000
```

---

## Development Workflow

### 1. Install Dependencies
```bash
bun install
```

### 2. Setup Development Environment
```bash
# Copy environment file
cp .env.example .env

# Start MongoDB and Redis (Docker)
docker-compose up -d mongodb redis

# Run database migrations
bun run migrate
```

### 3. Start Development Servers
```bash
# Start all services (with watch mode)
bun run dev

# Or start individual services
bun run dev:gateway
bun run dev:tenant
bun run dev:transformation
# ... etc
```

### 4. Run Tests
```bash
# Run all tests
bun test

# Run specific service tests
bun test --filter tenant-service

# Run with coverage
bun test --coverage
```

---

## Deployment Strategy

### Docker Deployment
- Each microservice has its own Dockerfile
- Docker Compose for local development
- Kubernetes for production (optional)

### CI/CD Pipeline
1. Code push to Git
2. Run tests and linting
3. Build Docker images
4. Deploy to staging
5. Run integration tests
6. Deploy to production (manual approval)

### Monitoring & Observability
- **Sentry** - Error tracking
- **Prometheus** - Metrics collection
- **Grafana** - Metrics visualization
- **Pino** - Structured logging
- **Custom Dashboard** - Invoice transmission monitoring

---

## Performance Optimizations

### 1. Bun-Specific Optimizations
- Use Bun's native APIs where possible
- Leverage Bun's fast startup time
- Use Bun's built-in SQLite for local caching (if needed)

### 2. ElysiaJS Optimizations
- Use plugins for shared functionality
- Implement efficient middleware chains
- Use Eden for type-safe internal service calls

### 3. Database Optimizations
- Proper indexing on `businessId`, `tenantId`, `irn`
- Connection pooling
- Query optimization with projections
- Redis caching for frequently accessed data

### 4. Caching Strategy
- Redis for:
  - Tenant configurations (TTL: 1 hour)
  - FIRS API responses (TTL: 5 minutes)
  - Rate limiting counters
  - Webhook retry queues

---

## Security Best Practices

### 1. Authentication
- API key authentication for tenant API access
- JWT tokens for admin access
- Rotate API keys periodically

### 2. Data Encryption
- Encrypt sensitive fields in MongoDB
- Use TLS for all external communications
- Secure certificate storage for FIRS integration

### 3. Input Validation
- Use ElysiaJS type validation on all endpoints
- Sanitize user inputs
- Validate webhook signatures

### 4. Rate Limiting
- Implement per-tenant rate limiting
- Use Redis for distributed rate limiting
- Different limits per tier (standard/premium/enterprise)

---

## Next Steps

1. ✅ Define technology stack
2. Initialize Bun workspace with microservices structure
3. Set up shared packages (types, database, logger)
4. Implement API Gateway with authentication
5. Build Tenant Management Service
6. Build Invoice Transformation Service
7. Build Invoice Validation Service
8. Build Invoice Workflow Service
9. Build Webhook Service
10. Build Integration Service
11. Build Audit Service
12. Build Notification Service
13. Integration testing
14. Documentation
15. Deployment setup

---

**End of Document**
