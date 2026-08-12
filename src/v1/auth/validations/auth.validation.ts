import { t } from "elysia";

export const loginValidator = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 6 }),
});

export const passwordValidator = t.Object({
  password: t.String({ minLength: 6 }),
});

export const firsOAuthValidator = t.Object({
  email: t.String({ format: "email" }),
  password: t.String({ minLength: 1 }),
  mock: t.Optional(t.Boolean()),
});

export const forgotPasswordValidator = t.Object({
  email: t.String({ format: "email" }),
});

export const resetPasswordValidator = t.Object({
  token: t.String({ minLength: 1 }),
  password: t.String({ minLength: 8 }),
});

export const loginRouteValidation = {
  body: loginValidator,
  detail: {
    tags: ["Authentication"],
    summary: "Login",
    description: "Login with email and password to receive a JWT token",
  },
};

export const teamMemberLoginRouteValidation = {
  body: loginValidator,
  detail: {
    tags: ["Authentication"],
    summary: "Team Member Login",
    description: "Login as a team member with email and password",
  },
};

export const firsOAuthRouteValidation = {
  body: firsOAuthValidator,
  detail: {
    tags: ["Authentication"],
    summary: "FIRS OAuth",
    description: "Authenticate with FIRS and optionally sync credentials to existing tenant",
  },
};

export const forgotPasswordRouteValidation = {
  body: forgotPasswordValidator,
  detail: {
    tags: ["Authentication"],
    summary: "Forgot Password",
    description: "Request a password reset email",
  },
};

export const resetPasswordRouteValidation = {
  body: resetPasswordValidator,
  detail: {
    tags: ["Authentication"],
    summary: "Reset Password",
    description: "Reset password using the token received via email",
  },
};

export const validateResetTokenRouteValidation = {
  params: t.Object({
    token: t.String(),
  }),
  detail: {
    tags: ["Authentication"],
    summary: "Validate Reset Token",
    description: "Check if a password reset token is still valid",
  },
};

export const meRouteValidation = {
  detail: {
    tags: ["Authentication", "Tenant"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Me",
    description: "Get authenticated user details (tenant or team member)",
  },
};

export const setPasswordRouteValidation = {
  body: passwordValidator,
  detail: {
    tags: ["Authentication", "Tenant"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Set Password",
    description: "Set password using temporary auth token",
  },
};

export const refreshTokenRouteValidation = {
  detail: {
    tags: ["Authentication"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Refresh token",
    description: "Refresh JWT token to extend session",
  },
};
