# Environment Variables

All environment variables are read through typed config objects in `src/@config/`. The system fails fast at startup if required variables are missing.

Create a `.env` file in the project root based on this reference.

---

## Application

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `APP_PORT` | `3000` | No | Port the API server listens on |
| `HOST` | `0.0.0.0` | No | Bind address |
| `NODE_ENV` | `development` | No | `development` \| `staging` \| `production` \| `test` |
| `API_VERSION` | `v1` | No | API version string (used in routes and responses) |
| `DEFAULT_ADMIN_KEY` | — | **Yes** | Secret for `x-admin-key` authentication. Min 32 chars. |
| `WEB_APP_URL` | — | No | Frontend URL (used in activation email links) |
| `API_BASE_URL` | — | No | Public API base URL (used in webhook URL generation) |

---

## Database

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `MONGODB_URI` | `mongodb://localhost:27017/e-invoicing-middleware` | **Yes** (prod) | Full MongoDB connection string |
| `DB_NAME` | `e-invoicing-middleware` | No | Database name |
| `MONGODB_MAX_POOL_SIZE` | `10` | No | Max connections in pool |
| `MONGODB_MIN_POOL_SIZE` | `2` | No | Min connections in pool |

**Docker Compose extras** (for MongoDB service):

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_INITDB_ROOT_USERNAME` | `admin` | MongoDB root username |
| `MONGO_INITDB_ROOT_PASSWORD` | `admin123` | MongoDB root password |
| `MONGO_INITDB_DATABASE` | `e-invoicing-middleware` | Initial database name |

**MongoDB Express** (for the `mongo-express` admin UI):

| Variable | Description |
|----------|-------------|
| `ME_CONFIG_MONGODB_ADMINUSERNAME` | MongoDB admin username |
| `ME_CONFIG_MONGODB_ADMINPASSWORD` | MongoDB admin password |
| `ME_CONFIG_MONGODB_URL` | Full MongoDB connection URL |
| `ME_CONFIG_BASICAUTH_USERNAME` | mongo-express web UI username |
| `ME_CONFIG_BASICAUTH_PASSWORD` | mongo-express web UI password |
| `ME_CONFIG_MONGODB_SERVER` | MongoDB hostname |
| `ME_CONFIG_MONGODB_PORT` | MongoDB port |

---

## JWT

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `JWT_SECRET` | — | **Yes** | HMAC signing secret. Min 32 chars. |
| `JWT_EXPIRY` | `24h` | No | Token expiry (e.g., `1h`, `7d`) |
| `JWT_ALGORITHM` | `HS256` | No | `HS256` \| `HS384` \| `HS512` \| `RS256` |

---

## FIRS API

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `FIRS_BASE_URL` | — | **Yes** | FIRS API base URL |
| `FIRS_API_KEY` | — | **Yes** | FIRS platform API key |
| `FIRS_API_SECRET` | — | **Yes** | FIRS platform API secret |
| `FIRS_TIMEOUT` | `30000` | No | Request timeout in ms |
| `FIRS_RETRY_ATTEMPTS` | `3` | No | Number of retries on failure |
| `FIRS_RETRY_DELAY` | `1000` | No | Delay between retries in ms |

---

## AI / LLM

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `OPENAI_API_KEY` | — | **Yes** (for dictionary generation) | Azure OpenAI API key |
| `OPENAI_API_ENDPOINT` | — | **Yes** | Full Azure OpenAI deployment endpoint URL |
| `OPENAI_API_MODEL` | `gpt-4-turbo-preview` | No | Model deployment name |

---

## Email / SMTP

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `MAIL_FROM` | — | **Yes** | Sender email address (e.g., `noreply@yourdomain.com`) |
| `SMTP_HOST` | `sandbox.smtp.getharp.io` | No | SMTP server hostname |
| `SMTP_PORT` | `2525` | No | SMTP port |
| `SMTP_USER` | — | **Yes** | SMTP username |
| `SMTP_PASS` | — | **Yes** | SMTP password |
| `DEFAULT_EMAIL_TEMPLATE` | — | No | Default email body HTML (Handlebars) |

---

## Encryption

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `ENCRYPTION_KEY` | — | **Yes** | AES-256-GCM encryption key for sensitive data. Min 32 chars. |

---

## Redis

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | No | Redis connection URL |
| `REDIS_MAX_RETRIES` | `3` | No | Max reconnection attempts |
| `REDIS_ENABLE_READY_CHECK` | `true` | No | Enable ready check on connect |

---

## Worker / Agendash

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `AGENDASH_PORT` | `3001` | No | Port for the Agendash dashboard |

---

## Sample `.env` File

```dotenv
# Application
APP_PORT=3000
HOST=0.0.0.0
NODE_ENV=development
DEFAULT_ADMIN_KEY=your-super-secret-admin-key-min-32-chars
WEB_APP_URL=http://localhost:4000
API_BASE_URL=http://localhost:3000

# Database
MONGODB_URI=mongodb://admin:admin123@localhost:27017/e-invoicing-middleware?authSource=admin
DB_NAME=e-invoicing-middleware

# MongoDB Docker
MONGO_INITDB_ROOT_USERNAME=admin
MONGO_INITDB_ROOT_PASSWORD=admin123
MONGO_INITDB_DATABASE=e-invoicing-middleware
ME_CONFIG_MONGODB_ADMINUSERNAME=admin
ME_CONFIG_MONGODB_ADMINPASSWORD=admin123
ME_CONFIG_MONGODB_URL=mongodb://admin:admin123@mongodb:27017/
ME_CONFIG_BASICAUTH_USERNAME=admin
ME_CONFIG_BASICAUTH_PASSWORD=admin123
ME_CONFIG_MONGODB_SERVER=mongodb
ME_CONFIG_MONGODB_PORT=27017

# JWT
JWT_SECRET=your-jwt-secret-at-least-32-characters-long
JWT_EXPIRY=24h
JWT_ALGORITHM=HS256

# FIRS
FIRS_BASE_URL=https://eivc-k6z6d.ondigitalocean.app/api/v1
FIRS_API_KEY=your-firs-api-key
FIRS_API_SECRET=your-firs-api-secret
FIRS_TIMEOUT=30000
FIRS_RETRY_ATTEMPTS=3
FIRS_RETRY_DELAY=1000

# Azure OpenAI
OPENAI_API_KEY=your-azure-openai-key
OPENAI_API_ENDPOINT=https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2025-01-01-preview
OPENAI_API_MODEL=gpt-4-turbo-preview

# Email
MAIL_FROM=noreply@yourdomain.com
SMTP_HOST=sandbox.smtp.getharp.io
SMTP_PORT=2525
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-pass

# Encryption
ENCRYPTION_KEY=your-aes-256-encryption-key-32-chars

# Worker
AGENDASH_PORT=3001
```
