import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://zunpdnovztwohmehzmef.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1bnBkbm92enR3b2htZWh6bWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTE4NjIsImV4cCI6MjA4ODcyNzg2Mn0.1sXl968z11j8bYLyaZ5TfaPr8kWIVioIp7tXUf7Cnsg"
);

export interface LeaderboardEntry {
  id: number;
  player_name: string;
  score: number;
  created_at: string;
}

export interface Round {
  postA_id: string;
  postB_id: string;
  postA_ups: number;
  postB_ups: number;
  picked: 0 | 1;
  timestamp: number;
}

export type LeaderboardPeriod = "daily" | "weekly" | "all";

export async function fetchLeaderboard(
  period: LeaderboardPeriod = "all",
  limit = 10
): Promise<LeaderboardEntry[]> {
  let query = supabase
    .from("leaderboard")
    .select("id, player_name, score, created_at")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (period === "daily") {
    const since = new Date();
    since.setHours(since.getHours() - 24);
    query = query.gte("created_at", since.toISOString());
  } else if (period === "weekly") {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    query = query.gte("created_at", since.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function submitScore(
  playerName: string,
  score: number,
  sessionId: string,
  rounds: Round[]
): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("submit_score", {
    p_player_name: playerName,
    p_score: score,
    p_session_id: sessionId,
    p_rounds: rounds,
  });

  if (error) return { error: error.message };
  return data as { ok?: boolean; error?: string };
}
