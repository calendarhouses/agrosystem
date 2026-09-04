/**
 * Ручні типи таблиць Supabase (поки немає supabase gen types).
 *
 * Відповідність доменних назв:
 * - equipment_logs / work_orders → field_operations
 * - inventory_transactions → inventory_local_moves
 */

export type WeatherContextJson = {
  temp: number;
  humidity: number;
  condition: string;
  icon: string;
};

/** public.field_operations */
export type FieldOperationRow = {
  id: string;
  client_key: string | null;
  field_id: string | null;
  field_key: string | null;
  work_type: string | null;
  status: string | null;
  occurred_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  weather_context: WeatherContextJson | null;
};

/** public.inventory_local_moves */
export type InventoryLocalMoveRow = {
  id: string;
  item_ref_key: string;
  type: "outbound" | "inbound" | "sale";
  qty: number;
  field_id: string | null;
  date: string;
  status: string;
  season: string | null;
  weather_context: WeatherContextJson | null;
  created_at: string;
  updated_at: string;
};

/** public.scouting_reports */
export type ScoutingReportRow = {
  id: string;
  field_id: string;
  date: string;
  image_url: string | null;
  notes: string;
  /** ok | warning | critical — міграція 067 */
  status: string | null;
  weather_context: WeatherContextJson | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      field_operations: {
        Row: FieldOperationRow;
        Insert: Partial<FieldOperationRow> & Pick<FieldOperationRow, "id">;
        Update: Partial<FieldOperationRow>;
      };
      inventory_local_moves: {
        Row: InventoryLocalMoveRow;
        Insert: Partial<InventoryLocalMoveRow> & Pick<InventoryLocalMoveRow, "id">;
        Update: Partial<InventoryLocalMoveRow>;
      };
      scouting_reports: {
        Row: ScoutingReportRow;
        Insert: Partial<ScoutingReportRow> & Pick<ScoutingReportRow, "id" | "field_id">;
        Update: Partial<ScoutingReportRow>;
      };
    };
  };
};
