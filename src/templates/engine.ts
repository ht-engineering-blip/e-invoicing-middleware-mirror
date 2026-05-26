import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

const EMBEDDED_TEMPLATES: Record<string, string> = {
  resetPassword: `<h2>Reset Your Password</h2>
<p>Hello {{businessName}},</p>
<p>You requested a password reset for your E-Invoicing account.</p>
<p>Click the button below to reset your password:</p>
<a href="{{resetUrl}}" class="cta-button">Reset Password</a>
<p>If you did not request this, please ignore this email.</p>`,

  newTenants: `<p>Welcome to HT Invoicing. Your account has been created successfully.</p>
<p>Click the button below to get started</p>
<a href="{{activationLink}}" class="cta-button">Get Started</a>
<br/>
or copy the link: 
<a href="{{activationLink}}" style="text-decoration: none;">{{activationLink}}</a>`,

  passwordChanged: `<h2>Password Changed Successfully</h2>
<p>Hello {{businessName}},</p>
<p>Your E-Invoicing account password has been changed successfully.</p>
<p>If you did not make this change, please contact support immediately.</p>`,

  apiKeyRotated: `<h2>API Key Rotation Notice</h2>
<p>Hello <b>{{businessName}}</b>,</p>
<p>Your API key "<strong>{{oldKeyName}}</strong>" has been rotated.</p>

<div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
  <h3 style="margin-top: 0;">New API Key:</h3>
  <code style="background-color: #fff; padding: 10px; display: block; font-family: monospace; word-break: break-all;">
    {{plainKey}}
  </code>
</div>

<div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
  <strong>⚠️ Important:</strong>
  <ul style="margin: 10px 0;">
    <li>This is the only time you'll see this key</li>
    <li>Store it securely immediately</li>
    <li>Update your applications with the new key</li>
    <li>The old key has been revoked and will no longer work</li>
  </ul>
</div>

<p><strong>Key Details:</strong></p>
<ul>
  <li><strong>Key Name:</strong> {{newKeyName}}</li>
  <li><strong>Key Prefix:</strong> {{newKeyPrefix}}</li>
  <li><strong>Created:</strong> {{created}}</li>
  {{#if expires}}
  <li><strong>Expires:</strong> {{expires}}</li>
  {{/if}}
</ul>

{{#if reason}}
<p><strong>Rotation Reason:</strong> {{reason}}</p>
{{/if}}

<p>If you did not request this rotation, please contact support immediately.</p>`,

  teamInvitation: `<h2>Team Invitation</h2>
<p>Hello {{firstName}},</p>
<p>You've been invited to join <strong>{{businessName}}</strong> on the E-Invoicing Platform as a {{role}}.</p>
<p>Click the link below to accept the invitation and set up your account:</p>
<a href="{{invitationUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Accept Invitation</a>
<p>This invitation will expire in 7 days.</p>`
};

class TemplateEngine {
  private cache = new Map<string, HandlebarsTemplateDelegate>();
  private templatesDir = import.meta.dir;

  /**
   * Render a Handlebars template dynamically with in-memory caching.
   * Supports local live-reloads, serverless project standard paths, and embedded precompiled fallbacks.
   * 
   * @param templateName - The filename of the template without extension (e.g. 'resetPassword')
   * @param context - The variables to interpolate into the template
   */
  render(templateName: string, context: Record<string, any> = {}): string {
    let compiled = this.cache.get(templateName);

    if (!compiled) {
      let source: string | undefined;

      // 1. Try resolving relative to import.meta.dir (local runtime file system)
      try {
        const localPath = path.join(this.templatesDir, `${templateName}.hbs`);
        if (fs.existsSync(localPath)) {
          source = fs.readFileSync(localPath, 'utf-8');
        }
      } catch (err) {
        // Fall through to other resolution paths
      }

      // 2. Try resolving relative to process.cwd() (serverless Node File Trace root standard)
      if (!source) {
        try {
          const cwdPath = path.join(process.cwd(), 'src', 'templates', `${templateName}.hbs`);
          if (fs.existsSync(cwdPath)) {
            source = fs.readFileSync(cwdPath, 'utf-8');
          }
        } catch (err) {
          // Fall through to embedded templates
        }
      }

      // 3. Fall back to preloaded embedded template strings (absolute serverless protection)
      if (!source) {
        source = EMBEDDED_TEMPLATES[templateName];
      }

      if (!source) {
        throw new Error(`Template not found: ${templateName}`);
      }

      compiled = Handlebars.compile(source);
      this.cache.set(templateName, compiled);
    }

    return compiled(context);
  }

  /**
   * Render an inline template string with in-memory caching.
   * 
   * @param cacheKey - Unique key to cache the compiled template
   * @param source - The raw Handlebars template string
   * @param context - The variables to interpolate into the template
   */
  renderInline(cacheKey: string, source: string, context: Record<string, any> = {}): string {
    let compiled = this.cache.get(cacheKey);

    if (!compiled) {
      compiled = Handlebars.compile(source);
      this.cache.set(cacheKey, compiled);
    }

    return compiled(context);
  }
}

export const templateEngine = new TemplateEngine();
