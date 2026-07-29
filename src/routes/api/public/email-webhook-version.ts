import { createFileRoute } from "@tanstack/react-router";
import {
  AUTH_EMAIL_LINK_STRATEGY,
  AUTH_EMAIL_ROOT_DOMAIN,
  AUTH_EMAIL_TEMPLATE_VERSION,
} from "@/lib/auth-email-contract";

/**
 * Public health probe: which auth-email pipeline version is live on this
 * origin? Used to diagnose production/preview drift after deploys. Contains
 * no PII and no secrets.
 */
export const Route = createFileRoute("/api/public/email-webhook-version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let environment: "production" | "preview" = "preview";
        try {
          const host = new URL(request.url).hostname;
          if (host === AUTH_EMAIL_ROOT_DOMAIN || host === `www.${AUTH_EMAIL_ROOT_DOMAIN}`) {
            environment = "production";
          }
        } catch {
          /* keep preview default */
        }
        const webhookDeployment =
          (typeof process !== "undefined" && process.env?.LOVABLE_BUILD_ID) ||
          (typeof process !== "undefined" && process.env?.CF_PAGES_COMMIT_SHA) ||
          AUTH_EMAIL_TEMPLATE_VERSION;
        return Response.json({
          template_version: AUTH_EMAIL_TEMPLATE_VERSION,
          link_strategy: AUTH_EMAIL_LINK_STRATEGY,
          webhook_deployment: String(webhookDeployment),
          environment,
        });
      },
    },
  },
});
