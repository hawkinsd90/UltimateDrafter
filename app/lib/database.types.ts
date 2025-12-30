export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      leagues: {
        Row: {
          id: string
          name: string
          sport: string
          season: string
          owner_id: string
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          sport: string
          season: string
          owner_id: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          sport?: string
          season?: string
          owner_id?: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
      }
      drafts: {
        Row: {
          id: string
          league_id: string
          name: string
          draft_type: string
          status: string
          current_pick_number: number
          current_participant_id: string | null
          pick_time_seconds: number
          start_time: string | null
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          league_id: string
          name: string
          draft_type?: string
          status?: string
          current_pick_number?: number
          current_participant_id?: string | null
          pick_time_seconds?: number
          start_time?: string | null
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          name?: string
          draft_type?: string
          status?: string
          current_pick_number?: number
          current_participant_id?: string | null
          pick_time_seconds?: number
          start_time?: string | null
          settings?: Json
          created_at?: string
          updated_at?: string
        }
      }
      players: {
        Row: {
          id: string
          external_id: string | null
          name: string
          position: string
          team: string | null
          sport: string
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          external_id?: string | null
          name: string
          position: string
          team?: string | null
          sport: string
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          external_id?: string | null
          name?: string
          position?: string
          team?: string | null
          sport?: string
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
      }
      draft_participants: {
        Row: {
          id: string
          draft_id: string
          user_id: string
          team_name: string
          draft_position: number
          phone_number: string | null
          email: string | null
          notification_preferences: Json
          joined_at: string
        }
        Insert: {
          id?: string
          draft_id: string
          user_id: string
          team_name: string
          draft_position: number
          phone_number?: string | null
          email?: string | null
          notification_preferences?: Json
          joined_at?: string
        }
        Update: {
          id?: string
          draft_id?: string
          user_id?: string
          team_name?: string
          draft_position?: number
          phone_number?: string | null
          email?: string | null
          notification_preferences?: Json
          joined_at?: string
        }
      }
      draft_picks: {
        Row: {
          id: string
          draft_id: string
          participant_id: string
          player_id: string | null
          pick_number: number
          round: number
          pick_in_round: number
          picked_at: string
          time_taken_seconds: number
          is_autopick: boolean
        }
        Insert: {
          id?: string
          draft_id: string
          participant_id: string
          player_id?: string | null
          pick_number: number
          round: number
          pick_in_round: number
          picked_at?: string
          time_taken_seconds?: number
          is_autopick?: boolean
        }
        Update: {
          id?: string
          draft_id?: string
          participant_id?: string
          player_id?: string | null
          pick_number?: number
          round?: number
          pick_in_round?: number
          picked_at?: string
          time_taken_seconds?: number
          is_autopick?: boolean
        }
      }
      notifications_outbox: {
        Row: {
          id: string
          draft_id: string | null
          participant_id: string | null
          notification_type: string
          channel: string
          recipient: string
          message: string
          status: string
          metadata: Json
          created_at: string
          sent_at: string | null
          error: string | null
        }
        Insert: {
          id?: string
          draft_id?: string | null
          participant_id?: string | null
          notification_type: string
          channel: string
          recipient: string
          message: string
          status?: string
          metadata?: Json
          created_at?: string
          sent_at?: string | null
          error?: string | null
        }
        Update: {
          id?: string
          draft_id?: string | null
          participant_id?: string | null
          notification_type?: string
          channel?: string
          recipient?: string
          message?: string
          status?: string
          metadata?: Json
          created_at?: string
          sent_at?: string | null
          error?: string | null
        }
      }
      user_settings: {
        Row: {
          id: string
          user_id: string
          phone_number: string | null
          email: string | null
          notify_on_turn: boolean
          notify_on_pick_made: boolean
          notify_on_draft_start: boolean
          preferred_channel: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          phone_number?: string | null
          email?: string | null
          notify_on_turn?: boolean
          notify_on_pick_made?: boolean
          notify_on_draft_start?: boolean
          preferred_channel?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          phone_number?: string | null
          email?: string | null
          notify_on_turn?: boolean
          notify_on_pick_made?: boolean
          notify_on_draft_start?: boolean
          preferred_channel?: string
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
