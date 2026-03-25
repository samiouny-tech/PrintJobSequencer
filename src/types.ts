export interface SequenceRow {
  id: string;
  data: string[];
}

export interface ScoreResults {
  total_score: number;
  anilox_changes: number;
  ink_changes: number;
  added_stations: number;
  anilox_details: Record<string, number>;
  ink_details: Record<string, number>;
  added_station_details: Record<string, number>;
}
