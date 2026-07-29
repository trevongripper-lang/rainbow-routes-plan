// Safeguard: keep module-level imports minimal so a broken template or a
// renamed export in @react-email/components cannot crash sibling page SSR
// when this route is pulled in via routeTree.gen.ts. All heavy/risky
// imports are loaded lazily inside the POST handler.
import { createFileRoute } from "@tanstack/react-router";
import {
  ALLOWED_CALLBACK_TYPES,
  AUTH_EMAIL_CALLBACK_PATH,
  AUTH_EMAIL_LINK_STRATEGY,
  AUTH_EMAIL_ROOT_DOMAIN,
  AUTH_EMAIL_TEMPLATE_VERSION,
  AUTH_EMAIL_TOTP_STRATEGY,
  AUTH_TYPE_MAP,
  FORBIDDEN_LINK_ARTIFACTS,
  LINK_AUTH_ACTIONS,
  isSafeRelativePath,
  type AuthActionType,
} from "@/lib/auth-email-contract";

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: "Confirm your Tribe Trips account",
  invite: "You've been invited to Tribe Trips",
  magiclink: "Your Tribe Trips login link",
  recovery: "Reset your Tribe Trips password",
  email_change: "Confirm your new Tribe Trips email",
  reauthentication: "Your Tribe Trips verification code",
};

const KNOWN_ACTION_TYPES = new Set<AuthActionType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "reauthentication",
]);

const SITE_NAME = "Tribe Trips";
const SENDER_DOMAIN = "notify.jointribetrips.com";
const ROOT_DOMAIN = AUTH_EMAIL_ROOT_DOMAIN;
const FROM_DOMAIN = "jointribetrips.com";
const FROM_LOCAL_PART = "hello";
const REPLY_TO = `hello@${FROM_DOMAIN}`;

function redactEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Pull the token hash from the webhook payload. Accepts the direct
 * `token_hash` field, or a token-hash URL if that's what upstream provided.
 * Explicitly refuses to treat `/auth/v1/verify` URLs as a token source.
 */
function extractTokenHash(data: Record<string, unknown>): string | undefined {
  const direct = firstString(
    data.token_hash,
    (data as Record<string, unknown>).tokenHash,
    (data as Record<string, unknown>).hashed_token,
    (data as Record<string, unknown>).hashedToken,
  );
  if (direct) return direct;

  const rawUrl = firstString(data.url, (data as Record<string, unknown>).confirmation_url);
  if (!rawUrl) return undefined;
  if (FORBIDDEN_LINK_ARTIFACTS.some((re) => re.test(rawUrl))) return undefined;

  try {
    const url = new URL(rawUrl);
    return firstString(url.searchParams.get("token_hash"), url.searchParams.get("tokenHash"));
  } catch {
    return undefined;
  }
}

