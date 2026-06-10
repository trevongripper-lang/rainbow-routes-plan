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
          region: string
          title: string
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
          region: string
          title: string
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
          region?: string
          title?: string
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_pro: boolean
          stripe_customer_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_pro?: boolean
          stripe_customer_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_pro?: boolean
          stripe_customer_id?: string | null
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
      auto_close_trips: { Args: never; Returns: number }
      fanout_notification: {
        Args: { _actor: string; _dest: string; _kind: string; _payload: Json }
        Returns: undefined
      }
      get_trip_rating_aggregate: {
        Args: { _destination_id: string }
        Returns: {
          avg_rating: number
          feedbacks: string[]
          rating_count: number
        }[]
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
      redeem_trip_invite: { Args: { _token: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
