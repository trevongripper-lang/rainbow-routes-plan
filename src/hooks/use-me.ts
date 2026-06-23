import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MyProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_pro: boolean;
};

export function useMe() {
  return useQuery({
    queryKey: ["me", "profile"],
    queryFn: async (): Promise<MyProfile | null> => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return null;
      const userId = s.session.user.id;
      const { data: p } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, is_pro")
        .eq("id", userId)
        .eq("id", u.user.id)
        .maybeSingle();
      return (p as MyProfile | null) ?? {
        id: u.user.id,
        display_name: null,
        avatar_url: null,
        is_pro: false,
      };
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

}