function extractSafeRedirectPath(data: Record<string, unknown>): string | undefined {
  const direct = firstString(data.redirect_to, (data as Record<string, unknown>).redirectTo);
  if (isSafeRelativePath(direct)) return direct;

  const rawUrl = firstString(data.url);
  if (!rawUrl) return undefined;
  try {
    const redirectTo = new URL(rawUrl).searchParams.get("redirect_to");
    if (!redirectTo) return undefined;
    const parsed = new URL(redirectTo);
    if (parsed.hostname !== ROOT_DOMAIN && parsed.hostname !== `www.${ROOT_DOMAIN}`) {
      return undefined;
    }
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return isSafeRelativePath(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

// Deterministic plain-text bodies so each auth email contains exactly one
// token-bearing URL (or one TOTP). We do NOT use React Email's plainText
// serializer because it emits `Label [url]` from <Button> and then repeats
// any fallback <Link> we render — historically doubling the confirmation URL.
function buildPlainText(
  emailType: string,
  p: {
    recipient?: string;
    confirmationUrl?: string;
    token?: string;
    oldEmail?: string;
    newEmail?: string;
  },
): string {
  const url = p.confirmationUrl ?? "";
  const who = p.recipient ? ` (${p.recipient})` : "";
  switch (emailType) {
    case "signup":
      return [
        `Confirm your email${who} to finish creating your Tribe Trips account.`,
        `This link expires in 24 hours.`,
        ``,
        url,
        ``,
        `If you didn't sign up for Tribe Trips, you can safely ignore this email.`,
        ``,
        `— Tribe Trips`,
      ].join("\n");
    case "recovery":
      return [
        `Reset your Tribe Trips password by opening this link:`,
        ``,
        url,
        ``,
        `If you didn't request a password reset, you can safely ignore this email.`,
        ``,
        `— Tribe Trips`,
      ].join("\n");
    case "magiclink":
      return [
        `Your Tribe Trips login link:`,
        ``,
        url,
        ``,
        `If you didn't request this, you can safely ignore this email.`,
        ``,
        `— Tribe Trips`,
      ].join("\n");
    case "invite":
      return [
        `You've been invited to join Tribe Trips. Accept your invitation:`,
        ``,
        url,
        ``,
        `If you weren't expecting this invitation, you can ignore this email.`,
        ``,
        `— Tribe Trips`,
      ].join("\n");
    case "email_change":
      return [
        `Confirm changing your Tribe Trips email from ${p.oldEmail ?? "your current address"} to ${p.newEmail ?? "your new address"}:`,
        ``,
        url,
        ``,
        `If you didn't request this change, please secure your account immediately.`,
        ``,
        `— Tribe Trips`,
      ].join("\n");
    case "reauthentication":
      return [
        `Your Tribe Trips verification code: ${p.token ?? ""}`,
        ``,
        `This code will expire shortly. If you didn't request it, you can ignore this email.`,
        ``,
        `— Tribe Trips`,
      ].join("\n");
    default:
      return url;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTemplate(emailType: string): Promise<any> {
  switch (emailType) {
    case "signup":
      return (await import("@/lib/email-templates/signup")).SignupEmail;
    case "invite":
      return (await import("@/lib/email-templates/invite")).InviteEmail;
    case "magiclink":
      return (await import("@/lib/email-templates/magic-link")).MagicLinkEmail;
    case "recovery":
      return (await import("@/lib/email-templates/recovery")).RecoveryEmail;
    case "email_change":
      return (await import("@/lib/email-templates/email-change")).EmailChangeEmail;
    case "reauthentication":
      return (await import("@/lib/email-templates/reauthentication")).ReauthenticationEmail;
    default:
      return null;
  }
}

function detectEnvironment(request: Request): "production" | "preview" {
  try {
    const host = new URL(request.url).hostname;
    return host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` ? "production" : "preview";
  } catch {
    return "preview";
  }
}

function containsForbiddenArtifact(...values: (string | undefined | null)[]): string | null {
  for (const v of values) {
    if (!v) continue;
    for (const re of FORBIDDEN_LINK_ARTIFACTS) {
      if (re.test(v)) return re.source;
    }
  }
  return null;
}

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;

        if (!apiKey) {
          console.error("LOVABLE_API_KEY not configured");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        // Lazy-load heavy deps so module evaluation stays cheap and safe.
        const [
          React,
          { render },
          { parseEmailWebhookPayload },
          { WebhookError, verifyWebhookRequest },
          { createClient },
        ] = await Promise.all([
          import("react"),
          import("@react-email/components"),
          import("@lovable.dev/email-js"),
          import("@lovable.dev/webhooks-js"),
          import("@supabase/supabase-js"),
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let payload: any;
        let run_id = "";
        try {
          const verified = await verifyWebhookRequest({
            req: request,
            secret: apiKey,
            parser: parseEmailWebhookPayload,
          });
          payload = verified.payload;
          run_id = payload.run_id;
        } catch (error) {
          if (error instanceof WebhookError) {
            switch (error.code) {
              case "invalid_signature":
              case "missing_timestamp":
              case "invalid_timestamp":
              case "stale_timestamp":
                console.error("Invalid webhook signature", { error: error.message });
                return Response.json({ error: "Invalid signature" }, { status: 401 });
              case "invalid_payload":
              case "invalid_json":
                console.error("Invalid webhook payload", { error: error.message });
                return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
            }
          }
          console.error("Webhook verification failed", { error });
          return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
        }

        if (!run_id) {
          console.error("Webhook payload missing run_id");
          return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
        }

        if (payload.version !== "1") {
          console.error("Unsupported payload version", { version: payload.version, run_id });
          return Response.json(
            { error: `Unsupported payload version: ${payload.version}` },
            { status: 400 },
          );
        }

        const emailType = payload.data.action_type as string;
        const environment = detectEnvironment(request);
        const webhookDeployment =
          (typeof process !== "undefined" && process.env?.LOVABLE_BUILD_ID) ||
          (typeof process !== "undefined" && process.env?.CF_PAGES_COMMIT_SHA) ||
          AUTH_EMAIL_TEMPLATE_VERSION;

        console.log("Received auth event", {
          emailType,
          email_redacted: redactEmail(payload.data.email),
          run_id,
          template_version: AUTH_EMAIL_TEMPLATE_VERSION,
          webhook_deployment: webhookDeployment,
          environment,
        });

        // ---- Strict action-type allowlist -----------------------------------
        if (!KNOWN_ACTION_TYPES.has(emailType as AuthActionType)) {
          console.error("Rejected auth email: unknown action type", { emailType, run_id });
          return Response.json({ error: `Unsupported action type: ${emailType}` }, { status: 400 });
        }

        const EmailTemplate = await loadTemplate(emailType);
        if (!EmailTemplate) {
          console.error("Unknown email type", { emailType, run_id });
          return Response.json({ error: `Unknown email type: ${emailType}` }, { status: 400 });
        }

        // ---- Build the confirmation URL from server-controlled fields -------
        let confirmationUrl = "";
        let linkStrategy: string;

        if (emailType === "reauthentication") {
          // TOTP: no link. Require the numeric token.
          const token = firstString(payload.data.token);
          if (!token) {
            console.error("Rejected reauthentication email: missing token", { run_id });
            return Response.json({ error: "Missing reauthentication token" }, { status: 400 });
          }
          linkStrategy = AUTH_EMAIL_TOTP_STRATEGY;
        } else if (LINK_AUTH_ACTIONS.has(emailType as AuthActionType)) {
          const tokenHash = extractTokenHash(payload.data as Record<string, unknown>);
          if (!tokenHash) {
            console.error("Rejected auth email: missing token_hash", { emailType, run_id });
            return Response.json(
              { error: "Auth email token unavailable", code: "missing_token_hash" },
              { status: 400 },
            );
          }
          const callbackTypeParam =
            AUTH_TYPE_MAP[emailType as keyof typeof AUTH_TYPE_MAP];
          if (!callbackTypeParam || !ALLOWED_CALLBACK_TYPES.has(callbackTypeParam)) {
            console.error("Rejected auth email: no callback type mapping", { emailType, run_id });
            return Response.json({ error: "Unmapped verification type" }, { status: 400 });
          }
          const params = new URLSearchParams({
            token_hash: tokenHash,
            type: callbackTypeParam,
          });
          const nextPath = extractSafeRedirectPath(payload.data as Record<string, unknown>);
          if (nextPath) params.set("next", nextPath);
          confirmationUrl = `https://${ROOT_DOMAIN}${AUTH_EMAIL_CALLBACK_PATH}?${params.toString()}`;
          linkStrategy = AUTH_EMAIL_LINK_STRATEGY;
        } else {
          console.error("Rejected auth email: unhandled action", { emailType, run_id });
          return Response.json({ error: "Unhandled action type" }, { status: 400 });
        }

        const templateProps = {
          siteName: SITE_NAME,
          siteUrl: `https://${ROOT_DOMAIN}`,
          recipient: payload.data.email,
          confirmationUrl,
          token: payload.data.token,
          email: payload.data.email,
          oldEmail: payload.data.old_email,
          newEmail: payload.data.new_email,
        };

        const element = React.createElement(EmailTemplate, templateProps);
        const html = await render(element);
        const text = buildPlainText(emailType, templateProps);

        // ---- Rendered-artifact safety net (belt-and-braces) -----------------
        if (linkStrategy === AUTH_EMAIL_LINK_STRATEGY) {
          const forbidden = containsForbiddenArtifact(html, text);
          if (forbidden) {
            console.error("Rejected auth email: forbidden artifact in rendered body", {
              emailType,
              run_id,
              artifact: forbidden,
            });
            return Response.json(
              { error: "Rendered auth email failed safety check" },
              { status: 500 },
            );
          }
          // Confirm the Tribe callback URL is actually present.
          const expectedHost = `https://${ROOT_DOMAIN}${AUTH_EMAIL_CALLBACK_PATH}`;
          if (!html.includes(expectedHost) || !text.includes(expectedHost)) {
            console.error("Rejected auth email: callback URL missing from rendered body", {
              emailType,
              run_id,
            });
            return Response.json(
              { error: "Rendered auth email missing callback URL" },
              { status: 500 },
            );
          }
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error("Missing Supabase environment variables");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const messageId = crypto.randomUUID();

        const versionMetadata = {
          template_version: AUTH_EMAIL_TEMPLATE_VERSION,
          link_strategy: linkStrategy,
          webhook_deployment: String(webhookDeployment),
          environment,
        };

        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: emailType,
          recipient_email: payload.data.email,
          status: "pending",
          metadata: versionMetadata,
        });

        const { error: enqueueError } = await supabase.rpc("enqueue_email", {
          queue_name: "auth_emails",
          payload: {
            run_id,
            message_id: messageId,
            to: payload.data.email,
            from: `${SITE_NAME} <${FROM_LOCAL_PART}@${FROM_DOMAIN}>`,
            reply_to: REPLY_TO,
            sender_domain: SENDER_DOMAIN,
            subject: EMAIL_SUBJECTS[emailType] || "Notification",
            html,
            text,
            purpose: "transactional",
            label: emailType,
            queued_at: new Date().toISOString(),
            // Versioning fields used by the worker's safety checks.
            template_version: AUTH_EMAIL_TEMPLATE_VERSION,
            link_strategy: linkStrategy,
            webhook_deployment: String(webhookDeployment),
            environment,
          },
        });

        if (enqueueError) {
          console.error("Failed to enqueue auth email", { error: enqueueError, run_id, emailType });
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: emailType,
            recipient_email: payload.data.email,
            status: "failed",
            error_message: "Failed to enqueue email",
            metadata: versionMetadata,
          });
          return Response.json({ error: "Failed to enqueue email" }, { status: 500 });
        }

        console.log("Auth email enqueued", {
          emailType,
          email_redacted: redactEmail(payload.data.email),
          run_id,
          template_version: AUTH_EMAIL_TEMPLATE_VERSION,
          link_strategy: linkStrategy,
          environment,
        });

        return Response.json({ success: true, queued: true });
      },
    },
  },
});
