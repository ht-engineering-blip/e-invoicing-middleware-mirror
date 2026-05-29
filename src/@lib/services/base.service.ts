import crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { logger } from "../logger";
import { NodeMailerClient, MailContent } from "../messaging";
import * as utils from "../utils";
import { jwtConfig } from "../../@config";
import { AuditLogRepository } from "../../v1/audit/repos/audit-log.repo";
import { AuditEventType, AuditEventSeverity } from "../../v1/audit/models";
import { TenantDocument, TeamMemberRole } from "../../v1/tenants/models";
import { AutocompletePaths } from "../types";
import { decryptSensitiveData } from "../crypto";

/**
 * BaseService class providing core shared utilities for all extending services.
 * Features unified logging, consistent mailing, dynamic data sanitization, and audit logging.
 */
export class BaseService {
  protected logger = logger;
  private _auditRepo?: AuditLogRepository;

  // Exposed standard utility helper methods directly on BaseService
  protected hashString = utils.hashString;
  protected verifyHash = utils.verifyHash;
  protected generateRandomString = utils.generateRandomString;
  protected isValidEmail = utils.isValidEmail;
  protected isValidPhone = utils.isValidPhone;
  protected isSafeUrl = utils.isSafeUrl;
  protected cleanAndParseJson = utils.cleanAndParseJson;
  protected flatten = utils.flatten;
  protected buildQrUrl = utils.buildQrUrl;
  protected getNestedValue = utils.getNestedValue;
  protected escapeHtml = utils.escapeHtml;
  protected html = utils.html;

  /**
   * Getter for AuditLogRepository (lazy-loaded to prevent circular loading)
   */
  protected get auditRepo(): AuditLogRepository {
    if (!this._auditRepo) {
      this._auditRepo = new AuditLogRepository();
    }
    return this._auditRepo;
  }

  /**
   * Send an email using NodeMailerClient.
   * Centralizes mailing boilerplate for all extending services.
   * 
   * @param mail - MailContent structure with to, subject, html body
   */
  protected async sendEmail(mail: MailContent): Promise<boolean> {
    try {
      const mailClient = new NodeMailerClient();
      return await mailClient.send(mail);
    } catch (error: any) {
      this.logger.error("Failed to send email inside BaseService", {
        to: mail.to,
        subject: mail.subject,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Helper to write audit logs cleanly and consistently.
   */
  protected async createAuditLog({
    tenantId,
    eventType,
    description,
    resourceId,
    resourceType,
    resourceName,
    severity = AuditEventSeverity.INFO,
    actorId = "system",
    actorType = "system",
    actorName,
    metadata = {},
  }: {
    tenantId: string;
    eventType: AuditEventType;
    description: string;
    resourceId: string;
    resourceType: string;
    resourceName?: string;
    severity?: AuditEventSeverity;
    actorId?: string;
    actorType?: string;
    actorName?: string;
    metadata?: any;
  }): Promise<any> {
    try {
      const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return await this.auditRepo.create({
        tenantId,
        eventId,
        eventType,
        severity: severity as any,
        actor: { actorType: actorType as any, actorId, actorName },
        resource: { resourceType: resourceType as any, resourceId, resourceName },
        description,
        metadata,
        timestamp: new Date(),
      });
    } catch (error: any) {
      this.logger.error("Failed to write audit log inside BaseService", {
        tenantId,
        eventType,
        error: error.message,
      });
    }
  }

  /**
   * General-purpose data sanitization helper using central omitKeys.
   * Enforces type-safety by restricting keysToOmit to compile-time keys of T or dot-notation paths.
   */
  protected sanitize<T>(
    data: T,
    keysToOmit?: AutocompletePaths<T>[]
  ): T {
    return utils.omitKeys(data, keysToOmit as AutocompletePaths<T>[]);
  }

  /**
   * Create Auth Token For Tenant or Team Member
   */
  public async createAuthToken(
    tenant: Partial<TenantDocument> & {
      type?: string;
      role?: TeamMemberRole;
      scopes?: string[];
      userId?: string;
      email?: string;
      scope?: string[];
      permissions?: string[];
      businessId?: string;
    },
    expiresIn?: string,
  ): Promise<string> {



    let businessId = "";
    if (tenant.config?.firsCredentials?.clientId) {
      businessId = decryptSensitiveData(tenant.config.firsCredentials.clientId);
    }

    let scopes = tenant.scopes || tenant.scope || tenant.permissions;
    if (!scopes) {
      scopes = tenant.type === "team_member" ? [] : ["*"];
    }

    let email = tenant.contactEmail;

    if (tenant.type === 'team_member') email = tenant.email;

    const tokenPayload: any = {
      tenantId: tenant.tenantId,
      type: tenant.type || "tenant",
      role: tenant.role || "owner",
      scopes,
      email,
      businessName: tenant.businessName,
      businessId
    };

    if (tenant.userId) {
      tokenPayload.userId = tenant.userId;
    }

    const jwtSecret = jwtConfig?.secret as string;
    const jwtExpiry = expiresIn || jwtConfig?.expiry;
    const jwtAlgorithm = jwtConfig?.algorithm as jwt.Algorithm;

    const token = jwt.sign(tokenPayload, jwtSecret, {
      expiresIn: jwtExpiry as any,
      algorithm: jwtAlgorithm,
    });

    return token;
  }

  /**
   * Generate a random token and its SHA-256 hash.
   * Useful for password resets and verification links.
   */
  public generateToken(bytes: number = 32): { token: string; hash: string } {
    const token = crypto.randomBytes(bytes).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    return { token, hash };
  }

  /**
   * Compute the SHA-256 hash of a token.
   */
  public hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
