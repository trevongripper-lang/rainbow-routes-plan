import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/join/$token")({
  head: () => ({
    meta: [
      { title: "Join a trip — Tribe Trips" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: JoinPage,
});

type Preview = {
  destination_id: string;
  title: string;
  region: string;
  country: string | null;
  image_url: string | null;
  expired: boolean;
  used: boolean;
};

function JoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: async (): Promise<Preview | null> => {
      const { data, error } = await supabase.rpc("preview_trip_invite", { _token: token });
      if (error) throw error;
      const row = (data as Preview[] | null)?.[0];
      return row ?? null;
    },
  });

  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("redeem_trip_invite", { _token: token });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (destinationId) => {
      toast.success("Welcome to the crew!");
      navigate({ to: "/trips/$id", params: { id: destinationId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't join"),
  });

  if (isLoading) return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading invite…</div>;
  if (!data) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <h1 className="font-display text-3xl">Invite not found</h1>
          <p className="mt-2 text-muted-foreground">This link is invalid or has been revoked.</p>
          <Link to="/" className="mt-6 inline-block text-primary hover:underline">Go home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 py-12">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl">
        {data.image_url ? (
          <img src={data.image_url} alt={data.title} className="aspect-[16/9] w-full object-cover" />
        ) : (
          <div className="aspect-[16/9] w-full" style={{ background: "var(--gradient-hero)" }} />
        )}
        <div className="p-6">
          <p className="text-xs uppercase tracking-wide text-primary">You're invited</p>
          <h1 className="mt-1 font-display text-3xl">{data.title}</h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-4 text-primary" /> {data.region}{data.country ? ` · ${data.country}` : ""}
          </p>

          {data.expired ? (
            <p className="mt-6 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">This invite has expired.</p>
          ) : data.used ? (
            <p className="mt-6 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">This invite has already been used.</p>
          ) : signedIn === false ? (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-muted-foreground">Sign in to join this trip.</p>
              <Button asChild className="w-full">
                <Link to="/auth" search={{ redirect: `/join/${token}` } as never}>Sign in to join</Link>
              </Button>
            </div>
          ) : (
            <Button onClick={() => accept.mutate()} disabled={accept.isPending} className="mt-6 w-full">
              {accept.isPending ? "Joining…" : "Join trip"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
