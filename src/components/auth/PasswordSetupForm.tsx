import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PasswordSetupFormProps = {
  /** Copy shown above the fields. */
  intro?: string;
  /** Button label. Defaults to "Update password". */
  submitLabel?: string;
  /** Called after `supabase.auth.updateUser({ password })` succeeds. */
  onSuccess: () => void | Promise<void>;
  /**
   * Whether to also sign the user out immediately after updating the
   * password. Reset-password flows want this so the recovery session
   * can't be reused; first-time-setup flows leave the session in place
   * so the caller can navigate straight into the app.
   */
  signOutAfter?: boolean;
  /** Minimum characters. Defaults to 8. */
  minLength?: number;
};

/**
 * Shared password-setup form. Used by both `/reset-password` (recovery
 * flow) and `/auth/set-password` (first-time / anonymous-upgrade flow).
 *
 * Consolidating the two into one component means:
 * - identical minimum-length + confirm-match rules everywhere,
 * - identical error copy and toast surface,
 * - one place to add future rules (HIBP hint, strength meter, …).
 */
export function PasswordSetupForm({
  intro,
  submitLabel = "Update password",
  onSuccess,
  signOutAfter = false,
  minLength = 8,
}: PasswordSetupFormProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < minLength) {
      toast.error(`Use at least ${minLength} characters.`);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (signOutAfter) {
        await supabase.auth.signOut();
      }
      await onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-3">
      {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
      <div>
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Saving…" : submitLabel}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Tip: a passphrase like <span className="font-mono">poolside-spritz-2026</span> beats{" "}
        <span className="font-mono">P@ssw0rd!</span>.
      </p>
    </form>
  );
}
