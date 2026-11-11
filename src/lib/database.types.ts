
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "classes": {
                  Row: {
                    "created_at": string,"homeroom_id": string | null,"id": string,"intro": string,"name": string,"owner_id": string,"schedule": NonNullable<Json>,"semester_id": string,"subject": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"homeroom_id"?: string | null,"id": string,"intro"?: string,"name": string,"owner_id"?: string,"schedule"?: NonNullable<Json>,"semester_id": string,"subject"?: string
                  }
                  Update: {
                    "created_at"?: string,"homeroom_id"?: string | null,"id"?: string,"intro"?: string,"name"?: string,"owner_id"?: string,"schedule"?: NonNullable<Json>,"semester_id"?: string,"subject"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "classes_semester_id_fkey"
      columns: ["semester_id"]
isOneToOne: false
      referencedRelation: "semesters"
      referencedColumns: ["id"]
    }
                  ]
                },"concepts": {
                  Row: {
                    "description": string,"id": string,"kind": string,"name": string,"owner_id": string,"subject": string,"unit": string,"x": number,"y": number
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string,"id": string,"kind"?: string,"name": string,"owner_id"?: string,"subject": string,"unit"?: string,"x"?: number,"y"?: number
                  }
                  Update: {
                    "description"?: string,"id"?: string,"kind"?: string,"name"?: string,"owner_id"?: string,"subject"?: string,"unit"?: string,"x"?: number,"y"?: number
                  }
                  Relationships: [
                    
                  ]
                },"folders": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string,"parent_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"name": string,"owner_id"?: string,"parent_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string,"parent_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "folders_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "folders"
      referencedColumns: ["id"]
    }
                  ]
                },"holidays": {
                  Row: {
                    "date": string,"name": string,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "date": string,"name"?: string,"owner_id"?: string
                  }
                  Update: {
                    "date"?: string,"name"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"homerooms": {
                  Row: {
                    "class_name": string,"class_no": number | null,"code": string,"created_at": string,"grade": number,"id": string,"owner_id": string,"school": string,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "class_name"?: string,"class_no"?: number | null,"code"?: string,"created_at"?: string,"grade": number,"id": string,"owner_id"?: string,"school"?: string,"year"?: number
                  }
                  Update: {
                    "class_name"?: string,"class_no"?: number | null,"code"?: string,"created_at"?: string,"grade"?: number,"id"?: string,"owner_id"?: string,"school"?: string,"year"?: number
                  }
                  Relationships: []
                },"students": {
                  Row: {
                    "created_at": string,"homeroom_id": string,"id": string,"initial_pw": string | null,"name": string,"number": number,"owner_id": string,"password_hash": string | null,"session_id": string | null,"student_no": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"homeroom_id": string,"id": string,"initial_pw"?: string | null,"name": string,"number": number,"owner_id"?: string,"password_hash"?: string | null,"session_id"?: string | null,"student_no"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"homeroom_id"?: string,"id"?: string,"initial_pw"?: string | null,"name"?: string,"number"?: number,"owner_id"?: string,"password_hash"?: string | null,"session_id"?: string | null,"student_no"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "students_homeroom_id_fkey"
      columns: ["homeroom_id"]
isOneToOne: false
      referencedRelation: "homerooms"
      referencedColumns: ["id"]
    }
                  ]
                },"lessons": {
                  Row: {
                    "class_id": string,"date": string,"day": string,"done": string | null,"id": string,"no": number,"owner_id": string,"question_ids": (string)[],"time": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_id": string,"date": string,"day"?: string,"done"?: string | null,"id": string,"no"?: number,"owner_id"?: string,"question_ids"?: (string)[],"time"?: string,"title"?: string
                  }
                  Update: {
                    "class_id"?: string,"date"?: string,"day"?: string,"done"?: string | null,"id"?: string,"no"?: number,"owner_id"?: string,"question_ids"?: (string)[],"time"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lessons_class_id_fkey"
      columns: ["class_id"]
isOneToOne: false
      referencedRelation: "classes"
      referencedColumns: ["id"]
    }
                  ]
                },"links": {
                  Row: {
                    "from_id": string,"id": string,"owner_id": string,"subject": string,"to_id": string,"weight": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "from_id": string,"id": string,"owner_id"?: string,"subject": string,"to_id": string,"weight"?: number | null
                  }
                  Update: {
                    "from_id"?: string,"id"?: string,"owner_id"?: string,"subject"?: string,"to_id"?: string,"weight"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "links_from_id_fkey"
      columns: ["from_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "links_to_id_fkey"
      columns: ["to_id"]
isOneToOne: false
      referencedRelation: "concepts"
      referencedColumns: ["id"]
    }
                  ]
                },"live_joins": {
                  Row: {
                    "joined_at": string,"session_id": string,"student_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "joined_at"?: string,"session_id": string,"student_name": string
                  }
                  Update: {
                    "joined_at"?: string,"session_id"?: string,"student_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "live_joins_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "live_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"live_sessions": {
                  Row: {
                    "class_id": string | null,"code": string,"ended_at": string | null,"id": string,"idx": number,"lesson_id": string,"owner_id": string,"phase": string,"questions": NonNullable<Json>,"started_at": string,"subject": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class_id"?: string | null,"code": string,"ended_at"?: string | null,"id"?: string,"idx"?: number,"lesson_id": string,"owner_id"?: string,"phase"?: string,"questions"?: NonNullable<Json>,"started_at"?: string,"subject"?: string,"title"?: string
                  }
                  Update: {
                    "class_id"?: string | null,"code"?: string,"ended_at"?: string | null,"id"?: string,"idx"?: number,"lesson_id"?: string,"owner_id"?: string,"phase"?: string,"questions"?: NonNullable<Json>,"started_at"?: string,"subject"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "live_sessions_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    }
                  ]
                },"misconceptions": {
                  Row: {
                    "concept_ids": (string)[],"description": string,"id": string,"name": string,"owner_id": string,"subject": string
                  }
                  ComputedFields: never
                  Insert: {
                    "concept_ids"?: (string)[],"description"?: string,"id": string,"name": string,"owner_id"?: string,"subject": string
                  }
                  Update: {
                    "concept_ids"?: (string)[],"description"?: string,"id"?: string,"name"?: string,"owner_id"?: string,"subject"?: string
                  }
                  Relationships: [
                    
                  ]
                },"questions": {
                  Row: {
                    "analysis": Json | null,"answer": string,"choice_images": string[],"choice_mis_ids": (string)[],"choices": (string)[],"code": string,"concept_ids": (string)[],"created_at": string,"explanation": string,"figure": string,"folder_id": string | null,"id": string,"image_url": string,"mis_ids": (string)[],"misconceptions": (string)[],"owner_id": string,"sample_key": string | null,"stem": string,"subject": string,"title": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "analysis"?: Json | null,"answer"?: string,"choice_images"?: string[],"choice_mis_ids"?: (string)[],"choices"?: (string)[],"code"?: string,"concept_ids"?: (string)[],"created_at"?: string,"explanation"?: string,"figure"?: string,"folder_id"?: string | null,"id": string,"image_url"?: string,"mis_ids"?: (string)[],"misconceptions"?: (string)[],"owner_id"?: string,"sample_key"?: string | null,"stem"?: string,"subject"?: string,"title"?: string,"type"?: string,"updated_at"?: string
                  }
                  Update: {
                    "analysis"?: Json | null,"answer"?: string,"choice_images"?: string[],"choice_mis_ids"?: (string)[],"choices"?: (string)[],"code"?: string,"concept_ids"?: (string)[],"created_at"?: string,"explanation"?: string,"figure"?: string,"folder_id"?: string | null,"id"?: string,"image_url"?: string,"mis_ids"?: (string)[],"misconceptions"?: (string)[],"owner_id"?: string,"sample_key"?: string | null,"stem"?: string,"subject"?: string,"title"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "questions_folder_id_fkey"
      columns: ["folder_id"]
isOneToOne: false
      referencedRelation: "folders"
      referencedColumns: ["id"]
    }
                  ]
                },"responses": {
                  Row: {
                    "answer": string,"concept_ids": (string)[],"correct": boolean,"created_at": string,"id": number,"lesson_id": string,"misconception": string,"owner_id": string,"question_id": string,"session_id": string | null,"student_key": string,"student_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": string,"concept_ids"?: (string)[],"correct": boolean,"created_at"?: string,"id"?: never,"lesson_id": string,"misconception"?: string,"owner_id": string,"question_id": string,"session_id"?: string | null,"student_key": string,"student_name": string
                  }
                  Update: {
                    "answer"?: string,"concept_ids"?: (string)[],"correct"?: boolean,"created_at"?: string,"id"?: never,"lesson_id"?: string,"misconception"?: string,"owner_id"?: string,"question_id"?: string,"session_id"?: string | null,"student_key"?: string,"student_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "responses_lesson_id_fkey"
      columns: ["lesson_id"]
isOneToOne: false
      referencedRelation: "lessons"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "responses_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "live_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"semesters": {
                  Row: {
                    "end_date": string,"id": string,"name": string,"owner_id": string,"start_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "end_date": string,"id": string,"name": string,"owner_id"?: string,"start_date": string
                  }
                  Update: {
                    "end_date"?: string,"id"?: string,"name"?: string,"owner_id"?: string,"start_date"?: string
                  }
                  Relationships: [
                    
                  ]
                },"teacher_settings": {
                  Row: {
                    "image_model": string,"openai_model": string,"owner_id": string,"sample_seeded": boolean,"sample_version": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "image_model"?: string,"openai_model"?: string,"owner_id"?: string,"sample_seeded"?: boolean,"sample_version"?: number,"updated_at"?: string
                  }
                  Update: {
                    "image_model"?: string,"openai_model"?: string,"owner_id"?: string,"sample_seeded"?: boolean,"sample_version"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
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
  "public": {
          Enums: {
            
          }
        }
} as const
