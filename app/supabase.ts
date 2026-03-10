import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zunpdnovztwohmehzmef.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1bnBkbm92enR3b2htZWh6bWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTE4NjIsImV4cCI6MjA4ODcyNzg2Mn0.1sXl968z11j8bYLyaZ5TfaPr8kWIVioIp7tXUf7Cnsg";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const API_BASE = `${SUPABASE_URL}/functions/v1`;

export interface LeaderboardEntry {
  id: number;
  player_name: string;
  score: number;
  created_at: string;
}

export type LeaderboardPeriod = "daily" | "weekly" | "all";

export interface RoundRegistration {
  session_id: string;
  round_id: string;
}

export interface PickResult {
  correct: boolean;
  post_a_ups: number;
  post_b_ups: number;
  score: number;
  game_over: boolean;
}

async function callEdge<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// Register a round with the server (sends post data, server stores upvotes)
export async function registerRound(
  sessionId: string | undefined,
  postA: { title: string; subreddit: string; image: string | null; ups: number },
  postB: { title: string; subreddit: string; image: string | null; ups: number }
): Promise<RoundRegistration> {
  return callEdge<RoundRegistration>("new-round", {
    session_id: sessionId,
    post_a: postA,
    post_b: postB,
  });
}

// Submit pick to server — server checks answer and returns result
export async function submitPick(
  sessionId: string,
  roundId: string,
  picked: 0 | 1
): Promise<PickResult> {
  return callEdge<PickResult>("pick", {
    session_id: sessionId,
    round_id: roundId,
    picked,
  });
}

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
  sessionId: string
): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("save_leaderboard_score", {
    p_player_name: playerName,
    p_score: score,
    p_session_id: sessionId,
  });
  if (error) return { error: error.message };
  return data as { ok?: boolean; error?: string };
}
