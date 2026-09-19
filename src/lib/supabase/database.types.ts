/**
 * TypeScript types for the Supabase `public` schema.
 *
 * Hand-maintained to mirror supabase/migrations/*.sql:
 * - 20260910000000_auth_profiles.sql          (profiles, login history)
 * - 20260911000000_matrimony_profiles.sql     (matrimony profiles, photos, prefs, interests, views)
 * - 20260911120000_repair_missing_profiles.sql (ensure_my_profile RPC)
 * - 20260912000000_packages_mutual.sql        (packages, subscriptions, mutual interest)
 * - 20260912130000_public_profile_browse.sql  (public browse)
 * - 20260915000000_enum_extensions.sql        (Phase 1 enums)
 * - 20260915010000_profile_model_family_photo.sql (communities, family photo, publish gate)
 * - 20260919080000_community_hierarchy_integrity.sql (hierarchy trigger, community key on cards)
 * - 20260915020000_packages_pricing.sql       (canonical pricing, membership resolvers)
 * - 20260915030000_notifications.sql          (notifications + bell RPCs)
 * - 20260915100000_visibility.sql             (is_profile_public, visibility reason, sweeps)
 * - 20260915110000_payments.sql               (payments, activity_events, subscriptions lockdown)
 * - 20260915120000_safety_interests.sql       (blocks, reports, express_interest, deletion)
 * - 20260915130000_engagement_admin.sql       (Daily 5, boosts, featured, verification, moments, stories, admin)
 * - 20260915140000_activity_login_register.sql (registration + login activity events)
 * - 20260917000000_notification_enum_message_received.sql (notification_type += message_received)
 * - 20260917010000_chat.sql                   (conversations, conversation_members, messages + chat RPCs)
 *
 * If you change the SQL, update this file to match.
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
          is_admin: boolean
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
          is_admin?: boolean
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
          is_admin?: boolean
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
          community_id: string | null
          sub_community_id: string | null
          mother_tongue: string
          marital_status: Database['public']['Enums']['marital_status']
          education: string | null
          education_details: string | null
          occupation: string | null
          company: string | null
          business_name: string | null
          annual_income: string | null
          city: string | null
          state: string
          country: string
          native_place: string | null
          diet: Database['public']['Enums']['diet']
          smoking: Database['public']['Enums']['lifestyle_choice']
          drinking: Database['public']['Enums']['lifestyle_choice']
          gotra: string | null
          about_me: string | null
          hobbies: string[]
          father_occupation: string | null
          mother_occupation: string | null
          siblings: string | null
          family_type: Database['public']['Enums']['family_type']
          family_location: string | null
          family_details: string | null
          privacy_settings: Json
          whatsapp_opt_in: boolean
          verified_at: string | null
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
          community_id?: string | null
          sub_community_id?: string | null
          mother_tongue?: string
          marital_status?: Database['public']['Enums']['marital_status']
          education?: string | null
          education_details?: string | null
          occupation?: string | null
          company?: string | null
          business_name?: string | null
          annual_income?: string | null
          city?: string | null
          state?: string
          country?: string
          native_place?: string | null
          diet?: Database['public']['Enums']['diet']
          smoking?: Database['public']['Enums']['lifestyle_choice']
          drinking?: Database['public']['Enums']['lifestyle_choice']
          gotra?: string | null
          about_me?: string | null
          hobbies?: string[]
          father_occupation?: string | null
          mother_occupation?: string | null
          siblings?: string | null
          family_type?: Database['public']['Enums']['family_type']
          family_location?: string | null
          family_details?: string | null
          privacy_settings?: Json
          whatsapp_opt_in?: boolean
          verified_at?: string | null
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
          community_id?: string | null
          sub_community_id?: string | null
          mother_tongue?: string
          marital_status?: Database['public']['Enums']['marital_status']
          education?: string | null
          education_details?: string | null
          occupation?: string | null
          company?: string | null
          business_name?: string | null
          annual_income?: string | null
          city?: string | null
          state?: string
          country?: string
          native_place?: string | null
          diet?: Database['public']['Enums']['diet']
          smoking?: Database['public']['Enums']['lifestyle_choice']
          drinking?: Database['public']['Enums']['lifestyle_choice']
          gotra?: string | null
          about_me?: string | null
          hobbies?: string[]
          father_occupation?: string | null
          mother_occupation?: string | null
          siblings?: string | null
          family_type?: Database['public']['Enums']['family_type']
          family_location?: string | null
          family_details?: string | null
          privacy_settings?: Json
          whatsapp_opt_in?: boolean
          verified_at?: string | null
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
          {
            foreignKeyName: 'matrimony_profiles_community_id_fkey'
            columns: ['community_id']
            isOneToOne: false
            referencedRelation: 'communities'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'matrimony_profiles_sub_community_id_fkey'
            columns: ['sub_community_id']
            isOneToOne: false
            referencedRelation: 'sub_communities'
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
          kind: Database['public']['Enums']['photo_kind']
          created_at: string
        }
        Insert: {
          id?: never
          profile_id: string
          storage_path: string
          is_primary?: boolean
          sort_order?: number
          kind?: Database['public']['Enums']['photo_kind']
          created_at?: string
        }
        Update: {
          id?: never
          profile_id?: string
          storage_path?: string
          is_primary?: boolean
          sort_order?: number
          kind?: Database['public']['Enums']['photo_kind']
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
          preferred_income: string | null
          preferred_communities: string[]
          preferred_native_place: string | null
          preferred_family_type: Database['public']['Enums']['family_type'] | null
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
          preferred_income?: string | null
          preferred_communities?: string[]
          preferred_native_place?: string | null
          preferred_family_type?: Database['public']['Enums']['family_type'] | null
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
          preferred_income?: string | null
          preferred_communities?: string[]
          preferred_native_place?: string | null
          preferred_family_type?: Database['public']['Enums']['family_type'] | null
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
          duration_months: number | null
          tier: Database['public']['Enums']['membership_tier']
          benefits: Json
          features: string[]
          is_popular: boolean
          badge_text: string | null
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
          duration_months?: number | null
          tier?: Database['public']['Enums']['membership_tier']
          benefits?: Json
          features?: string[]
          is_popular?: boolean
          badge_text?: string | null
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
          duration_months?: number | null
          tier?: Database['public']['Enums']['membership_tier']
          benefits?: Json
          features?: string[]
          is_popular?: boolean
          badge_text?: string | null
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
          payment_id: string | null
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
          payment_id?: string | null
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
          payment_id?: string | null
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
      payments: {
        Row: {
          id: string
          user_id: string
          package_id: number | null
          package_slug: string | null
          kind: 'package' | 'boost'
          amount_inr: number
          currency: string
          status: Database['public']['Enums']['payment_status']
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          failure_reason: string | null
          membership_started_at: string | null
          membership_expires_at: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          package_id?: number | null
          package_slug?: string | null
          kind?: 'package' | 'boost'
          amount_inr: number
          currency?: string
          status?: Database['public']['Enums']['payment_status']
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          failure_reason?: string | null
          membership_started_at?: string | null
          membership_expires_at?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          package_id?: number | null
          package_slug?: string | null
          kind?: 'package' | 'boost'
          amount_inr?: number
          currency?: string
          status?: Database['public']['Enums']['payment_status']
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          failure_reason?: string | null
          membership_started_at?: string | null
          membership_expires_at?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          id: number
          user_id: string
          type: Database['public']['Enums']['notification_type']
          title: string
          message: string
          metadata: Json
          link: string | null
          is_read: boolean
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: never
          user_id: string
          type: Database['public']['Enums']['notification_type']
          title: string
          message?: string
          metadata?: Json
          link?: string | null
          is_read?: boolean
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          user_id?: string
          type?: Database['public']['Enums']['notification_type']
          title?: string
          message?: string
          metadata?: Json
          link?: string | null
          is_read?: boolean
          read_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      communities: {
        Row: {
          id: string
          slug: string
          name: string
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sub_communities: {
        Row: {
          id: string
          community_id: string
          slug: string
          name: string
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          community_id: string
          slug: string
          name: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          community_id?: string
          slug?: string
          name?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sub_communities_community_id_fkey'
            columns: ['community_id']
            isOneToOne: false
            referencedRelation: 'communities'
            referencedColumns: ['id']
          },
        ]
      }
      blocks: {
        Row: {
          id: number
          blocker_id: string
          blocked_id: string
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: never
          blocker_id: string
          blocked_id: string
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          blocker_id?: string
          blocked_id?: string
          reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'blocks_blocker_id_fkey'
            columns: ['blocker_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'blocks_blocked_id_fkey'
            columns: ['blocked_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      reports: {
        Row: {
          id: number
          reporter_id: string
          reported_id: string
          reason: Database['public']['Enums']['report_reason']
          details: string | null
          status: Database['public']['Enums']['report_status']
          target_type: 'profile' | 'moment'
          target_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: never
          reporter_id: string
          reported_id: string
          reason?: Database['public']['Enums']['report_reason']
          details?: string | null
          status?: Database['public']['Enums']['report_status']
          target_type?: 'profile' | 'moment'
          target_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: never
          reporter_id?: string
          reported_id?: string
          reason?: Database['public']['Enums']['report_reason']
          details?: string | null
          status?: Database['public']['Enums']['report_status']
          target_type?: 'profile' | 'moment'
          target_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reports_reporter_id_fkey'
            columns: ['reporter_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reports_reported_id_fkey'
            columns: ['reported_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      account_deletion_requests: {
        Row: {
          id: number
          user_id: string
          reason: string | null
          status: 'pending' | 'processed' | 'cancelled'
          created_at: string
          processed_at: string | null
        }
        Insert: {
          id?: never
          user_id: string
          reason?: string | null
          status?: 'pending' | 'processed' | 'cancelled'
          created_at?: string
          processed_at?: string | null
        }
        Update: {
          id?: never
          user_id?: string
          reason?: string | null
          status?: 'pending' | 'processed' | 'cancelled'
          created_at?: string
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'account_deletion_requests_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      activity_events: {
        Row: {
          id: number
          user_id: string | null
          event: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: never
          user_id?: string | null
          event: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: never
          user_id?: string | null
          event?: string
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'activity_events_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      matching_config: {
        Row: {
          id: number
          threshold: number
          weights: Json
          daily_count: number
          updated_at: string
        }
        Insert: {
          id?: number
          threshold?: number
          weights?: Json
          daily_count?: number
          updated_at?: string
        }
        Update: {
          id?: number
          threshold?: number
          weights?: Json
          daily_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      profile_boosts: {
        Row: {
          id: number
          user_id: string
          status: Database['public']['Enums']['boost_status']
          started_at: string
          expires_at: string
          created_via: string
          payment_id: string | null
          created_at: string
        }
        Insert: {
          id?: never
          user_id: string
          status?: Database['public']['Enums']['boost_status']
          started_at?: string
          /** No column default since 20260919060000 — always computed from profile_boost_config.duration_days. */
          expires_at: string
          created_via?: string
          /** Deprecated: the payment link lives in profile_boost_entitlements. */
          payment_id?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          user_id?: string
          status?: Database['public']['Enums']['boost_status']
          started_at?: string
          expires_at?: string
          created_via?: string
          payment_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profile_boosts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profile_boost_entitlements: {
        Row: {
          id: number
          user_id: string
          boost_id: number
          source: 'package' | 'admin' | 'purchase'
          payment_id: string | null
          duration_days: number
          starts_at: string
          ends_at: string
          status: 'granted' | 'revoked'
          granted_by: string | null
          created_at: string
          revoked_at: string | null
        }
        Insert: {
          id?: never
          user_id: string
          boost_id: number
          source: 'package' | 'admin' | 'purchase'
          payment_id?: string | null
          duration_days: number
          starts_at: string
          ends_at: string
          status?: 'granted' | 'revoked'
          granted_by?: string | null
          created_at?: string
          revoked_at?: string | null
        }
        Update: {
          id?: never
          user_id?: string
          boost_id?: number
          source?: 'package' | 'admin' | 'purchase'
          payment_id?: string | null
          duration_days?: number
          starts_at?: string
          ends_at?: string
          status?: 'granted' | 'revoked'
          granted_by?: string | null
          created_at?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'profile_boost_entitlements_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_boost_entitlements_boost_id_fkey'
            columns: ['boost_id']
            isOneToOne: false
            referencedRelation: 'profile_boosts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_boost_entitlements_payment_id_fkey'
            columns: ['payment_id']
            isOneToOne: false
            referencedRelation: 'payments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_boost_entitlements_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      mobile_otp_requests: {
        Row: {
          id: number
          user_id: string
          mobile: string
          requested_at: string
          verified_at: string | null
        }
        Insert: {
          id?: never
          user_id: string
          mobile: string
          requested_at?: string
          verified_at?: string | null
        }
        Update: {
          id?: never
          user_id?: string
          mobile?: string
          requested_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mobile_otp_requests_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profile_boost_config: {
        Row: {
          id: number
          price_inr: number
          duration_days: number
          is_active: boolean
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          price_inr?: number
          duration_days?: number
          is_active?: boolean
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          price_inr?: number
          duration_days?: number
          is_active?: boolean
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profile_boost_config_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      site_content: {
        Row: {
          key: string
          title: string
          body: string
          is_active: boolean
          sort_order: number
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          key: string
          title?: string
          body?: string
          is_active?: boolean
          sort_order?: number
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          title?: string
          body?: string
          is_active?: boolean
          sort_order?: number
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'site_content_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_config: {
        Row: {
          id: number
          community_link: string | null
          support_link: string | null
          support_number: string | null
          is_active: boolean
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          community_link?: string | null
          support_link?: string | null
          support_number?: string | null
          is_active?: boolean
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          community_link?: string | null
          support_link?: string | null
          support_number?: string | null
          is_active?: boolean
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_config_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      featured_profiles: {
        Row: {
          profile_id: string
          position: number
          created_by: string | null
          created_at: string
        }
        Insert: {
          profile_id: string
          position?: number
          created_by?: string | null
          created_at?: string
        }
        Update: {
          profile_id?: string
          position?: number
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'featured_profiles_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'matrimony_profiles'
            referencedColumns: ['user_id']
          },
        ]
      }
      verification_requests: {
        Row: {
          id: string
          user_id: string
          type: Database['public']['Enums']['verification_type']
          status: Database['public']['Enums']['verification_status']
          storage_path: string | null
          note: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: Database['public']['Enums']['verification_type']
          status?: Database['public']['Enums']['verification_status']
          storage_path?: string | null
          note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: Database['public']['Enums']['verification_type']
          status?: Database['public']['Enums']['verification_status']
          storage_path?: string | null
          note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'verification_requests_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      moments: {
        Row: {
          id: string
          user_id: string
          media_type: Database['public']['Enums']['moment_media_type']
          storage_path: string
          caption: string | null
          is_removed: boolean
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          user_id: string
          media_type?: Database['public']['Enums']['moment_media_type']
          storage_path: string
          caption?: string | null
          is_removed?: boolean
          created_at?: string
          expires_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          media_type?: Database['public']['Enums']['moment_media_type']
          storage_path?: string
          caption?: string | null
          is_removed?: boolean
          created_at?: string
          expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'moments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      success_stories: {
        Row: {
          id: string
          couple_names: string
          title: string
          story: string
          photo_path: string | null
          wedding_date: string | null
          is_published: boolean
          sort_order: number
          created_at: string
          updated_at: string
          submitted_by: string | null
          rating: number | null
          milestone: string | null
          valued_features: Json
          future_members_note: string | null
          consent_to_publish: boolean
          submitted_at: string | null
        }
        Insert: {
          id?: string
          couple_names: string
          title: string
          story: string
          photo_path?: string | null
          wedding_date?: string | null
          is_published?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
          submitted_by?: string | null
          rating?: number | null
          milestone?: string | null
          valued_features?: Json
          future_members_note?: string | null
          consent_to_publish?: boolean
          submitted_at?: string | null
        }
        Update: {
          id?: string
          couple_names?: string
          title?: string
          story?: string
          photo_path?: string | null
          wedding_date?: string | null
          is_published?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
          submitted_by?: string | null
          rating?: number | null
          milestone?: string | null
          valued_features?: Json
          future_members_note?: string | null
          consent_to_publish?: boolean
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "success_stories_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      admin_audit_log: {
        Row: {
          id: number
          admin_id: string | null
          action: string
          target_type: string | null
          target_id: string | null
          details: Json
          created_at: string
        }
        Insert: {
          id?: never
          admin_id?: string | null
          action: string
          target_type?: string | null
          target_id?: string | null
          details?: Json
          created_at?: string
        }
        Update: {
          id?: never
          admin_id?: string | null
          action?: string
          target_type?: string | null
          target_id?: string | null
          details?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'admin_audit_log_admin_id_fkey'
            columns: ['admin_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      /** @deprecated The PRD removed the Shortlist concept. The table stays so existing data is preserved, but no UI writes to it anymore; a future migration will drop it. */
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
          created_at: string
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
      /**
       * One row per pair of members allowed to chat. Written ONLY by
       * get_or_create_conversation() — `authenticated` has no write grant.
       */
      conversations: {
        Row: {
          id: string
          member_a: string
          member_b: string
          created_at: string
          updated_at: string
          last_message_at: string | null
        }
        Insert: {
          id?: string
          member_a: string
          member_b: string
          created_at?: string
          updated_at?: string
          last_message_at?: string | null
        }
        Update: {
          id?: string
          member_a?: string
          member_b?: string
          created_at?: string
          updated_at?: string
          last_message_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'conversations_member_a_fkey'
            columns: ['member_a']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversations_member_b_fkey'
            columns: ['member_b']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      /** Participants of a conversation (the RLS anchor). */
      conversation_members: {
        Row: {
          conversation_id: string
          user_id: string
          joined_at: string
        }
        Insert: {
          conversation_id: string
          user_id: string
          joined_at?: string
        }
        Update: {
          conversation_id?: string
          user_id?: string
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_members_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversation_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      /** Chat messages. Text only; written ONLY by send_message(). */
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          body: string
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id: string
          body: string
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          conversation_id?: string
          sender_id?: string
          body?: string
          created_at?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'messages_sender_id_fkey'
            columns: ['sender_id']
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
      record_login: { Args: Record<string, never>; Returns: undefined }
      ensure_my_profile: { Args: Record<string, never>; Returns: undefined }
      search_matches: {
        Args: {
          p_looking_for?: Database['public']['Enums']['gender'] | null
          p_min_age?: number | null
          p_max_age?: number | null
          p_city?: string | null
          p_sub_community?: string | null
          p_limit?: number | null
          p_education?: string | null
          p_occupation?: string | null
          p_native_place?: string | null
          p_marital_status?: Database['public']['Enums']['marital_status'] | null
          p_diet?: Database['public']['Enums']['diet'] | null
          p_min_income?: string | null
          p_min_height?: number | null
          p_max_height?: number | null
        }
        Returns: Json
      }
      get_public_profile: { Args: { p_user_id: string }; Returns: Json }
      has_active_subscription: { Args: { p_user_id?: string | null }; Returns: boolean }
      has_live_membership: { Args: { p_user_id: string }; Returns: boolean }
      is_profile_public: { Args: { p_user_id: string }; Returns: boolean }
      profile_visibility_reason: { Args: { p_user_id?: string | null }; Returns: Json }
      sweep_my_membership: { Args: Record<string, never>; Returns: Json }
      sweep_expired_memberships: { Args: Record<string, never>; Returns: Json }
      mutual_interest_exists: { Args: { p_a: string; p_b: string }; Returns: boolean }
      get_profile_contact: { Args: { p_user_id: string }; Returns: string | null }
      free_benefits: { Args: Record<string, never>; Returns: Json }
      get_membership: { Args: { p_user_id?: string | null }; Returns: Json }
      get_membership_tier: {
        Args: { p_user_id?: string | null }
        Returns: Database['public']['Enums']['membership_tier']
      }
      has_benefit: { Args: { p_key: string; p_user_id?: string | null }; Returns: boolean }
      /** Caller's own profile-view COUNT, gated on has_benefit('profile_views'). */
      my_profile_view_stats: { Args: Record<string, never>; Returns: Json }
      express_interest: {
        Args: { p_target_id: string; p_message?: string | null }
        Returns: Json
      }
      is_blocked: { Args: { p_a: string; p_b: string }; Returns: boolean }
      request_account_deletion: { Args: { p_reason?: string | null }; Returns: Json }
      activate_membership: {
        Args: { p_user_id: string; p_package_id: number; p_payment_id?: string | null }
        Returns: Json
      }
      refund_membership: { Args: { p_payment_id: string }; Returns: Json }
      cancel_stale_payments: { Args: Record<string, never>; Returns: number }
      log_activity: {
        Args: { p_user_id: string; p_event: string; p_metadata?: Json }
        Returns: number | null
      }
      get_daily_matches: { Args: { p_limit?: number | null }; Returns: Json }
      matching_settings: { Args: Record<string, never>; Returns: Json }
      income_band_rank: { Args: { p: string | null }; Returns: number }
      education_rank: { Args: { p: string | null }; Returns: number }
      boost_my_profile: { Args: Record<string, never>; Returns: Json }
      has_active_boost: { Args: { p_user_id: string }; Returns: boolean }
      activate_boost_purchase: { Args: { p_payment_id: string }; Returns: Json }
      /** Configured Profile Boost length (profile_boost_config.duration_days); raises when unset. */
      boost_duration_days: { Args: Record<string, never>; Returns: number }
      /** Service-role support grant: admin-origin entitlement for the configured duration. */
      admin_grant_boost: {
        Args: { p_user_id: string; p_granted_by?: string | null }
        Returns: Json
      }
      request_mobile_otp: { Args: Record<string, never>; Returns: Json }
      complete_mobile_otp_verification: { Args: Record<string, never>; Returns: Json }
      report_moment: {
        Args: {
          p_moment_id: string
          p_reason?: Database['public']['Enums']['report_reason']
          p_details?: string | null
        }
        Returns: Json
      }
      get_site_content: { Args: { p_key: string }; Returns: Json }
      get_whatsapp_config: { Args: Record<string, never>; Returns: Json }
      get_featured_profiles: { Args: { p_limit?: number | null }; Returns: Json }
      list_moments: { Args: Record<string, never>; Returns: Json }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      push_notification: {
        Args: {
          p_user_id: string
          p_type: Database['public']['Enums']['notification_type']
          p_title: string
          p_message?: string
          p_metadata?: Json
          p_link?: string | null
        }
        Returns: number | null
      }
      unread_notification_count: { Args: Record<string, never>; Returns: number }
      mark_notification_read: { Args: { p_id: number }; Returns: undefined }
      mark_all_notifications_read: { Args: Record<string, never>; Returns: number }
      /** Coarse chat verdict: { allowed, reason } — never leaks account details. */
      chat_eligibility: { Args: { p_other_user_id: string }; Returns: Json }
      /** Resolves/creates the one conversation between the caller and a member. */
      get_or_create_conversation: { Args: { p_other_user_id: string }; Returns: Json }
      /** The caller's conversation list (name, photo, preview, unread). */
      chat_inbox: { Args: { p_limit?: number | null }; Returns: Json }
      /** Conversation header + whether the caller may currently send. */
      get_conversation: { Args: { p_conversation_id: string }; Returns: Json }
      /** Newest messages of one of the caller's conversations, oldest-first. */
      list_messages: {
        Args: { p_conversation_id: string; p_limit?: number | null }
        Returns: Json
      }
      /** The only message-write path; re-verifies every rule per send. */
      send_message: {
        Args: { p_conversation_id: string; p_body: string }
        Returns: Json
      }
      mark_conversation_read: { Args: { p_conversation_id: string }; Returns: number }
      unread_message_count: { Args: Record<string, never>; Returns: number }
      submit_success_story: {
        Args: {
          p_couple_names: string
          p_title: string
          p_story: string
          p_rating: number
          p_milestone?: string | null
          p_wedding_date?: string | null
          p_photo_path?: string | null
          p_valued_features?: Json
          p_future_members_note?: string | null
          p_consent?: boolean
        }
        Returns: string
      }
    }
    Enums: {
      for_whom: 'self' | 'son' | 'daughter'
      gender: 'male' | 'female'
      marital_status: 'never_married' | 'divorced' | 'widowed' | 'awaiting_divorce'
      diet: 'vegetarian' | 'non_vegetarian' | 'eggetarian' | 'jain' | 'vegan'
      profile_status: 'draft' | 'pending_review' | 'active' | 'hidden' | 'rejected' | 'suspended' | 'expired'
      interest_status: 'pending' | 'accepted' | 'declined' | 'withdrawn'
      subscription_status: 'active' | 'expired' | 'cancelled'
      photo_kind: 'profile_photo' | 'family_photo'
      family_type: 'joint' | 'nuclear'
      lifestyle_choice: 'never' | 'occasionally' | 'regularly'
      notification_type:
        | 'interest_received'
        | 'interest_accepted'
        | 'interest_declined'
        | 'profile_viewed'
        | 'new_matches'
        | 'new_moment'
        | 'package_expiring'
        | 'boost_expiring'
        | 'profile_verified'
        | 'payment_received'
        | 'admin_message'
        | 'message_received'
      payment_status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'cancelled'
      report_reason: 'fake_profile' | 'incorrect_information' | 'inappropriate_content' | 'harassment' | 'spam' | 'other'
      report_status: 'open' | 'reviewing' | 'resolved' | 'dismissed'
      moment_media_type: 'photo' | 'video'
      verification_type: 'mobile' | 'photo' | 'id_document'
      verification_status: 'pending' | 'verified' | 'rejected'
      membership_tier: 'free' | 'smart' | 'premium' | 'vip'
      boost_status: 'active' | 'expired' | 'cancelled'
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
export type PackageRow = Database['public']['Tables']['packages']['Row']
export type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row']
export type PaymentRow = Database['public']['Tables']['payments']['Row']
export type NotificationRow = Database['public']['Tables']['notifications']['Row']
export type BlockRow = Database['public']['Tables']['blocks']['Row']
export type ReportRow = Database['public']['Tables']['reports']['Row']
export type ActivityEventRow = Database['public']['Tables']['activity_events']['Row']
export type ProfileBoostRow = Database['public']['Tables']['profile_boosts']['Row']
export type ProfileBoostEntitlementRow = Database['public']['Tables']['profile_boost_entitlements']['Row']
export type FeaturedProfileRow = Database['public']['Tables']['featured_profiles']['Row']
export type VerificationRequestRow = Database['public']['Tables']['verification_requests']['Row']
export type MomentRow = Database['public']['Tables']['moments']['Row']
export type SuccessStoryRow = Database['public']['Tables']['success_stories']['Row']
export type MatchingConfigRow = Database['public']['Tables']['matching_config']['Row']
export type MobileOtpRequestRow = Database['public']['Tables']['mobile_otp_requests']['Row']
export type ProfileBoostConfigRow = Database['public']['Tables']['profile_boost_config']['Row']
export type SiteContentRow = Database['public']['Tables']['site_content']['Row']
export type WhatsAppConfigRow = Database['public']['Tables']['whatsapp_config']['Row']
export type AccountDeletionRequestRow = Database['public']['Tables']['account_deletion_requests']['Row']
export type ConversationRow = Database['public']['Tables']['conversations']['Row']
export type ConversationMemberRow = Database['public']['Tables']['conversation_members']['Row']
export type MessageRow = Database['public']['Tables']['messages']['Row']

export type Gender = Database['public']['Enums']['gender']
export type MaritalStatus = Database['public']['Enums']['marital_status']
export type Diet = Database['public']['Enums']['diet']
export type ProfileStatus = Database['public']['Enums']['profile_status']
export type InterestStatus = Database['public']['Enums']['interest_status']
export type SubscriptionStatus = Database['public']['Enums']['subscription_status']
export type PhotoKind = Database['public']['Enums']['photo_kind']
export type FamilyType = Database['public']['Enums']['family_type']
export type LifestyleChoice = Database['public']['Enums']['lifestyle_choice']
export type NotificationType = Database['public']['Enums']['notification_type']
export type PaymentStatus = Database['public']['Enums']['payment_status']
export type ReportReason = Database['public']['Enums']['report_reason']
export type ReportStatus = Database['public']['Enums']['report_status']
export type VerificationType = Database['public']['Enums']['verification_type']
export type VerificationStatus = Database['public']['Enums']['verification_status']
export type MembershipTier = Database['public']['Enums']['membership_tier']

/**
 * A single card returned by search_matches() / get_featured_profiles() /
 * get_daily_matches() (score & reasons only on Daily 5).
 */
export type MatchCard = {
  user_id: string
  name: string
  age?: number | null
  height_cm?: number | null
  sub_community?: string | null
  /** Community name from the hierarchy (search_matches v4, migration 20260919080000). */
  community?: string | null
  marital_status?: MaritalStatus | null
  education?: string | null
  occupation: string | null
  city?: string | null
  state?: string | null
  diet?: Diet | null
  photo: string | null
  has_photo: boolean
  gender?: Gender | null
  name_full?: string | null
  viewer_is_paid?: boolean | null
  verified?: boolean | null
  is_boosted?: boolean | null
  score?: number | null
  reasons?: string[] | null
}

/** A single card returned by the get_public_profile() RPC. */
export type PublicProfileCard = {
  id: string
  name: string
  age: number | null
  height_cm: number | null
  religion: string | null
  sub_community: string | null
  /** Community name from the hierarchy (get_public_profile v5, migration 20260919080000). */
  community?: string | null
  mother_tongue: string | null
  marital_status: MaritalStatus | null
  education: string | null
  education_details: string | null
  occupation: string | null
  company: string | null
  /** Optional business the member owns — separate from `company` (the employer). get_public_profile v6, migration 20260919090000; gated exactly like `company`. */
  business_name?: string | null
  annual_income: string | null
  city: string | null
  state: string | null
  country: string | null
  native_place: string | null
  diet: Diet | null
  smoking: LifestyleChoice | null
  drinking: LifestyleChoice | null
  gotra: string | null
  about_me: string | null
  hobbies: string[]
  father_occupation: string | null
  mother_occupation: string | null
  siblings: string | null
  family_type: FamilyType | null
  family_location: string | null
  family_details: string | null
  photos: string[]
  family_photo: string | null
  gender?: Gender | null
  name_full?: string | null
  verified?: boolean | null
  is_boosted?: boolean | null
  viewer_is_paid?: boolean | null
  mutual_interest?: boolean | null
  contact_phone?: string | null
  contact_email?: string | null
  /** TRUE only for paid + mutual viewers when the owner opted into WhatsApp (migration 20260919050000). */
  whatsapp_allowed?: boolean | null
}

/** Render-ready output of profile_visibility_reason(). */
export type VisibilityReason = {
  status: string | null
  is_public: boolean
  reason:
    | 'public'
    | 'activating'
    | 'not_published'
    | 'profile_incomplete'
    | 'membership_required'
    | 'membership_expired'
    | 'pending_review'
    | 'suspended'
    | 'rejected'
    | 'account_inactive'
    | 'not_signed_in'
  missing: string[]
  headline: string
  detail: string
  cta: { label: string; href: string } | null
  expired_at?: string | null
}

/**
 * Output of my_profile_view_stats() — the member's own profile-view COUNT.
 * `allowed` mirrors has_benefit('profile_views'); when it is false the server
 * returns no numbers at all (FREE tier). `who_viewed_me` is the separate
 * visitor-list capability, exposed here only so the UI can pick the right link.
 */
export type ProfileViewStats = {
  allowed: boolean
  total: number | null
  last_30_days: number | null
  last_viewed_at: string | null
  who_viewed_me: boolean
}

/** The locked PRD copy for gated membership actions. */
export const LOCKED_ACTION_COPY =
  'Become a Paid Member to showcase your profile and express interest.'

/** Output of get_membership(). */
export type MembershipInfo = {
  tier: MembershipTier
  is_paid: boolean
  package_slug: string | null
  started_at: string | null
  expires_at: string | null
  days_left: number
  benefits: Record<string, boolean | number | null>
}

/** A notification row in the bell dropdown. */
export type NotificationItem = Pick<
  NotificationRow,
  'id' | 'type' | 'title' | 'message' | 'link' | 'is_read' | 'created_at'
>

/** A conversation row in the /messages list (output of chat_inbox()). */
export type ConversationSummary = {
  conversation_id: string
  other_user_id: string
  name: string
  photo: string | null
  last_message: string | null
  last_message_at: string | null
  unread_count: number
  /** False once the other member's plan lapses — history stays readable. */
  other_is_member: boolean
  created_at: string
}

/** Header of the open conversation (output of get_conversation()). */
export type ConversationDetail = {
  conversation_id: string
  other_user_id: string
  name: string
  photo: string | null
  other_is_member: boolean
  /** Both members paid + mutual interest + no block, evaluated live. */
  can_send: boolean
  created_at: string
}

/** One chat message (output of list_messages() / send_message()). */
export type ChatMessageItem = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  read_at: string | null
}

/**
 * Why chat is (not) available. Deliberately coarse: 'unavailable' covers
 * self, non-mutual interest, blocks and a lapsed plan on the other side, so
 * the verdict cannot be used to probe accounts or subscriptions.
 */
export type ChatEligibility = {
  allowed: boolean
  reason: 'ok' | 'unauthenticated' | 'membership_required' | 'unavailable'
}

/** Output of get_or_create_conversation(). */
export type StartConversationResult = {
  conversation_id: string
  other_user_id: string
  created: boolean
}

/** Hard cap enforced by the messages CHECK constraint and send_message(). */
export const CHAT_MESSAGE_LIMIT = 2000

/** A moment card in list_moments(). */
export type MomentItem = {
  id: string
  user_id: string
  name: string
  media_type: 'photo' | 'video'
  storage_path: string
  caption: string | null
  created_at: string
  expires_at: string
  is_mine: boolean
  author_photo: string | null
}
