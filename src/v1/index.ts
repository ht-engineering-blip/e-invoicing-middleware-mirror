// V1 API routes aggregator
import { Elysia } from 'elysia';
import { authModuleRoutes } from './auth';
import { workflowRoutes } from './workflow';
import { webhookRoutes } from './webhook';
import { invoicingRoutes } from './invoicing';
import { auditRoutes } from './audit';
import { tenantRoutes, teamPublicRoutes } from './tenants';
import { adminModuleRoutes } from './admin';
import openapi from '@elysiajs/openapi'; 

export const v1Routes = new Elysia({ prefix: '/v1' })
  .use
  (
    openapi
      ({
        documentation: {
          info: {
            title: 'E-Invoicing Middleware API',
            description: 'Middleware for HT Invoicing - NRS SI & APP connection',
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
  .use(auditRoutes);