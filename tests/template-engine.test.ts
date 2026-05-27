import { describe, it, expect } from 'bun:test';
import { templateEngine } from '../src/templates/engine';
import { withTemplate } from '../src/@lib/messaging';
import { omitKeys } from '../src/@lib';

describe('TemplateEngine & HBS Template Suite', () => {
  describe('File-Based Templates', () => {
    it('should correctly render resetPassword template', () => {
      const rendered = templateEngine.render('resetPassword', {
        businessName: 'Acme Corp',
        resetUrl: 'https://acme.corp/reset',
      });

      expect(rendered).toContain('Acme Corp');
      expect(rendered).toContain('https://acme.corp/reset');
      expect(rendered).toContain('Reset Password');
    });

    it('should correctly render newTenants template', () => {
      const rendered = templateEngine.render('newTenants', {
        activationLink: 'https://acme.corp/activate',
      });

      expect(rendered).toContain('Welcome to HT Invoicing');
      expect(rendered).toContain('https://acme.corp/activate');
    });

    it('should throw an error for non-existent templates', () => {
      expect(() => {
        templateEngine.render('doesNotExist');
      }).toThrow('Template not found');
    });
  });

  describe('New Migrated Templates', () => {
    it('should correctly render passwordChanged template', () => {
      const rendered = templateEngine.render('passwordChanged', {
        businessName: 'Acme Corp',
      });

      expect(rendered).toContain('Acme Corp');
      expect(rendered).toContain('Password Changed Successfully');
      expect(rendered).toContain('Your E-Invoicing account password has been changed');
    });

    it('should correctly render apiKeyRotated template', () => {
      const rendered = templateEngine.render('apiKeyRotated', {
        businessName: 'Acme Corp',
        oldKeyName: 'Production Key',
        plainKey: 'env_key_12345',
        newKeyName: 'New Prod Key',
        newKeyPrefix: 'env_key_',
        created: '5/26/2026',
        expires: '5/26/2027',
        reason: 'Periodic rotation policy',
      });

      expect(rendered).toContain('Acme Corp');
      expect(rendered).toContain('Production Key');
      expect(rendered).toContain('env_key_12345');
      expect(rendered).toContain('New Prod Key');
      expect(rendered).toContain('env_key_');
      expect(rendered).toContain('5/26/2026');
      expect(rendered).toContain('5/26/2027');
      expect(rendered).toContain('Periodic rotation policy');
    });

    it('should correctly render teamInvitation template', () => {
      const rendered = templateEngine.render('teamInvitation', {
        firstName: 'John',
        businessName: 'Acme Corp',
        role: 'Admin',
        invitationUrl: 'https://acme.corp/invite/abc',
      });

      expect(rendered).toContain('John');
      expect(rendered).toContain('Acme Corp');
      expect(rendered).toContain('Admin');
      expect(rendered).toContain('https://acme.corp/invite/abc');
    });
  });

  describe('Inline String Template Caching', () => {
    it('should compile and render from string and cache it successfully', () => {
      const source = 'Hello {{name}}!';
      const cacheKey = 'testInlineTemplate';

      const rendered1 = templateEngine.renderInline(cacheKey, source, { name: 'World' });
      expect(rendered1).toBe('Hello World!');

      // Render again using the cache
      const rendered2 = templateEngine.renderInline(cacheKey, source, { name: 'Elysia' });
      expect(rendered2).toBe('Hello Elysia!');
    });
  });

  describe('withTemplate Wrapper Integration', () => {
    it('should wrap a rendered partial within the global email layout structure', () => {
      const renderedPartial = templateEngine.render('passwordChanged', {
        businessName: 'Acme Corp',
      });

      const fullEmail = withTemplate(renderedPartial);

      // Verify layout components
      expect(fullEmail).toContain('data:image/png;base64'); // LOGO
      expect(fullEmail).toContain('Password Changed Successfully'); // Partial content
      expect(fullEmail).toContain('Best regards'); // Footer text
    });
  });

  describe('Omit Sensitive Keys Utility Suite', () => {
    const mockData = {
      tenantId: 'tenant-123',
      businessName: 'Acme Corp',
      password: 'super-secret-password-hash',
      passwordChangedAt: new Date(),
      config: {
        erpSystem: 'FIRS_UBL',
        webhookAuth: 'secret-token-key',
        firsCredentials: {
          clientId: 'client-id-abc',
          publicKey: 'public-key-xyz'
        }
      }
    };

    it('should omit standard sensitive keys recursively by default', () => {
      const sanitized = omitKeys(mockData);

      expect(sanitized.password).toBeUndefined();
      expect(sanitized.passwordChangedAt).toBeUndefined();
      expect(sanitized.tenantId).toBe('tenant-123');
      expect(sanitized.businessName).toBe('Acme Corp');
      expect(sanitized.config.erpSystem).toBe('FIRS_UBL');
      expect(sanitized.config.webhookAuth).toBe('secret-token-key'); // webhookAuth is not in the default list
    });

    it('should omit custom keys when requested', () => {
      const sanitized = omitKeys(mockData, ['webhookAuth', 'clientId']);

      expect(sanitized.config.webhookAuth).toBeUndefined();
      expect(sanitized.config.firsCredentials.clientId).toBeUndefined();
      
      // Kept fields
      expect(sanitized.password).toBe('super-secret-password-hash');
      expect(sanitized.config.firsCredentials.publicKey).toBe('public-key-xyz');
    });

    it('should omit nested dot-notation paths when requested', () => {
      const sanitized = omitKeys(mockData, ['config.firsCredentials.clientId']);

      expect(sanitized.config.firsCredentials.clientId).toBeUndefined();
      
      // Kept fields
      expect(sanitized.config.firsCredentials.publicKey).toBe('public-key-xyz');
      expect(sanitized.config.webhookAuth).toBe('secret-token-key');
      expect(sanitized.tenantId).toBe('tenant-123');
    });

    it('should sanitize arrays of objects recursively', () => {
      const arrayData = [mockData, mockData];
      const sanitizedArray = omitKeys(arrayData);

      expect(sanitizedArray.length).toBe(2);
      expect(sanitizedArray[0].password).toBeUndefined();
      expect(sanitizedArray[1].password).toBeUndefined();
      expect(sanitizedArray[0].tenantId).toBe('tenant-123');
    });
  });
});
