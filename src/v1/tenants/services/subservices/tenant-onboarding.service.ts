import { TenantOnboardingRepository } from "../../repos/tenant-onboarding.repo";
import { NotFoundError } from "../../../../@lib/errors";
import {
  OnboardingStatus,
  type TenantDocument,
  type TenantOnboardingDocument,
} from "../../models";
import { AuditEventType, AuditEventSeverity } from "../../../audit/models";
import { BaseService } from "../../../../@lib";

export class TenantOnboardingService extends BaseService {
  private onboardingRepo: TenantOnboardingRepository;

  constructor(onboardingRepo?: TenantOnboardingRepository) {
    super();
    this.onboardingRepo = onboardingRepo ?? new TenantOnboardingRepository();
  }

  /**
   * Get onboarding status and sync steps
   */
  async getOnboardingStatus(
    tenant: TenantDocument,
  ): Promise<TenantOnboardingDocument> {
    const onboarding = await this.onboardingRepo.findByTenantId(
      tenant.tenantId,
    );

    if (!onboarding) {
      throw new NotFoundError("Onboarding record");
    }

    let stepUpdated = false;

    // 1. Registration: completed if tenant account exists
    if (
      !onboarding.steps?.registration?.completed &&
      (tenant.tenantId ||
        tenant.password ||
        tenant.metadata?.activationCompleted)
    ) {
      await this.onboardingRepo.completeStep(tenant.tenantId, "registration");
      onboarding.steps.registration = {
        completed: true,
        completedAt: tenant.createdAt || new Date(),
      };
      stepUpdated = true;
    }

    // 2. FIRS Provisioning: completed if firs credentials serviceId/clientId exist
    if (
      !onboarding.steps?.firsProvisioning?.completed &&
      (tenant.config?.firsCredentials?.serviceId ||
        tenant.config?.firsCredentials?.clientId)
    ) {
      await this.onboardingRepo.completeStep(
        tenant.tenantId,
        "firsProvisioning",
      );
      onboarding.steps.firsProvisioning = {
        completed: true,
        completedAt: new Date(),
      };
      stepUpdated = true;
    }

    // 3. ERP Configuration: completed if webhookUrl exists
    if (
      !onboarding.steps?.erpConfiguration?.completed &&
      (tenant.config?.webhookUrl || tenant.metadata?.webhookUrl)
    ) {
      await this.onboardingRepo.completeStep(
        tenant.tenantId,
        "erpConfiguration",
      );
      onboarding.steps.erpConfiguration = {
        completed: true,
        completedAt: new Date(),
      };
      stepUpdated = true;
    }

    if (stepUpdated && onboarding.status === "pending") {
      await this.onboardingRepo.updateStatus(
        tenant.tenantId,
        OnboardingStatus.IN_PROGRESS,
      );
      onboarding.status = OnboardingStatus.IN_PROGRESS;
    }

    return onboarding;
  }

  /**
   * Complete an onboarding step
   */
  async completeStep(
    tenant: TenantDocument,
    step:
      | "registration"
      | "firsProvisioning"
      | "erpConfiguration"
      | "testing"
      | "goLive",
    actor?: any,
  ): Promise<TenantOnboardingDocument> {
    const updated = await this.onboardingRepo.completeStep(
      tenant.tenantId,
      step,
    );

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "onboarding",
      resourceId: updated.tenantId,
      resourceName: tenant.businessName,
      description: `Onboarding step completed: ${step}`,
      metadata: {
        step,
        action: "onboarding.step_completed",
        payload: { step },
      },
    });

    return updated;
  }

  /**
   * Update onboarding status
   */
  async updateOnboarding(
    tenant: TenantDocument,
    input: {
      status?: OnboardingStatus;
      notes?: string;
      rejectionReason?: string;
    },
    actor?: any,
  ): Promise<TenantOnboardingDocument> {
    const onboarding = await this.onboardingRepo.findByTenantId(
      tenant.tenantId,
    );
    if (!onboarding) {
      throw new NotFoundError("Onboarding record");
    }

    const updateData: any = {};
    if (input.status) updateData.status = input.status;
    if (input.notes) updateData.notes = input.notes;
    if (input.rejectionReason)
      updateData.rejectionReason = input.rejectionReason;

    const updated = await this.onboardingRepo.update(
      tenant.tenantId,
      updateData,
    );

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "onboarding",
      resourceId: onboarding._id.toString(),
      resourceName: tenant.businessName,
      description: "Tenant onboarding status updated",
      metadata: {
        ...updateData,
        action: "onboarding.status_updated",
        payload: input,
      },
    });

    return updated!;
  }

  /**
   * Approve onboarding
   */
  async approveOnboarding(tenant: TenantDocument, actor?: any): Promise<void> {
    const onboarding = await this.onboardingRepo.findByTenantId(
      tenant.tenantId,
    );
    if (!onboarding) {
      throw new NotFoundError("Onboarding record");
    }

    await this.onboardingRepo.approve(tenant.tenantId, actor?.id || "system");

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_ACTIVATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "onboarding",
      resourceId: onboarding._id.toString(),
      resourceName: tenant.businessName,
      description: "Tenant onboarding approved",
      metadata: {
        action: "onboarding.approved",
        payload: { tenantId: tenant.tenantId },
      },
    });
  }

  /**
   * Reject onboarding
   */
  async rejectOnboarding(
    tenant: TenantDocument,
    reason: string,
    actor?: any,
  ): Promise<void> {
    const onboarding = await this.onboardingRepo.findByTenantId(
      tenant.tenantId,
    );
    if (!onboarding) {
      throw new NotFoundError("Onboarding record");
    }

    await this.onboardingRepo.reject(onboarding._id.toString(), reason);

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.WARNING,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "onboarding",
      resourceId: onboarding._id.toString(),
      resourceName: tenant.businessName,
      description: `Tenant onboarding rejected: ${reason}`,
      metadata: {
        reason,
        action: "onboarding.rejected",
        payload: { tenantId: tenant.tenantId, reason },
      },
    });
  }
}
