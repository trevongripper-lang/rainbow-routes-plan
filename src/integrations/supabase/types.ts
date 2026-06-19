export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          body: string
          created_at: string
          destination_id: string
          id: string
          mentions: string[]
          parent_id: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          destination_id: string
          id?: string
          mentions?: string[]
          parent_id?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          destination_id?: string
          id?: string
          mentions?: string[]
          parent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_events: {
        Row: {
          amount: number
          created_at: string
          destination_id: string | null
          id: string
          kind: string
          related_user_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          destination_id?: string | null
          id?: string
          kind: string
          related_user_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          destination_id?: string | null
          id?: string
          kind?: string
          related_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_events_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      destinations: {
        Row: {
          best_months: string | null
          country: string | null
          created_at: string
          description: string | null
          end_date: string | null
          headcount: number
          id: string
          image_url: string | null
          is_past: boolean
          paid_amount_cents: number
          region: string
          start_date: string | null
          title: string
          unlock_status: string
          unlock_tier: string | null
          unlocked_at: string | null
          unlocked_by: string | null
          user_id: string
        }
        Insert: {
          best_months?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          headcount?: number
          id?: string
          image_url?: string | null
          is_past?: boolean
          paid_amount_cents?: number
          region: string
          start_date?: string | null
          title: string
          unlock_status?: string
          unlock_tier?: string | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          user_id: string
        }
        Update: {
          best_months?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          headcount?: number
          id?: string
          image_url?: string | null
          is_past?: boolean
          paid_amount_cents?: number
          region?: string
          start_date?: string | null
          title?: string
          unlock_status?: string
          unlock_tier?: string | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          city: string
          country: string
          description: string | null
          end_date: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          region: string
          start_date: string
          tags: string | null
          url: string | null
        }
        Insert: {
          city: string
          country: string
          description?: string | null
          end_date?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          region: string
          start_date: string
          tags?: string | null
          url?: string | null
        }
        Update: {
          city?: string
          country?: string
          description?: string | null
          end_date?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          region?: string
          start_date?: string
          tags?: string | null
          url?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          destination_id: string
          id: string
          kind: string
          payload: Json
          read_at: string | null
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          destination_id: string
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          destination_id?: string
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      paddle_events: {
        Row: {
          error: string | null
          event_id: string
          event_type: string
          payload: Json
          processed_at: string
          result: string | null
        }
        Insert: {
          error?: string | null
          event_id: string
          event_type: string
          payload: Json
          processed_at?: string
          result?: string | null
        }
        Update: {
          error?: string | null
          event_id?: string
          event_type?: string
          payload?: Json
          processed_at?: string
          result?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_pro: boolean
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          paid_trip_count: number
          plus_renews_at: string | null
          plus_status: string | null
          referred_by: string | null
          stripe_customer_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_pro?: boolean
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          paid_trip_count?: number
          plus_renews_at?: string | null
          plus_status?: string | null
          referred_by?: string | null
          stripe_customer_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_pro?: boolean
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          paid_trip_count?: number
          plus_renews_at?: string | null
          plus_status?: string | null
          referred_by?: string | null
          stripe_customer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          active: boolean
          code: string
          code_expires_at: string | null
          created_at: string
          credits: number
          id: string
          max_redemptions: number | null
          note: string | null
          redemptions_count: number
          validity_days: number
        }
        Insert: {
          active?: boolean
          code: string
          code_expires_at?: string | null
          created_at?: string
          credits: number
          id?: string
          max_redemptions?: number | null
          note?: string | null
          redemptions_count?: number
          validity_days?: number
        }
        Update: {
          active?: boolean
          code?: string
          code_expires_at?: string | null
          created_at?: string
          credits?: number
          id?: string
          max_redemptions?: number | null
          note?: string | null
          redemptions_count?: number
          validity_days?: number
        }
        Relationships: []
      }
      promo_redemptions: {
        Row: {
          credits_granted: number
          expires_at: string
          id: string
          promo_code_id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          credits_granted: number
          expires_at: string
          id?: string
          promo_code_id: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          credits_granted?: number
          expires_at?: string
          id?: string
          promo_code_id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      trip_costs: {
        Row: {
          amount_cents: number
          category: string
          created_at: string
          currency: string
          destination_id: string
          id: string
          is_shared: boolean
          label: string
          note: string | null
          paid_by: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          category: string
          created_at?: string
          currency?: string
          destination_id: string
          id?: string
          is_shared?: boolean
          label: string
          note?: string | null
          paid_by?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          category?: string
          created_at?: string
          currency?: string
          destination_id?: string
          id?: string
          is_shared?: boolean
          label?: string
          note?: string | null
          paid_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_costs_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_events: {
        Row: {
          added_by: string
          created_at: string
          destination_id: string
          event_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          destination_id: string
          event_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          destination_id?: string
          event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_events_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_flights: {
        Row: {
          airline: string | null
          arrive_airport: string | null
          arrive_time: string | null
          confirmation: string | null
          created_at: string
          depart_airport: string | null
          depart_time: string | null
          destination_id: string
          flight_date: string | null
          flight_number: string | null
          id: string
          notes: string | null
          passenger_name: string | null
          user_id: string
        }
        Insert: {
          airline?: string | null
          arrive_airport?: string | null
          arrive_time?: string | null
          confirmation?: string | null
          created_at?: string
          depart_airport?: string | null
          depart_time?: string | null
          destination_id: string
          flight_date?: string | null
          flight_number?: string | null
          id?: string
          notes?: string | null
          passenger_name?: string | null
          user_id: string
        }
        Update: {
          airline?: string | null
          arrive_airport?: string | null
          arrive_time?: string | null
          confirmation?: string | null
          created_at?: string
          depart_airport?: string | null
          depart_time?: string | null
          destination_id?: string
          flight_date?: string | null
          flight_number?: string | null
          id?: string
          notes?: string | null
          passenger_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      trip_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          destination_id: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          destination_id: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          destination_id?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_invites_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_members: {
        Row: {
          destination_id: string
          id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          destination_id: string
          id?: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          destination_id?: string
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_members_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_poll_options: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          label: string
          poll_id: string
          ref_id: string | null
          ref_table: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          label: string
          poll_id: string
          ref_id?: string | null
          ref_table?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          label?: string
          poll_id?: string
          ref_id?: string | null
          ref_table?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "trip_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_poll_votes: {
        Row: {
          created_at: string
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "trip_poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "trip_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_polls: {
        Row: {
          allow_multi: boolean
          closed_at: string | null
          created_at: string
          destination_id: string
          id: string
          kind: string
          question: string
          user_id: string
        }
        Insert: {
          allow_multi?: boolean
          closed_at?: string | null
          created_at?: string
          destination_id: string
          id?: string
          kind?: string
          question: string
          user_id: string
        }
        Update: {
          allow_multi?: boolean
          closed_at?: string | null
          created_at?: string
          destination_id?: string
          id?: string
          kind?: string
          question?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_polls_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_ratings: {
        Row: {
          created_at: string
          destination_id: string
          feedback: string | null
          id: string
          rating: number
          user_id: string
        }
        Insert: {
          created_at?: string
          destination_id: string
          feedback?: string | null
          id?: string
          rating: number
          user_id: string
        }
        Update: {
          created_at?: string
          destination_id?: string
          feedback?: string | null
          id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_ratings_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_stays: {
        Row: {
          created_at: string
          description: string | null
          destination_id: string
          id: string
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          destination_id: string
          id?: string
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          destination_id?: string
          id?: string
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_stays_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_tickets: {
        Row: {
          created_at: string
          currency: string
          destination_id: string
          id: string
          name: string
          notes: string | null
          price_cents: number | null
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          destination_id: string
          id?: string
          name: string
          notes?: string | null
          price_cents?: number | null
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          destination_id?: string
          id?: string
          name?: string
          notes?: string | null
          price_cents?: number | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_tickets_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_credits: {
        Row: {
          earned_at: string
          expires_at: string | null
          id: string
          remaining: number
          source: string
          user_id: string
        }
        Insert: {
          earned_at?: string
          expires_at?: string | null
          id?: string
          remaining?: number
          source: string
          user_id: string
        }
        Update: {
          earned_at?: string
          expires_at?: string | null
          id?: string
          remaining?: number
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      votes: {
        Row: {
          created_at: string
          destination_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          destination_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          destination_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "votes_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _maybe_grant_loyalty: { Args: { _user: string }; Returns: undefined }
      auto_close_trips: { Args: never; Returns: number }
      cleanup_rate_limits: { Args: never; Returns: number }
      fanout_notification: {
        Args: { _actor: string; _dest: string; _kind: string; _payload: Json }
        Returns: undefined
      }
      get_public_profiles: {
        Args: { _ids: string[] }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          is_pro: boolean
          plus_status: string
        }[]
      }
      get_trip_rating_aggregate: {
        Args: { _destination_id: string }
        Returns: {
          avg_rating: number
          feedbacks: string[]
          rating_count: number
        }[]
      }
      grant_referral_credits: {
        Args: { _invitee: string; _inviter: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_trip_member: {
        Args: { _dest: string; _user: string }
        Returns: boolean
      }
      is_trip_owner: {
        Args: { _dest: string; _user: string }
        Returns: boolean
      }
      preview_trip_invite: {
        Args: { _token: string }
        Returns: {
          country: string
          destination_id: string
          expired: boolean
          image_url: string
          region: string
          title: string
          used: boolean
        }[]
      }
      redeem_promo_code: { Args: { _code: string }; Returns: Json }
      redeem_trip_invite: { Args: { _token: string }; Returns: string }
      required_unlock_tier: {
        Args: { _members: number }
        Returns: {
          cents: number
          tier: string
        }[]
      }
      rl_hit: {
        Args: { _key: string; _max: number; _window_seconds: number }
        Returns: Json
      }
      unlock_destination: {
        Args: { _dest: string; _paid_cents?: number; _use_credit: boolean }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
