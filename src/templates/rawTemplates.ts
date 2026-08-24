export const EMBEDDED_TEMPLATES: Record<string, string> = {
    resetPassword: `<h2>Reset Your Password</h2>
<p>Hello {{businessName}},</p>
<p>You requested a password reset for your E-Invoicing account.</p>
<p>Click the button below to reset your password:</p>
<a href="{{resetUrl}}" class="cta-button">Reset Password</a>
<p>If you did not request this, please ignore this email.</p>`,

    newTenants: `<p>Welcome to HT Invoicing. Your account has been created successfully.</p>
<p>Click the button below to get started:</p>
<a href="{{activationLink}}" class="cta-button">Get Started</a>
<br/>
<p style="margin-top: 15px; font-size: 13px;">Or copy this link: <a href="{{activationLink}}" style="text-decoration: none;">{{activationLink}}</a></p>
<p style="margin-top: 15px; font-size: 13px; color: #666;">Please note: This activation link is valid for 12 hours. If it expires, you will need to request a new link.</p>`,

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
<p>This invitation will expire in 7 days.</p>`,

    verifyEmailChange: `<h2>Verify Your New Email Address</h2>
<p>Hello {{businessName}},</p>
<p>You requested to change your contact email address for your E-Invoicing account to <strong>{{newEmail}}</strong>.</p>
<p>Click the button below to verify and complete the update:</p>
<a href="{{verificationLink}}" class="cta-button">Verify Email</a>
<br/>
<p style="margin-top: 15px; font-size: 13px;">Or copy this link: <a href="{{verificationLink}}" style="text-decoration: none;">{{verificationLink}}</a></p>
<p style="margin-top: 15px; font-size: 13px; color: #666;">This verification link is valid for 12 hours. If you did not request this change, please ignore this email.</p>`,

    emailChangeAlertOldEmail: `<h2>Security Alert: Contact Email Change Requested</h2>
<p>Hello {{businessName}},</p>
<p>A request was received to update the contact email address for your E-Invoicing account from <strong>{{oldEmail}}</strong> to <strong>{{newEmail}}</strong>.</p>
<p>A verification link was sent to the new email address to complete this request.</p>
<div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
  <strong>⚠️ Security Notice:</strong>
  <p style="margin: 5px 0 0 0;">If you did NOT request this change, someone may have unauthorized access to your account. Please contact support immediately to secure your account.</p>
</div>`,

    emailChangeSuccessNotification: `<h2>Contact Email Changed Successfully</h2>
<p>Hello {{businessName}},</p>
<p>The primary contact email address for your E-Invoicing account has been successfully updated from <strong>{{oldEmail}}</strong> to <strong>{{newEmail}}</strong>.</p>
<p>All future notifications, billing details, and platform alerts will be sent to <strong>{{newEmail}}</strong>.</p>
<p style="margin-top: 15px; font-size: 13px; color: #666;">If you did not authorize this change, please contact support immediately.</p>`
};