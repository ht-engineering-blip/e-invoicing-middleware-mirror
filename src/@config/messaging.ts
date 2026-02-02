import { z } from 'zod';
import { handleConfigError } from './errors';
import { DEFAULT_TEMPLATE } from '../@lib/constants';
 

const messagingConfigSchema = z.object({
  mailFrom: z.string().optional().default("HT Invoicing<support@ht-invoicing.dev>"),
  smtpHost: z.string(),
  smtpPort: z.string(),
  smtpUser:  z.string(),
  smtpPassword: z.string(),
  defaultEmailTemplate:  z.string()
});

const parseMessagingConfig = () => {
  try {
    return messagingConfigSchema.parse({
      mailFrom: process.env.MAIL_FROM || 'HT Invoicing<support@ht-invoicing.dev>',
      smtpHost: process.env.SMTP_HOST || 'sandbox.smtp.getharp.io',
      smtpPort: process.env.SMTP_PORT || '2525',
      smtpUser: process.env.SMTP_USER || 'devmail.sandbox',
      smtpPassword: process.env.SMTP_PASS || 'devmail.password',
      defaultEmailTemplate: process.env.DEFAULT_EMAIL_TEMPLATE || DEFAULT_TEMPLATE,
    });
  } catch (error) {
    handleConfigError('app', error);
  }
};

export const messagingConfig = parseMessagingConfig();
