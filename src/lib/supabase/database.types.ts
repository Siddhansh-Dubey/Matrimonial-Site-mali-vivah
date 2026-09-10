/**
 * TypeScript types for the Supabase `public` schema.
 *
 * Mirrors `supabase/migrations/20260910000000_auth_profiles.sql`.
 * If you change the SQL, update this file to match (or regenerate it with
 * `supabase gen types typescript --project-id <ref>` and replace this file).
 *
 * Tables:
 * - profiles      — one row per registered user (id = auth.users.id)
 * - login_history — one row per successful login (written by record_login RPC)
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string
          mobile: string | null
          for_whom: Database['public']['Enums']['for_whom']
          terms_accepted_at: string
          email_verified: boolean
          mobile_verified: boolean
          is_active: boolean
          last_login_at: string | null
          login_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          mobile?: string | null
          for_whom?: Database['public']['Enums']['for_whom']
          terms_accepted_at?: string
          email_verified?: boolean
          mobile_verified?: boolean
          is_active?: boolean
          last_login_at?: string | null
          login_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          mobile?: string | null
          for_whom?: Database['public']['Enums']['for_whom']
          terms_accepted_at?: string
          email_verified?: boolean
          mobile_verified?: boolean
          is_active?: boolean
          last_login_at?: string | null
          login_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey'
            columns: ['id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      login_history: {
        Row: {
          id: number
          user_id: string
          logged_in_at: string
          success: boolean
          note: string | null
        }
        Insert: {
          id?: never
          user_id: string
          logged_in_at?: string
          success?: boolean
          note?: string | null
        }
        Update: {
          id?: never
          user_id?: string
          logged_in_at?: string
          success?: boolean
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'login_history_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_login: {
        Args: Record<string, never>
        Returns: undefined
      }
    }
    Enums: {
      for_whom: 'self' | 'son' | 'daughter'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']
export type LoginHistoryRow = Database['public']['Tables']['login_history']['Row']
