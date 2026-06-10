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
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data: p } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, is_pro")
        .eq("id", u.user.id)
        .maybeSingle();
      return (p as MyProfile | null) ?? {
        id: u.user.id,
        display_name: null,
        avatar_url: null,
        is_pro: false,
      };
    },
    staleTime: 60_000,
  });
}
