import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PaddleConfigIssue = {
  secret: string;
  tier?: "tier1" | "tier2" | "tier3";
  problem: "missing" | "invalid_prefix" | "wrong_environment" | "empty";
  message: string;
};

export type PaddleConfigReport = {
  ok: boolean;
  environment: "sandbox" | "production";
  issues: PaddleConfigIssue[];
  checked: string[];
};

function checkPriceSecret(
  name: string,
  tier: "tier1" | "tier2" | "tier3",
  value: string | undefined,
): PaddleConfigIssue | null {
  if (value === undefined) {
    return { secret: name, tier, problem: "missing", message: `${name} is not set.` };
  }
  if (value.trim() === "") {
    return { secret: name, tier, problem: "empty", message: `${name} is empty.` };
  }
  if (!value.startsWith("pri_")) {
    const hint = value.startsWith("pro_")
      ? " You provided a product ID (pro_…); use the price ID (pri_…) from Paddle → Catalog → Products → Prices."
      : "";
    return {
      secret: name,
      tier,
      problem: "invalid_prefix",
      message: `${name} must start with "pri_" (got "${value.slice(0, 8)}…").${hint}`,
    };
  }
  return null;
}

/**
 * Validates all Paddle-related secrets and reports which ones (if any)
 * are misconfigured. Admin/owner authentication required.
 */
export const validatePaddleConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<PaddleConfigReport> => {
    const environment = (process.env.PADDLE_ENVIRONMENT ?? "sandbox") as
      | "sandbox"
      | "production";
    const issues: PaddleConfigIssue[] = [];
    const checked = [
      "PADDLE_CLIENT_TOKEN",
      "PADDLE_PRICE_TIER1",
      "PADDLE_PRICE_TIER2",
      "PADDLE_PRICE_TIER3",
      "PADDLE_WEBHOOK_SECRET",
    ];

    const token = process.env.PADDLE_CLIENT_TOKEN;
    const expectedPrefix = environment === "sandbox" ? "test_" : "live_";
    if (!token) {
      issues.push({
        secret: "PADDLE_CLIENT_TOKEN",
        problem: "missing",
        message: "PADDLE_CLIENT_TOKEN is not set.",
      });
    } else if (!token.startsWith(expectedPrefix)) {
      issues.push({
        secret: "PADDLE_CLIENT_TOKEN",
        problem: "wrong_environment",
        message: `PADDLE_CLIENT_TOKEN must start with "${expectedPrefix}" for ${environment} (got "${token.slice(0, 6)}…").`,
      });
    }

    const tiers: Array<["tier1" | "tier2" | "tier3", string]> = [
      ["tier1", "PADDLE_PRICE_TIER1"],
      ["tier2", "PADDLE_PRICE_TIER2"],
      ["tier3", "PADDLE_PRICE_TIER3"],
    ];
    for (const [tier, name] of tiers) {
      const issue = checkPriceSecret(name, tier, process.env[name]);
      if (issue) issues.push(issue);
    }

    if (!process.env.PADDLE_WEBHOOK_SECRET) {
      issues.push({
        secret: "PADDLE_WEBHOOK_SECRET",
        problem: "missing",
        message: "PADDLE_WEBHOOK_SECRET is not set (webhook signature verification will fail).",
      });
    }

    return { ok: issues.length === 0, environment, issues, checked };
  });
