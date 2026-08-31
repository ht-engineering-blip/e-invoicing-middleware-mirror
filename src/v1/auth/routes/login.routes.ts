import { Elysia } from "elysia";
import { logger, ResponseBuilder } from "../../../@lib";
import { AuthService } from "../services";
import {
  loginRouteValidation,
  teamMemberLoginRouteValidation,
  firsOAuthRouteValidation,
} from "../validations/auth.validation";

export const authLoginRoutes = new Elysia()
  .decorate("authService", new AuthService())

  /**
   * POST /auth
   * Login with email and password
   */
  .post(
    "/",
    async ({ body, authService, set }) => {
      try {
        const result = await authService.loginTenant(body.email, body.password);
        return ResponseBuilder.success(result, undefined, "Login successful");
      } catch (error: any) {
        set.status = error.statusCode || 401;
        logger.error("Login failed", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Invalid credentials",
          error.statusCode || 401,
        );
      }
    },
    loginRouteValidation,
  )

  /**
   * POST /auth/team-login
   * Login for team members
   */
  .post(
    "/team-member",
    async ({ body, authService, set }) => {
      try {
        const result = await authService.loginTeamMember(
          body.email,
          body.password,
        );
        return ResponseBuilder.success(result, undefined, "Login successful");
      } catch (error: any) {
        set.status = error.statusCode || 401;
        logger.error("Team member login failed", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Invalid credentials",
          error.statusCode || 401,
        );
      }
    },
    teamMemberLoginRouteValidation,
  )

  /**
   * POST /auth/firs-oauth
   * Authenticate with FIRS credentials
   */
  .post(
    "/firs-oauth",
    async ({ body, authService, set }) => {
      try {
        const result = await authService.loginFIRSOAuth(
          body.email,
          body.password,
        );
        return ResponseBuilder.success(
          result,
          undefined,
          "FIRS OAuth login successful",
        );
      } catch (error: any) {
        set.status = error.statusCode || 401;
        logger.error("FIRS OAuth login failed", { error: error.message });
        return ResponseBuilder.error(
          error.message || "FIRS authentication failed",
          error.statusCode || 401,
        );
      }
    },
    firsOAuthRouteValidation,
  );
