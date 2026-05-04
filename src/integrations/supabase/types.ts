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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      companies: {
        Row: {
          br_file_path: string | null
          business_code: string | null
          business_nature: string | null
          chinese_name: string | null
          ci_file_path: string | null
          ci_number: string
          company_group: string | null
          company_number: string | null
          company_type: string | null
          created_at: string
          email: string | null
          id: string
          incorporation_date: string | null
          jurisdiction: string | null
          name: string
          phone: string | null
          preferred_presenter_id: string | null
          presenter_reference: string | null
          quorum: string | null
          reg_building: string | null
          reg_district: string | null
          reg_flat: string | null
          reg_region: string | null
          reg_street: string | null
          register_date: string | null
          signer_role_id: string | null
          status: string
          trading_name: string | null
          updated_at: string
        }
        Insert: {
          br_file_path?: string | null
          business_code?: string | null
          business_nature?: string | null
          chinese_name?: string | null
          ci_file_path?: string | null
          ci_number?: string
          company_group?: string | null
          company_number?: string | null
          company_type?: string | null
          created_at?: string
          email?: string | null
          id?: string
          incorporation_date?: string | null
          jurisdiction?: string | null
          name: string
          phone?: string | null
          preferred_presenter_id?: string | null
          presenter_reference?: string | null
          quorum?: string | null
          reg_building?: string | null
          reg_district?: string | null
          reg_flat?: string | null
          reg_region?: string | null
          reg_street?: string | null
          register_date?: string | null
          signer_role_id?: string | null
          status?: string
          trading_name?: string | null
          updated_at?: string
        }
        Update: {
          br_file_path?: string | null
          business_code?: string | null
          business_nature?: string | null
          chinese_name?: string | null
          ci_file_path?: string | null
          ci_number?: string
          company_group?: string | null
          company_number?: string | null
          company_type?: string | null
          created_at?: string
          email?: string | null
          id?: string
          incorporation_date?: string | null
          jurisdiction?: string | null
          name?: string
          phone?: string | null
          preferred_presenter_id?: string | null
          presenter_reference?: string | null
          quorum?: string | null
          reg_building?: string | null
          reg_district?: string | null
          reg_flat?: string | null
          reg_region?: string | null
          reg_street?: string | null
          register_date?: string | null
          signer_role_id?: string | null
          status?: string
          trading_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_preferred_presenter_id_fkey"
            columns: ["preferred_presenter_id"]
            isOneToOne: false
            referencedRelation: "presenters"
            referencedColumns: ["id"]
          },
        ]
      }
      company_logs: {
        Row: {
          company_id: string | null
          company_name_hint: string
          created_at: string
          doc_date: string
          doc_type: string
          html_content: string
          id: string
          notes: string
          original_filename: string
          source_folder: string
          storage_path: string
          text_content: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          company_name_hint?: string
          created_at?: string
          doc_date?: string
          doc_type?: string
          html_content?: string
          id?: string
          notes?: string
          original_filename?: string
          source_folder?: string
          storage_path?: string
          text_content?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          company_name_hint?: string
          created_at?: string
          doc_date?: string
          doc_type?: string
          html_content?: string
          id?: string
          notes?: string
          original_filename?: string
          source_folder?: string
          storage_path?: string
          text_content?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      officers: {
        Row: {
          address: string | null
          address_proof_file_path: string | null
          alias_chinese: string | null
          alias_english: string | null
          company_id: string
          company_number_ref: string | null
          created_at: string
          date_appointed: string | null
          date_ceased: string | null
          date_of_birth: string
          email: string | null
          id: string
          id_card_file_path: string | null
          id_number: string | null
          identity: string
          name_chinese: string | null
          name_english: string
          passport_expiry: string | null
          passport_file_path: string | null
          passport_number: string | null
          place_incorporated: string | null
          previous_name_chinese: string | null
          previous_name_english: string | null
          role: string
          service_address: string | null
          tcsp_number: string | null
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          address_proof_file_path?: string | null
          alias_chinese?: string | null
          alias_english?: string | null
          company_id: string
          company_number_ref?: string | null
          created_at?: string
          date_appointed?: string | null
          date_ceased?: string | null
          date_of_birth?: string
          email?: string | null
          id?: string
          id_card_file_path?: string | null
          id_number?: string | null
          identity?: string
          name_chinese?: string | null
          name_english?: string
          passport_expiry?: string | null
          passport_file_path?: string | null
          passport_number?: string | null
          place_incorporated?: string | null
          previous_name_chinese?: string | null
          previous_name_english?: string | null
          role: string
          service_address?: string | null
          tcsp_number?: string | null
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          address_proof_file_path?: string | null
          alias_chinese?: string | null
          alias_english?: string | null
          company_id?: string
          company_number_ref?: string | null
          created_at?: string
          date_appointed?: string | null
          date_ceased?: string | null
          date_of_birth?: string
          email?: string | null
          id?: string
          id_card_file_path?: string | null
          id_number?: string | null
          identity?: string
          name_chinese?: string | null
          name_english?: string
          passport_expiry?: string | null
          passport_file_path?: string | null
          passport_number?: string | null
          place_incorporated?: string | null
          previous_name_chinese?: string | null
          previous_name_english?: string | null
          role?: string
          service_address?: string | null
          tcsp_number?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "officers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      person_company_roles: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          date_appointed: string
          date_ceased: string
          id: string
          is_reserve: boolean
          issue_price: string
          notes: string
          paid_up: string
          person_id: string
          role: string
          service_address_override: string
          share_type: string
          shares: number
          unpaid: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency?: string
          date_appointed?: string
          date_ceased?: string
          id?: string
          is_reserve?: boolean
          issue_price?: string
          notes?: string
          paid_up?: string
          person_id: string
          role: string
          service_address_override?: string
          share_type?: string
          shares?: number
          unpaid?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          date_appointed?: string
          date_ceased?: string
          id?: string
          is_reserve?: boolean
          issue_price?: string
          notes?: string
          paid_up?: string
          person_id?: string
          role?: string
          service_address_override?: string
          share_type?: string
          shares?: number
          unpaid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_company_roles_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      persons: {
        Row: {
          address: string
          address_proof_file_path: string
          alias_chinese: string
          alias_english: string
          company_number_ref: string
          created_at: string
          date_of_birth: string
          email: string
          id: string
          id_card_file_path: string
          id_number: string
          identity: string
          migration_dedup_key: string | null
          name_chinese: string
          name_english: string
          normalized_key: string | null
          notes: string
          passport_country: string
          passport_expiry: string
          passport_file_path: string
          passport_number: string
          phone: string
          place_incorporated: string
          previous_name_chinese: string
          previous_name_english: string
          service_address: string
          tcsp_number: string
          updated_at: string
          whatsapp: string
        }
        Insert: {
          address?: string
          address_proof_file_path?: string
          alias_chinese?: string
          alias_english?: string
          company_number_ref?: string
          created_at?: string
          date_of_birth?: string
          email?: string
          id?: string
          id_card_file_path?: string
          id_number?: string
          identity?: string
          migration_dedup_key?: string | null
          name_chinese?: string
          name_english?: string
          normalized_key?: string | null
          notes?: string
          passport_country?: string
          passport_expiry?: string
          passport_file_path?: string
          passport_number?: string
          phone?: string
          place_incorporated?: string
          previous_name_chinese?: string
          previous_name_english?: string
          service_address?: string
          tcsp_number?: string
          updated_at?: string
          whatsapp?: string
        }
        Update: {
          address?: string
          address_proof_file_path?: string
          alias_chinese?: string
          alias_english?: string
          company_number_ref?: string
          created_at?: string
          date_of_birth?: string
          email?: string
          id?: string
          id_card_file_path?: string
          id_number?: string
          identity?: string
          migration_dedup_key?: string | null
          name_chinese?: string
          name_english?: string
          normalized_key?: string | null
          notes?: string
          passport_country?: string
          passport_expiry?: string
          passport_file_path?: string
          passport_number?: string
          phone?: string
          place_incorporated?: string
          previous_name_chinese?: string
          previous_name_english?: string
          service_address?: string
          tcsp_number?: string
          updated_at?: string
          whatsapp?: string
        }
        Relationships: []
      }
      presenters: {
        Row: {
          address: string | null
          contact: string | null
          created_at: string
          email: string | null
          fax: string | null
          id: string
          name: string
          phone: string | null
          reference: string | null
          type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          name: string
          phone?: string | null
          reference?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact?: string | null
          created_at?: string
          email?: string | null
          fax?: string | null
          id?: string
          name?: string
          phone?: string | null
          reference?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      secretary_templates: {
        Row: {
          address: string
          br_number: string
          created_at: string
          email: string
          id: string
          id_number: string
          identity: string
          is_default: boolean
          label: string
          name_chinese: string
          name_english: string
          phone: string
          place_incorporated: string
          service_address: string
          tcsp_number: string
          updated_at: string
        }
        Insert: {
          address?: string
          br_number?: string
          created_at?: string
          email?: string
          id?: string
          id_number?: string
          identity?: string
          is_default?: boolean
          label?: string
          name_chinese?: string
          name_english?: string
          phone?: string
          place_incorporated?: string
          service_address?: string
          tcsp_number?: string
          updated_at?: string
        }
        Update: {
          address?: string
          br_number?: string
          created_at?: string
          email?: string
          id?: string
          id_number?: string
          identity?: string
          is_default?: boolean
          label?: string
          name_chinese?: string
          name_english?: string
          phone?: string
          place_incorporated?: string
          service_address?: string
          tcsp_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      share_transactions: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          from_name: string
          from_person_id: string | null
          id: string
          instrument_number: string
          notes: string
          price_per_share: string
          share_type: string
          shares: number
          to_name: string
          to_person_id: string | null
          total_consideration: string
          transaction_date: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency?: string
          from_name?: string
          from_person_id?: string | null
          id?: string
          instrument_number?: string
          notes?: string
          price_per_share?: string
          share_type?: string
          shares?: number
          to_name?: string
          to_person_id?: string | null
          total_consideration?: string
          transaction_date?: string
          transaction_type?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          from_name?: string
          from_person_id?: string | null
          id?: string
          instrument_number?: string
          notes?: string
          price_per_share?: string
          share_type?: string
          shares?: number
          to_name?: string
          to_person_id?: string | null
          total_consideration?: string
          transaction_date?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      shareholders: {
        Row: {
          address: string | null
          company_id: string
          created_at: string
          currency: string | null
          email: string | null
          id: string
          id_number: string | null
          identity: string
          issue_price: string | null
          name: string
          name_chinese: string | null
          name_english: string | null
          paid_up: string | null
          service_address: string | null
          share_type: string | null
          shares: number
          unpaid: string | null
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string
          currency?: string | null
          email?: string | null
          id?: string
          id_number?: string | null
          identity?: string
          issue_price?: string | null
          name?: string
          name_chinese?: string | null
          name_english?: string | null
          paid_up?: string | null
          service_address?: string | null
          share_type?: string | null
          shares?: number
          unpaid?: string | null
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string
          currency?: string | null
          email?: string | null
          id?: string
          id_number?: string | null
          identity?: string
          issue_price?: string | null
          name?: string
          name_chinese?: string | null
          name_english?: string | null
          paid_up?: string | null
          service_address?: string | null
          share_type?: string | null
          shares?: number
          unpaid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shareholders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      significant_controllers: {
        Row: {
          address: string | null
          company_id: string
          created_at: string
          date_became: string | null
          date_ceased: string | null
          designated_rep_contact: string | null
          designated_rep_name: string | null
          id: string
          id_number: string | null
          identity: string
          is_designated_rep: boolean | null
          name_chinese: string | null
          name_english: string
          nature_appoint: boolean | null
          nature_influence: boolean | null
          nature_other: string | null
          nature_shares: boolean | null
          nature_trust: boolean | null
          nature_voting: boolean | null
          service_address: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string
          date_became?: string | null
          date_ceased?: string | null
          designated_rep_contact?: string | null
          designated_rep_name?: string | null
          id?: string
          id_number?: string | null
          identity?: string
          is_designated_rep?: boolean | null
          name_chinese?: string | null
          name_english?: string
          nature_appoint?: boolean | null
          nature_influence?: boolean | null
          nature_other?: string | null
          nature_shares?: boolean | null
          nature_trust?: boolean | null
          nature_voting?: boolean | null
          service_address?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string
          date_became?: string | null
          date_ceased?: string | null
          designated_rep_contact?: string | null
          designated_rep_name?: string | null
          id?: string
          id_number?: string | null
          identity?: string
          is_designated_rep?: boolean | null
          name_chinese?: string | null
          name_english?: string
          nature_appoint?: boolean | null
          nature_influence?: boolean | null
          nature_other?: string | null
          nature_shares?: boolean | null
          nature_trust?: boolean | null
          nature_voting?: boolean | null
          service_address?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "significant_controllers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      link_company_logs_by_hint: { Args: never; Returns: number }
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
