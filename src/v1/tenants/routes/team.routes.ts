import { Elysia, t } from 'elysia';
import { requireAuth } from '../../../middlewares/auth';
import { logger } from '../../../@lib';
import { TeamMemberService } from '../services/team-member.service';
import { TeamMemberRole, TeamMemberStatus } from '../models/team-member.model';
import { onlySelf } from '../../auth/utils/access-checks';
import { acceptInviteExample, inviteMemberExample, updateMemberExample } from '../examples/team.examples';

/**
 * Public Team Routes (for accepting invitations)
 */
export const publicTeamRoutes = new Elysia({ prefix: '/team' })
  .decorate('teamService', new TeamMemberService())

  /**
   * POST /team/accept-invite/:token
   * Accept team invitation
   */
  .post(
    '/accept-invite/:token',
    async ({ params, body, teamService }) => {
      try {
        logger.info('Team invitation acceptance attempt');

        const result = await teamService.acceptInvitation(params.token, body.password);

        return {
          success: true,
          message: 'Invitation accepted successfully',
          data: {
            userId: result.member.userId,
            email: result.member.email,
            firstName: result.member.firstName,
            lastName: result.member.lastName,
            role: result.member.role,
            token: result.authToken,
            tokenType: 'Bearer',
          },
        };
      } catch (error: any) {
        logger.error('Failed to accept invitation', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to accept invitation',
          statusCode: error.statusCode || 400,
        };
      }
    },
    {
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
    }
  );

/**
 * Protected Team Routes
 */
export const protectedTeamRoutes = new Elysia({ prefix: '/:tenantId/team' })
  .use(requireAuth)
  .decorate('teamService', new TeamMemberService())

  /**
   * GET /tenants/:tenantId/team
   * List team members
   */
  .get(
    '/',
    async ({ params, query, auth, teamService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)
        

        const result = await teamService.listTeamMembers(params.tenantId, {
          status: query.status as TeamMemberStatus,
          role: query.role as TeamMemberRole,
          page: query.page ? parseInt(query.page) : 1,
          limit: query.limit ? parseInt(query.limit) : 20,
        });

        return {
          success: true,
          data: result.data.map((member) => ({
            userId: member.userId,
            email: member.email,
            firstName: member.firstName,
            lastName: member.lastName,
            role: member.role,
            status: member.status,
            invitedAt: member.invitedAt,
            acceptedAt: member.acceptedAt,
            permissions: member.permissions,
          })),
          pagination: result.pagination,
        };
      } catch (error: any) {
        logger.error('Failed to list team members', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to list team members',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
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
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'List Team Members',
        description: 'List all team members for a tenant',
      },
    }
  )

  /**
   * POST /tenants/:tenantId/team
   * Invite team member
   */
  .post(
    '/',
    async ({ params, body, auth, teamService }) => {
      try {
        // Check authorization
           onlySelf(auth!, params.tenantId)

        const member = await teamService.inviteTeamMember(
          params.tenantId,
          {
            email: body.email,
            firstName: body.firstName,
            lastName: body.lastName,
            role: body.role as TeamMemberRole,
            permissions: body.permissions,
          },
          auth?.userId || auth!.tenantId
        );

        return {
          success: true,
          message: 'Team member invited successfully',
          data: {
            userId: member.userId,
            email: member.email,
            firstName: member.firstName,
            lastName: member.lastName,
            role: member.role,
            status: member.status,
            invitedAt: member.invitedAt,
          },
        };
      } catch (error: any) {
        logger.error('Failed to invite team member', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to invite team member',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
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
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Invite Team Member',
        description: 'Invite a new team member',
      },
    }
  )

  /**
   * GET /tenants/:tenantId/team/:userId
   * Get team member details
   */
  .get(
    '/:userId',
    async ({ params, auth, teamService }) => {
      try {
        // Check authorization
       onlySelf(auth!, params.tenantId)

        const member = await teamService.getTeamMember(params.tenantId, params.userId);

        return {
          success: true,
          data: {
            userId: member.userId,
            email: member.email,
            firstName: member.firstName,
            lastName: member.lastName,
            role: member.role,
            status: member.status,
            invitedAt: member.invitedAt,
            invitedBy: member.invitedBy,
            acceptedAt: member.acceptedAt,
            permissions: member.permissions,
            lastLoginAt: member.lastLoginAt,
          },
        };
      } catch (error: any) {
        logger.error('Failed to get team member', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to get team member',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        tenantId: t.String(),
        userId: t.String(),
      }),
      detail: {
        tags: ['Team Management'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Get Team Member',
        description: 'Get team member details',
      },
    }
  )

  /**
   * PATCH /tenants/:tenantId/team/:userId
   * Update team member
   */
  .patch(
    '/:userId',
    async ({ params, body, auth, teamService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)
        
        const member = await teamService.updateTeamMember(
          params.tenantId,
          params.userId,
          {
            firstName: body.firstName,
            lastName: body.lastName,
            role: body.role as TeamMemberRole,
            permissions: body.permissions,
            status: body.status as TeamMemberStatus,
          },
          auth!.userId || auth!.tenantId
        );

        return {
          success: true,
          message: 'Team member updated successfully',
          data: {
            userId: member.userId,
            email: member.email,
            firstName: member.firstName,
            lastName: member.lastName,
            role: member.role,
            status: member.status,
            permissions: member.permissions,
          },
        };
      } catch (error: any) {
        logger.error('Failed to update team member', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to update team member',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
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
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Update Team Member',
        description: 'Update team member details',
      },
    }
  )

  /**
   * DELETE /tenants/:tenantId/team/:userId
   * Remove team member
   */
  .delete(
    '/:userId',
    async ({ params, auth, teamService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)
       

        await teamService.removeTeamMember(
          params.tenantId,
          params.userId,
          auth!.userId || auth!.tenantId
        );

        return {
          success: true,
          message: 'Team member removed successfully',
        };
      } catch (error: any) {
        logger.error('Failed to remove team member', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to remove team member',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        tenantId: t.String(),
        userId: t.String(),
      }),
      detail: {
        tags: ['Team Management'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Remove Team Member',
        description: 'Remove a team member from the tenant',
      },
    }
  )

  /**
   * POST /tenants/:tenantId/team/:userId/resend-invite
   * Resend invitation email
   */
  .post(
    '/:userId/resend-invite',
    async ({ params, auth, teamService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)
       

        await teamService.resendInvitation(params.tenantId, params.userId);

        return {
          success: true,
          message: 'Invitation resent successfully',
        };
      } catch (error: any) {
        logger.error('Failed to resend invitation', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to resend invitation',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        tenantId: t.String(),
        userId: t.String(),
      }),
      detail: {
        tags: ['Team Management'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Resend Invitation',
        description: 'Resend invitation email to a team member',
      },
    }
  );
