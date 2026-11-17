
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"entity": string,"entity_id": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"entity": string,"entity_id"?: string | null,"id"?: string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"entity"?: string,"entity_id"?: string | null,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"auth_attempts": {
                  Row: {
                    "action": string,"created_at": string,"email_hash": string,"id": string,"ip_hash": string,"outcome": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at": string,"email_hash": string,"id"?: string,"ip_hash": string,"outcome": string
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"email_hash"?: string,"id"?: string,"ip_hash"?: string,"outcome"?: string
                  }
                  Relationships: [
                    
                  ]
                },"clients": {
                  Row: {
                    "archived_at": string | null,"birth_date": string | null,"created_at": string,"created_by": string,"deleted_at": string | null,"first_name": string,"group_id": string | null,"id": string,"last_name": string,"note": string,"parent_name": string | null,"phone": string,"phone_owner": string,"search_text": string | null,"started_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"birth_date"?: string | null,"created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"first_name": string,"group_id"?: string | null,"id"?: string,"last_name": string,"note"?: string,"parent_name"?: string | null,"phone": string,"phone_owner": string,"search_text"?: never,"started_on": string,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"birth_date"?: string | null,"created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"first_name"?: string,"group_id"?: string | null,"id"?: string,"last_name"?: string,"note"?: string,"parent_name"?: string | null,"phone"?: string,"phone_owner"?: string,"search_text"?: never,"started_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clients_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"consents": {
                  Row: {
                    "client_id": string,"created_at": string,"given_on": string,"id": string,"kind": string,"recorded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"given_on": string,"id"?: string,"kind": string,"recorded_by"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"given_on"?: string,"id"?: string,"kind"?: string,"recorded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consents_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consents_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"groups": {
                  Row: {
                    "archived_at": string | null,"capacity": number | null,"coach_id": string,"created_at": string,"default_price": number,"id": string,"name": string,"schedule": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"capacity"?: number | null,"coach_id": string,"created_at"?: string,"default_price": number,"id"?: string,"name": string,"schedule"?: NonNullable<Json>
                  }
                  Update: {
                    "archived_at"?: string | null,"capacity"?: number | null,"coach_id"?: string,"created_at"?: string,"default_price"?: number,"id"?: string,"name"?: string,"schedule"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_coach_id_fkey"
      columns: ["coach_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"message_templates": {
                  Row: {
                    "body": string,"id": string,"kind": string,"name": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"id"?: string,"kind": string,"name": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "body"?: string,"id"?: string,"kind"?: string,"name"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_templates_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"client_id": string,"created_at": string,"created_by": string,"id": string,"idempotency_key": string,"kind": string,"method": string | null,"period_end": string,"period_start": string,"reason": string | null,"reverses_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"client_id": string,"created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key": string,"kind": string,"method"?: string | null,"period_end": string,"period_start": string,"reason"?: string | null,"reverses_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"client_id"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key"?: string,"kind"?: string,"method"?: string | null,"period_end"?: string,"period_start"?: string,"reason"?: string | null,"reverses_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_reverses_same_client"
      columns: ["reverses_id","client_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id","client_id"]
    }
                  ]
                },"reminder_events": {
                  Row: {
                    "client_id": string,"id": string,"kind": string,"marked_sent_at": string | null,"marked_sent_by": string | null,"opened_at": string,"opened_by": string,"payment_id": string,"status": string,"template_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"id"?: string,"kind": string,"marked_sent_at"?: string | null,"marked_sent_by"?: string | null,"opened_at"?: string,"opened_by"?: string,"payment_id": string,"status"?: string,"template_id": string
                  }
                  Update: {
                    "client_id"?: string,"id"?: string,"kind"?: string,"marked_sent_at"?: string | null,"marked_sent_by"?: string | null,"opened_at"?: string,"opened_by"?: string,"payment_id"?: string,"status"?: string,"template_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reminder_events_marked_sent_by_fkey"
      columns: ["marked_sent_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reminder_events_opened_by_fkey"
      columns: ["opened_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reminder_events_payment_client_fk"
      columns: ["payment_id","client_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id","client_id"]
    },{
      foreignKeyName: "reminder_events_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "message_templates"
      referencedColumns: ["id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "gym_name": string,"gym_whatsapp": string | null,"id": boolean,"reminder_days": (number)[],"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "gym_name"?: string,"gym_whatsapp"?: string | null,"id"?: boolean,"reminder_days"?: (number)[],"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "gym_name"?: string,"gym_whatsapp"?: string | null,"id"?: boolean,"reminder_days"?: (number)[],"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"staff": {
                  Row: {
                    "active": boolean,"created_at": string,"full_name": string,"id": string,"locale": string,"must_change_password": boolean,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"full_name": string,"id": string,"locale"?: string,"must_change_password"?: boolean,"role": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"full_name"?: string,"id"?: string,"locale"?: string,"must_change_password"?: boolean,"role"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "client_status_v": {
                  Row: {
                    "client_id": string | null,"days_left": number | null,"ends_on": string | null,"payment_id": string | null,"period_start": string | null,"status": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "add_client_consents":
{ Args: { "p_client_id": string,"p_kinds": (string)[] }; Returns: (string)[]
                           },
"add_staff":
{ Args: { "p_full_name": string,"p_id": string,"p_role": string }; Returns: undefined
                           },
"archive_group":
{ Args: { "p_force": boolean,"p_group_id": string }; Returns: {
              "active_clients": number,"archived": boolean
            }[]
                           },
"audit_feed":
{ Args: { "p_action"?: string,"p_actor"?: string,"p_before_at"?: string,"p_before_id"?: string,"p_from"?: string,"p_limit"?: number,"p_to"?: string }; Returns: Json
                           },
"auth_throttle_begin":
{ Args: { "p_action": string,"p_email_hash": string,"p_ip_hash": string,"p_now": string }; Returns: {
              "allowed": boolean,"limited_by": string,"retry_after_seconds": number
            }[]
                           },
"auth_throttle_limits":
{ Args: { "p_action": string }; Returns: {
              "email_limit": number,"ip_limit": number,"window_length": string
            }[]
                           },
"auth_throttle_retry_at":
{ Args: { "p_action": string,"p_email_hash": string,"p_ip_hash": string,"p_limit": number,"p_since": string,"p_window": string }; Returns: string
                           },
"auth_throttle_success":
{ Args: { "p_action": string,"p_email_hash": string,"p_ip_hash": string,"p_now": string }; Returns: undefined
                           },
"begin_export":
{ Args: { "p_details": Json,"p_entity": string,"p_format": string }; Returns: undefined
                           },
"begin_password_reset":
{ Args: { "p_staff_id": string }; Returns: undefined
                           },
"bootstrap_owner":
{ Args: { "p_full_name": string,"p_id": string }; Returns: undefined
                           },
"cancel_recent_payment":
{ Args: { "p_idempotency_key": string,"p_payment_id": string }; Returns: Json
                           },
"check_client_group":
{ Args: { "p_current_group_id"?: string,"p_group_id": string }; Returns: undefined
                           },
"check_coach":
{ Args: { "p_coach_id": string,"p_current_coach_id"?: string }; Returns: undefined
                           },
"client_screen":
{ Args: { "p_client_id": string,"p_today"?: string }; Returns: Json
                           },
"client_status":
{ Args: { "p_today"?: string }; Returns: {
              "client_id": string,"days_left": number,"ends_on": string,"payment_id": string,"period_start": string,"status": string
            }[]
                           },
"clients_screen":
{ Args: { "p_limit"?: number,"p_today"?: string }; Returns: Json
                           },
"coach_options":
{ Args: { "p_keep_id"?: string }; Returns: Json
                           },
"complete_password_change":
{ Args: { "p_staff_id": string }; Returns: undefined
                           },
"create_client":
{ Args: { "p_birth_date"?: string,"p_consents"?: (string)[],"p_first_name": string,"p_group_id"?: string,"p_last_name": string,"p_note"?: string,"p_parent_name"?: string,"p_phone": string,"p_phone_owner": string,"p_started_on": string }; Returns: string
                           },
"create_group":
{ Args: { "p_capacity"?: number,"p_coach_id": string,"p_default_price": number,"p_name": string,"p_schedule": Json }; Returns: string
                           },
"current_staff_access":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"current_staff_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"dashboard_counts":
{ Args: { "p_today"?: string }; Returns: {
              "debtors": number,"expiring_week": number,"paid_today": number,"remind_today": number
            }[]
                           },
"delete_client":
{ Args: { "p_client_id": string,"p_last_name": string,"p_reason": string }; Returns: string
                           },
"export_clients":
{ Args: { "p_format": string,"p_today"?: string }; Returns: Json
                           },
"export_payments":
{ Args: { "p_format": string,"p_month": string }; Returns: Json
                           },
"group_counts":
{ Args: { "p_today"?: string }; Returns: {
              "debtors": number,"expiring": number,"group_id": string,"members": number,"paid": number,"unpaid": number
            }[]
                           },
"group_screen":
{ Args: { "p_group_id": string,"p_today"?: string }; Returns: Json
                           },
"groups_screen":
{ Args: { "p_today"?: string }; Returns: Json
                           },
"import_clients":
{ Args: { "p_file_hash": string,"p_new_groups"?: Json,"p_rows": Json,"p_today"?: string }; Returns: Json
                           },
"import_context":
{ Args: { "p_file_hash": string,"p_phones": (string)[] }; Returns: Json
                           },
"import_group_key":
{ Args: { "p_name": string }; Returns: string
                           },
"insert_reversal":
{ Args: { "p_cancel": boolean,"p_idempotency_key": string,"p_payment_id": string,"p_reason": string }; Returns: Json
                           },
"is_own_recent_payment":
{ Args: { "p_payment_id": string }; Returns: boolean
                           },
"lock_group":
{ Args: { "p_group_id": string }; Returns: undefined
                           },
"mark_reminder_sent":
{ Args: { "p_event_id": string }; Returns: Json
                           },
"move_clients":
{ Args: { "p_client_ids": (string)[],"p_target_group_id": string }; Returns: {
              "moved": number,"target_capacity": number,"target_members": number
            }[]
                           },
"next_period":
{ Args: { "p_current_end": string,"p_months"?: number,"p_paid_on": string }; Returns: {
              "period_end": string,"period_start": string
            }[]
                           },
"normalize_search":
{ Args: { "p_text": string }; Returns: string
                           },
"paid_today":
{ Args: { "p_today"?: string }; Returns: {
              "client_id": string
            }[]
                           },
"payment_json":
{ Args: { "p": Omit<Database["public"]['Tables']["payments"]['Row'], Database["public"]['Tables']["payments"]['ComputedFields']>,"p_created": boolean }; Returns: Json
                           },
"period_end_bounds":
{ Args: { "p_paid_on": string,"p_period_start": string }; Returns: {
              "max_end": string,"min_end": string
            }[]
                           },
"period_last_day":
{ Args: { "p_months": number,"p_start": string }; Returns: string
                           },
"phone_duplicates":
{ Args: { "p_exclude_id"?: string,"p_phone": string }; Returns: Json
                           },
"record_payment":
{ Args: { "p_amount": number,"p_client_id": string,"p_idempotency_key": string,"p_method": string,"p_months"?: number,"p_period_end"?: string }; Returns: Json
                           },
"record_reminder_opened":
{ Args: { "p_kind": string,"p_payment_id": string }; Returns: Json
                           },
"reminder_contact_json":
{ Args: { "p_client": Omit<Database["public"]['Tables']["clients"]['Row'], Database["public"]['Tables']["clients"]['ComputedFields']>,"p_ends_on": string,"p_group_name": string,"p_kind": string,"p_payment_id": string,"p_price": number }; Returns: Json
                           },
"reminder_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"reminder_event_json":
{ Args: { "p_event": Omit<Database["public"]['Tables']["reminder_events"]['Row'], Database["public"]['Tables']["reminder_events"]['ComputedFields']>,"p_marked_by_name": string,"p_opened_by_name": string }; Returns: Json
                           },
"reminder_kind_for":
{ Args: { "p_days_left": number,"p_reminder_days": (number)[] }; Returns: string
                           },
"reminder_settings_screen":
{ Args: { "p_today"?: string }; Returns: Json
                           },
"reminders_due":
{ Args: { "p_today"?: string }; Returns: {
              "client_id": string,"ends_on": string,"kind": string,"payment_id": string
            }[]
                           },
"reminders_screen":
{ Args: { "p_date"?: string,"p_limit"?: number,"p_staff_id"?: string,"p_tab": string,"p_today"?: string }; Returns: Json
                           },
"report_month":
{ Args: { "p_month": string,"p_today"?: string }; Returns: Json
                           },
"report_month_bounds":
{ Args: { "p_month": string }; Returns: {
              "ends_at": string,"starts_at": string
            }[]
                           },
"require_staff_role":
{ Args: { "p_roles": (string)[] }; Returns: undefined
                           },
"reverse_payment":
{ Args: { "p_idempotency_key": string,"p_payment_id": string,"p_reason": string }; Returns: Json
                           },
"set_client_archived":
{ Args: { "p_archived": boolean,"p_client_id": string }; Returns: boolean
                           },
"set_my_locale":
{ Args: { "p_locale": string }; Returns: undefined
                           },
"staff_screen":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"today_screen":
{ Args: { "p_today"?: string }; Returns: Json
                           },
"update_client":
{ Args: { "p_birth_date"?: string,"p_client_id": string,"p_consents"?: (string)[],"p_first_name": string,"p_group_id"?: string,"p_last_name": string,"p_note"?: string,"p_parent_name"?: string,"p_phone": string,"p_phone_owner": string,"p_started_on": string }; Returns: undefined
                           },
"update_group":
{ Args: { "p_capacity"?: number,"p_coach_id": string,"p_default_price": number,"p_group_id": string,"p_name": string,"p_schedule": Json }; Returns: undefined
                           },
"update_gym_settings":
{ Args: { "p_gym_name": string,"p_gym_whatsapp": string }; Returns: Json
                           },
"update_reminder_settings":
{ Args: { "p_reminder_days": (number)[],"p_templates": Json }; Returns: Json
                           },
"update_staff_access":
{ Args: { "p_active": boolean,"p_role": string,"p_staff_id": string }; Returns: Json
                           },
"write_audit":
{ Args: { "p_action": string,"p_details"?: Json,"p_entity": string,"p_entity_id"?: string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
