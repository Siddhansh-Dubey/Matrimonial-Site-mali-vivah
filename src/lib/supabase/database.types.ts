/**
 * TypeScript types for the Supabase `public` schema.
 *
 * Mirrors:
 * - supabase/migrations/20260910000000_auth_profiles.sql
 * - supabase/migrations/20260911000000_matrimony_profiles.sql
 * - supabase/migrations/20260911120000_repair_missing_profiles.sql
 * - supabase/migrations/20260912000000_packages_mutual.sql
 *
 * If you change either SQL file, update this file to match (or regenerate it
 * with `supabase gen types typescript --project-id <ref>` and replace this file).
 *
 * Tables:
 * - profiles             — one row per registered user (id = auth.users.id)
 * - login_history        — one row per successful login (written by record_login RPC)
 * - matrimony_profiles   — detailed member profile (1:1 with profiles.id)
 * - profile_photos       — photos for a matrimony profile
 * - partner_preferences  — "what you are looking for" (private)
 * - interests            — Express Interest (sender → receiver)
 * - shortlists           — saved / favourite profiles
 * - profile_views        — "who viewed my profile"
 * - packages             — membership plans for purchase
 * - subscriptions        — one row per purchase (user → package)
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
      matrimony_profiles: {
        Row: {
          user_id: string
          profile_for: Database['public']['Enums']['for_whom']
          gender: Database['public']['Enums']['gender'] | null
          date_of_birth: string | null
          height_cm: number | null
          religion: string
          sub_community: string | null
          mother_tongue: string
          marital_status: Database['public']['Enums']['marital_status']
          education: string | null
          education_details: string | null
          occupation: string | null
          annual_income: string | null
          city: string | null
          state: string
          country: string
          diet: Database['public']['Enums']['diet']
          gotra: string | null
          about_me: string | null
          hobbies: string[]
          status: Database['public']['Enums']['profile_status']
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          profile_for?: Database['public']['Enums']['for_whom']
          gender?: Database['public']['Enums']['gender'] | null
          date_of_birth?: string | null
          height_cm?: number | null
          religion?: string
          sub_community?: string | null
          mother_tongue?: string
          marital_status?: Database['public']['Enums']['marital_status']
          education?: string | null
          education_details?: string | null
          occupation?: string | null
          annual_income?: string | null
          city?: string | null
          state?: string
          country?: string
          diet?: Database['public']['Enums']['diet']
          gotra?: string | null
          about_me?: string | null
          hobbies?: string[]
          status?: Database['public']['Enums']['profile_status']
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          profile_for?: Database['public']['Enums']['for_whom']
          gender?: Database['public']['Enums']['gender'] | null
          date_of_birth?: string | null
          height_cm?: number | null
          religion?: string
          sub_community?: string | null
          mother_tongue?: string
          marital_status?: Database['public']['Enums']['marital_status']
          education?: string | null
          education_details?: string | null
          occupation?: string | null
          annual_income?: string | null
          city?: string | null
          state?: string
          country?: string
          diet?: Database['public']['Enums']['diet']
          gotra?: string | null
          about_me?: string | null
          hobbies?: string[]
          status?: Database['public']['Enums']['profile_status']
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'matrimony_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profile_photos: {
        Row: {
          id: number
          profile_id: string
          storage_path: string
          is_primary: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: never
          profile_id: string
          storage_path: string
          is_primary?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: never
          profile_id?: string
          storage_path?: string
          is_primary?: boolean
          sort_order?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profile_photos_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'matrimony_profiles'
            referencedColumns: ['user_id']
          },
        ]
      }
      partner_preferences: {
        Row: {
          profile_id: string
          preferred_gender: Database['public']['Enums']['gender']
          min_age: number
          max_age: number
          min_height_cm: number | null
          max_height_cm: number | null
          preferred_cities: string[]
          preferred_sub_communities: string[]
          preferred_education: string | null
          preferred_occupation: string | null
          preferred_marital_status: Database['public']['Enums']['marital_status'] | null
          preferred_diet: Database['public']['Enums']['diet'] | null
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          preferred_gender?: Database['public']['Enums']['gender']
          min_age?: number
          max_age?: number
          min_height_cm?: number | null
          max_height_cm?: number | null
          preferred_cities?: string[]
          preferred_sub_communities?: string[]
          preferred_education?: string | null
          preferred_occupation?: string | null
          preferred_marital_status?: Database['public']['Enums']['marital_status'] | null
          preferred_diet?: Database['public']['Enums']['diet'] | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          preferred_gender?: Database['public']['Enums']['gender']
          min_age?: number
          max_age?: number
          min_height_cm?: number | null
          max_height_cm?: number | null
          preferred_cities?: string[]
          preferred_sub_communities?: string[]
          preferred_education?: string | null
          preferred_occupation?: string | null
          preferred_marital_status?: Database['public']['Enums']['marital_status'] | null
          preferred_diet?: Database['public']['Enums']['diet'] | null
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'partner_preferences_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'matrimony_profiles'
            referencedColumns: ['user_id']
          },
        ]
      }
      interests: {
        Row: {
          id: number
          sender_id: string
          receiver_id: string
          status: Database['public']['Enums']['interest_status']
          message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: never
          sender_id: string
          receiver_id: string
          status?: Database['public']['Enums']['interest_status']
          message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: never
          sender_id?: string
          receiver_id?: string
          status?: Database['public']['Enums']['interest_status']
          message?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'interests_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'interests_receiver_id_fkey'
            columns: ['receiver_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      shortlists: {
        Row: {
          id: number
          user_id: string
          target_id: string
          created_at: string
        }
        Insert: {
          id?: never
          user_id: string
          target_id: string
          created_at?: string
        }
        Update: {
          id?: never
          user_id?: string
          target_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'shortlists_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'shortlists_target_id_fkey'
            columns: ['target_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profile_views: {
        Row: {
          id: number
          viewer_id: string
          viewed_id: string
          viewed_at: string
        }
        Insert: {
          id?: never
          viewer_id: string
          viewed_id: string
          viewed_at?: string
        }
        Update: {
          id?: never
          viewer_id?: string
          viewed_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profile_views_viewer_id_fkey'
            columns: ['viewer_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_views_viewed_id_fkey'
            columns: ['viewed_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      packages: {
        Row: {
          id: number
          slug: string
          name: string
          description: string
          price_inr: number
          duration_days: number
          features: string[]
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: never
          slug: string
          name: string
          description?: string
          price_inr?: number
          duration_days?: number
          features?: string[]
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: never
          slug?: string
          name?: string
          description?: string
          price_inr?: number
          duration_days?: number
          features?: string[]
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          id: number
          user_id: string
          package_id: number | null
          package_slug: string | null
          status: Database['public']['Enums']['subscription_status']
          started_at: string
          expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: never
          user_id: string
          package_id?: number | null
          package_slug?: string | null
          status?: Database['public']['Enums']['subscription_status']
          started_at?: string
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: never
          user_id?: string
          package_id?: number | null
          package_slug?: string | null
          status?: Database['public']['Enums']['subscription_status']
          started_at?: string
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'subscriptions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subscriptions_package_id_fkey'
            columns: ['package_id']
            isOneToOne: false
            referencedRelation: 'packages'
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
      ensure_my_profile: {
        Args: Record<string, never>
        Returns: undefined
      }
      search_matches: {
        Args: {
          p_looking_for?: Database['public']['Enums']['gender'] | null
          p_min_age?: number | null
          p_max_age?: number | null
          p_city?: string | null
          p_sub_community?: string | null
          p_limit?: number | null
        }
        Returns: Json
      }
      get_public_profile: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      has_active_subscription: {
        Args: {
          p_user_id?: string | null
        }
        Returns: boolean
      }
      mutual_interest_exists: {
        Args: {
          p_a: string
          p_b: string
        }
        Returns: boolean
      }
      get_profile_contact: {
        Args: {
          p_user_id: string
        }
        Returns: string | null
      }
    }
    Enums: {
      for_whom: 'self' | 'son' | 'daughter'
      gender: 'male' | 'female'
      marital_status: 'never_married' | 'divorced' | 'widowed' | 'awaiting_divorce'
      diet: 'vegetarian' | 'non_vegetarian' | 'eggetarian' | 'jain' | 'vegan'
      profile_status: 'draft' | 'pending_review' | 'active' | 'hidden' | 'rejected'
      interest_status: 'pending' | 'accepted' | 'declined' | 'withdrawn'
      subscription_status: 'active' | 'expired' | 'cancelled'
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

export type MatrimonyProfile = Database['public']['Tables']['matrimony_profiles']['Row']
export type MatrimonyProfileInsert = Database['public']['Tables']['matrimony_profiles']['Insert']
export type MatrimonyProfileUpdate = Database['public']['Tables']['matrimony_profiles']['Update']
export type PartnerPreferences = Database['public']['Tables']['partner_preferences']['Row']
export type PartnerPreferencesInsert = Database['public']['Tables']['partner_preferences']['Insert']
export type ProfilePhoto = Database['public']['Tables']['profile_photos']['Row']
export type Interest = Database['public']['Tables']['interests']['Row']
export type Shortlist = Database['public']['Tables']['shortlists']['Row']
export type PackageRow = Database['public']['Tables']['packages']['Row']
export type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row']

export type Gender = Database['public']['Enums']['gender']
export type MaritalStatus = Database['public']['Enums']['marital_status']
export type Diet = Database['public']['Enums']['diet']
export type ProfileStatus = Database['public']['Enums']['profile_status']
export type InterestStatus = Database['public']['Enums']['interest_status']
export type SubscriptionStatus = Database['public']['Enums']['subscription_status']

/**
 * A single card returned by the search_matches() RPC.
 * v2 keys (gender / name_full / viewer_is_paid) are optional so the app also
 * works against a database where the packages migration has not been applied yet.
 */
export type MatchCard = {
  user_id: string
  name: string
  age: number
  height_cm: number | null
  sub_community: string | null
  marital_status: MaritalStatus
  education: string | null
  occupation: string | null
  city: string | null
  state: string
  diet: Diet
  photo: string | null
  has_photo: boolean
  gender?: Gender | null
  name_full?: string | null
  viewer_is_paid?: boolean | null
}

/** A single card returned by the get_public_profile() RPC (v2 keys optional, see above). */
export type PublicProfileCard = {
  id: string
  name: string
  age: number | null
  height_cm: number | null
  religion: string
  sub_community: string | null
  mother_tongue: string
  marital_status: MaritalStatus
  education: string | null
  education_details: string | null
  occupation: string | null
  annual_income: string | null
  city: string | null
  state: string
  country: string
  diet: Diet
  gotra: string | null
  about_me: string | null
  hobbies: string[]
  photos: string[]
  gender?: Gender | null
  name_full?: string | null
  viewer_is_paid?: boolean | null
  mutual_interest?: boolean | null
  contact_phone?: string | null
}
