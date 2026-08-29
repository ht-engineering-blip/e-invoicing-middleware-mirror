import { Elysia } from "elysia";
import { publicOnboardingRoutes } from "./public.routes";
import { onboardingCredentialsRoutes } from "./credentials.routes";
import { onboardingWebhookRoutes } from "./webhook-config.routes";

export const protectedOnboardingRoutes = new Elysia()
  .use(onboardingCredentialsRoutes)
  .use(onboardingWebhookRoutes);

export {
  publicOnboardingRoutes,
  onboardingCredentialsRoutes,
  onboardingWebhookRoutes,
};
