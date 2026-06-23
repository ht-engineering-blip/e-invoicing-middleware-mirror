import { TeamMemberSchema } from '../../shared/validations/models.schema';
import { t } from 'elysia';
import { acceptInviteExample, inviteMemberExample, updateMemberExample } from '../examples/team.examples';

export const acceptInviteValidation = {
  params: t.Object({
    token: t.String(),
  }),
  body: t.Object({
    password: t.String({ minLength: 8, example: acceptInviteExample.password }),
  }, { examples: [acceptInviteExample] }),
  
  detail: {
    tags: ['Team Management'],
    summary: 'Accept Invitation',
    description: 'Accept team invitation and set password',
  },
};

export const listTeamMembersValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  query: t.Object({
    status: t.Optional(t.String()),
    role: t.Optional(t.String()),
    page: t.Optional(t.String()),
    limit: t.Optional(t.String()),
  }),
  
  detail: {
    tags: ['Team Management'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'List Team Members',
    description: 'List all team members for a tenant',
  },
};

export const inviteTeamMemberValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object({
    email: t.String({ format: 'email', example: inviteMemberExample.email }),
    firstName: t.String({ minLength: 1, example: inviteMemberExample.firstName }),
    lastName: t.String({ minLength: 1, example: inviteMemberExample.lastName }),
    role: t.Enum({
      admin: 'admin',
      member: 'member',
      viewer: 'viewer',
    }),
    permissions: t.Optional(t.Array(t.String())),
  }, { examples: [inviteMemberExample] }),
  
  detail: {
    tags: ['Team Management'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Invite Team Member',
    description: 'Invite a new team member',
  },
};

export const getTeamMemberValidation = {
  params: t.Object({
    tenantId: t.String(),
    userId: t.String(),
  }),
  
  detail: {
    tags: ['Team Management'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Get Team Member',
    description: 'Get team member details',
  },
};

export const updateTeamMemberValidation = {
  params: t.Object({
    tenantId: t.String(),
    userId: t.String(),
  }),
  body: t.Object({
    firstName: t.Optional(t.String({ example: updateMemberExample.firstName })),
    lastName: t.Optional(t.String({ example: updateMemberExample.lastName })),
    role: t.Optional(
      t.Enum({
        admin: 'admin',
        member: 'member',
        viewer: 'viewer',
      })
    ),
    permissions: t.Optional(t.Array(t.String())),
    status: t.Optional(
      t.Enum({
        active: 'active',
        suspended: 'suspended',
      })
    ),
  }, { examples: [updateMemberExample] }),
  
  detail: {
    tags: ['Team Management'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Update Team Member',
    description: 'Update team member details',
  },
};

export const removeTeamMemberValidation = {
  params: t.Object({
    tenantId: t.String(),
    userId: t.String(),
  }),
  
  detail: {
    tags: ['Team Management'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Remove Team Member',
    description: 'Remove a team member from the tenant',
  },
};

export const resendInviteValidation = {
  params: t.Object({
    tenantId: t.String(),
    userId: t.String(),
  }),
  
  detail: {
    tags: ['Team Management'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Resend Invitation',
    description: 'Resend invitation email to a team member',
  },
};
