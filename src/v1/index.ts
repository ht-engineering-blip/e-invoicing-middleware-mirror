// V1 API routes aggregator
import { Elysia } from 'elysia';
import { authModuleRoutes } from './auth';
import { workflowRoutes } from './workflow';
import { webhookRoutes } from './webhook';
import { webhookEventRoutes } from './webhook/routes/webhook-events.routes';
import { invoicingRoutes } from './invoicing';
import { auditRoutes } from './audit';
import { tenantRoutes, teamPublicRoutes } from './tenants';
import { adminModuleRoutes } from './admin';
import openapi from '@elysiajs/openapi'; 
import qrMgmtRoutes from './invoicing/routes/qr.routes';
import { eventsRoutes } from './events';

export const v1Routes = new Elysia({ prefix: '/v1' })
  .use
  (
    openapi
      ({
        documentation: {
          info: {
            title: 'E-Invoicing Middleware API',
            description: `Middleware for HT Invoicing - NRS SI & APP connection

## WebSocket Real-time Events
To receive real-time workflow updates, connect to the WebSocket endpoint:
- **URL:** \`ws://<host>/v1/events/ws\`

After connecting, send the following JSON message to subscribe to invoice events:
\`\`\`json
{
  "action": "subscribe",
  "topic": "invoice-events"
}
\`\`\`

You will receive updates in the following format:
\`\`\`json
{
  "type": "WORKFLOW_STEP_COMPLETED",
  "data": { "irn": "123...", "step": "VALIDATED" }
}
\`\`\`
`,
            version: '1.0.1',
          },
         
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
              },
              adminKey: {
                type: 'apiKey',
                description: "Admin Key",
                name: "x-admin-key",
                in: "header"
              },
              apiKey: {
                type: 'apiKey',
                description: "API Key",
                name: "x-api-key",
                in: "header"
              }
            }
          }
        },
        path: '/docs',
        scalar:{
          tagsSorter: 'alpha'
        }
      })
  )
  .use(authModuleRoutes)
  .use(tenantRoutes)
  .use(teamPublicRoutes)
  .use(adminModuleRoutes)
  .use(invoicingRoutes)
  .use(workflowRoutes)
  .use(webhookRoutes)
  .use(webhookEventRoutes)
  .use(auditRoutes)
  .use(qrMgmtRoutes)
  .use(eventsRoutes);