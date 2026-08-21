import { faker } from "@faker-js/faker";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { hashString } from "../src/@lib/utils/encryption";
import {
  TeamMemberRole,
  TeamMemberStatus,
} from "../src/v1/tenants/models/team-member.model";
import { TenantStatus } from "../src/v1/tenants/models/tenant.model";
import { TeamMemberRepository } from "../src/v1/tenants/repos/team-member.repo";
import { TenantOnboardingRepository } from "../src/v1/tenants/repos/tenant-onboarding.repo";
import { TenantRepository } from "../src/v1/tenants/repos/tenant.repo";
import {
  InviteTeamMemberInput,
  TeamMemberService,
} from "../src/v1/tenants/services/team-member.service";
import { TenantService } from "../src/v1/tenants/services/tenant.service";

describe("Real DB-Connected Onboarding Flow (Tenant & Team Member)", () => {
  let tenantService: TenantService;
  let teamMemberService: TeamMemberService;

  let tenantRepo: TenantRepository;
  let teamMemberRepo: TeamMemberRepository;
  let onboardingRepo: TenantOnboardingRepository;

  const testTenants: string[] = [];
  const testTeamMembers: string[] = [];

  let sendEmailSpy: any;

  beforeAll(async () => {
    // Use the project's standard connectMongo which reads MONGODB_URI from env (with auth)
    await connectMongo();

    tenantService = new TenantService();
    teamMemberService = new TeamMemberService();

    // Mock sendEmail to avoid real SMTP calls that timeout
    sendEmailSpy = spyOn(
      teamMemberService as any,
      "sendEmail",
    ).mockImplementation(async () => {
      return { messageId: "mocked-email" };
    });

    tenantRepo = new TenantRepository();
    teamMemberRepo = new TeamMemberRepository();
    onboardingRepo = new TenantOnboardingRepository();
  });

  afterAll(async () => {
    // Clean up created entities
    for (const tenantId of testTenants) {
      try {
        await tenantRepo.delete(tenantId);
        await onboardingRepo.delete(tenantId);
      } catch (err) {
        console.error(`Failed to clean up tenant ${tenantId}:`, err);
      }
    }
    for (const userId of testTeamMembers) {
      try {
        await teamMemberRepo.delete(userId);
      } catch (err) {
        console.error(`Failed to clean up team member ${userId}:`, err);
      }
    }
    if (sendEmailSpy) sendEmailSpy.mockRestore();
  });

  it("should successfully complete the entire tenant onboarding, activation, and team member invitation flow", async () => {
    // --- 1. Create a new Tenant via TenantService ---
    const fakeBusinessName = faker.company.name();
    const fakeTin = faker.string.numeric({ length: 10 });
    const fakeEmail = faker.internet.email().toLowerCase();
    const fakePhone = faker.phone.number();

    const tenantInput = {
      businessName: fakeBusinessName,
      tin: fakeTin,
      businessRegistrationNumber: `RC-${faker.string.numeric({ length: 6 })}`,
      contactEmail: fakeEmail,
      contactPhone: fakePhone,
      expectedVolume: 1000,
      erpSystem: "dynamics",
    };

    const tenant = await tenantService.createTenant(tenantInput, {
      id: "admin-user-1",
      type: "user",
      name: "Global Admin",
    });
    expect(tenant).toBeDefined();
    expect(tenant.tenantId).toBeDefined();
    expect(tenant.businessName).toBe(fakeBusinessName);
    expect(tenant.status).toBe(TenantStatus.ONBOARDING);

    testTenants.push(tenant.tenantId);

    // Verify metadata stores the activation tokens correctly
    expect(tenant.metadata).toBeDefined();
    expect(tenant.metadata.activationTokenId).toBeDefined();
    expect(tenant.metadata.activationTokenExpiresAt).toBeDefined();

    // --- 2. Verify Tenant Activation Token Helpers ---
    const tokenExpiry = tenantService.getActivationTokenExpiry(tenant);
    expect(tokenExpiry).toBeInstanceOf(Date);
    expect(tokenExpiry!.getTime()).toBeGreaterThan(Date.now());

    // Validate a correct token ID
    let isValid = tenantService.isActivationTokenValid(
      tenant,
      tenant.metadata.activationTokenId,
    );
    expect(isValid).toBe(true);

    // Validate incorrect token ID
    let isInvalid = tenantService.isActivationTokenValid(
      tenant,
      "some-wrong-token-id",
    );
    expect(isInvalid).toBe(false);

    // Timeframe is active
    let isInTimeframe = tenantService.isActivationTokenInTimeframe(tenant);
    expect(isInTimeframe).toBe(true);

    // --- 3. Test Invalidation & Renewal (Resending Activation Link) ---
    // Save previous token ID to assert replacement
    const firstTokenId = tenant.metadata.activationTokenId;

    // Simulate resending: we should update the tenant metadata with a new ID
    const newActivationTokenId = faker.string.uuid();
    const newActivationTokenExpiresAt = new Date(
      Date.now() + 12 * 60 * 60 * 1000,
    );

    const updatedTenant = await tenantService.updateTenant(tenant.tenantId, {
      metadata: {
        ...tenant.metadata,
        activationTokenId: newActivationTokenId,
        activationTokenExpiresAt: newActivationTokenExpiresAt,
      },
    });

    expect(updatedTenant.metadata.activationTokenId).toBe(newActivationTokenId);
    expect(updatedTenant.metadata.activationTokenId).not.toBe(firstTokenId);

    // Confirm first token is now invalid, and new token is valid
    expect(
      tenantService.isActivationTokenValid(updatedTenant, firstTokenId),
    ).toBe(false);
    expect(
      tenantService.isActivationTokenValid(updatedTenant, newActivationTokenId),
    ).toBe(true);

    // --- 4. Activate the Tenant Account (Set Password) ---
    const rawPassword = "SecureTenantPassword123!";
    const passwordHash = await hashString(rawPassword);

    const activatedTenant = await tenantService.updateTenant(tenant.tenantId, {
      password: passwordHash,
      metadata: {
        ...updatedTenant.metadata,
        activationCompleted: true,
        activationTokenId: null,
        activationTokenExpiresAt: null,
      },
    });

    expect(activatedTenant.password).toBe(passwordHash);
    expect(activatedTenant.metadata.activationCompleted).toBe(true);
    expect(activatedTenant.metadata.activationTokenId).toBeNull();
    expect(activatedTenant.metadata.activationTokenExpiresAt).toBeNull();

    // Verify token validation returns false now
    expect(
      tenantService.isActivationTokenValid(
        activatedTenant,
        newActivationTokenId,
      ),
    ).toBe(false);

    // --- 5. Invite a Team Member via TeamMemberService ---
    const memberEmail = faker.internet.email().toLowerCase();
    const memberFirstName = faker.person.firstName();
    const memberLastName = faker.person.lastName();

    const inviteInput: InviteTeamMemberInput = {
      email: memberEmail,
      firstName: memberFirstName,
      lastName: memberLastName,
      role: TeamMemberRole.ADMIN,
      permissions: ["read:invoices", "write:invoices"],
    };

    const teamMember = await teamMemberService.inviteTeamMember(
      tenant.tenantId,
      inviteInput,
      "tenant-owner-user-id",
    );

    expect(teamMember).toBeDefined();
    expect(teamMember.userId).toBeDefined();
    expect(teamMember.email).toBe(memberEmail);
    expect(teamMember.status).toBe(TeamMemberStatus.INVITED);
    expect(teamMember.invitationToken).toBeDefined();

    testTeamMembers.push(teamMember.userId);

    // --- 6. Accept Team Member Invitation ---
    const memberPassword = "SecureMemberPassword123!";
    const acceptResult = await teamMemberService.acceptInvitation(
      teamMember.invitationToken!,
      memberPassword,
    );

    expect(acceptResult).toBeDefined();
    expect(acceptResult.authToken).toBeDefined();
    expect(acceptResult.member.status).toBe(TeamMemberStatus.ACTIVE);
    expect(acceptResult.member.password).toBeDefined();

    // Verify token can no longer be retrieved/reused
    const lookupAfterAccept = await teamMemberRepo.findByInvitationToken(
      teamMember.invitationToken!,
    );
    expect(lookupAfterAccept).toBeNull();

    // --- 7. Login Team Member ---
    const loginResult = await teamMemberService.loginTeamMember(
      memberEmail,
      memberPassword,
    );
    expect(loginResult).toBeDefined();
    expect(loginResult.authToken).toBeDefined();
    expect(loginResult.member.email).toBe(memberEmail);
  }, 60000);

  it("should successfully update and decrypt the tenant's business ID", async () => {
    const fakeBusinessName = faker.company.name();
    const fakeTin = faker.string.numeric({ length: 10 });
    const fakeEmail = faker.internet.email().toLowerCase();
    const fakePhone = faker.phone.number();

    const tenant = await tenantService.createTenant({
      businessName: fakeBusinessName,
      tin: fakeTin,
      businessRegistrationNumber: `RC-${faker.string.numeric({ length: 6 })}`,
      contactEmail: fakeEmail,
      contactPhone: fakePhone,
      expectedVolume: 100,
      erpSystem: "tally",
    }, {
      id: "admin-user-2",
      type: "user",
      name: "Global Admin",
    });

    testTenants.push(tenant.tenantId);

    const newBusinessId = "new-test-business-id-uuid-9999";
    const updatedTenant = await tenantService.updateBusinessId(
      tenant.tenantId,
      newBusinessId,
      { id: "admin-user-2", type: "user" }
    );

    expect(updatedTenant).toBeDefined();
    expect(updatedTenant.businessId).toBe(newBusinessId);

    // Verify retrieval by business ID
    const retrieved = await tenantService.getTenantByBusinessId(newBusinessId);
    expect(retrieved).toBeDefined();
    expect(retrieved.tenantId).toBe(tenant.tenantId);

    // Verify FIRS credentials decryption matches the business ID
    const credentials = await tenantService.getFIRSCredentials(tenant.tenantId);
    expect(credentials.clientId).toBe(newBusinessId);
  });
});
