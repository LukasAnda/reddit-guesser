"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPopularSubreddits,
  fetchTopPosts,
  pickRandom,
  type Post,
  type Subreddit,
} from "./reddit";
import {
  registerRound,
  submitPick,
  fetchLeaderboard,
  submitScore,
  type PickResult,
  type LeaderboardEntry,
  type LeaderboardPeriod,
} from "./supabase";

type GameState = "loading" | "playing" | "revealed" | "error";

interface DisplayPost {
  title: string;
  subreddit: string;
  image: string | null;
}

interface PrefetchedRound {
  displayPosts: [DisplayPost, DisplayPost];
  sessionId: string;
  roundId: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: "daily", label: "24h" },
  { key: "weekly", label: "7d" },
  { key: "all", label: "All" },
];

export default function Home() {
  const [subreddits, setSubreddits] = useState<Subreddit[]>([]);
  const [displayPosts, setDisplayPosts] = useState<[DisplayPost, DisplayPost] | null>(null);
  const [result, setResult] = useState<PickResult | null>(null);
  const [state, setState] = useState<GameState>("loading");
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => {
    if (typeof window !== "undefined") {
      return parseInt(localStorage.getItem("bestScore") || "0", 10);
    }
    return 0;
  });
  const [picked, setPicked] = useState<0 | 1 | null>(null);
  const [visitors, setVisitors] = useState<number | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  const sessionIdRef = useRef<string | undefined>(undefined);
  const roundIdRef = useRef<string>("");
  const postCacheRef = useRef<Map<string, Post[]>>(new Map());
  const prefetchRef = useRef<Promise<PrefetchedRound | null> | null>(null);

  // Leaderboard
  const [lbData, setLbData] = useState<Record<LeaderboardPeriod, LeaderboardEntry[]>>({
    daily: [], weekly: [], all: [],
  });
  const [lbPeriod, setLbPeriod] = useState<LeaderboardPeriod>("all");
  const [nameInput, setNameInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingScore, setPendingScore] = useState(0);
  const pendingSessionRef = useRef("");

  const refreshLeaderboard = useCallback(() => {
    Promise.all([
      fetchLeaderboard("daily").catch(() => []),
      fetchLeaderboard("weekly").catch(() => []),
      fetchLeaderboard("all").catch(() => []),
    ]).then(([daily, weekly, all]) => setLbData({ daily, weekly, all }));
  }, []);

  useEffect(() => {
    if (bestScore > 0) localStorage.setItem("bestScore", String(bestScore));
  }, [bestScore]);

  useEffect(() => {
    fetchPopularSubreddits(150)
      .then((subs) => setSubreddits(subs))
      .catch(() => setState("error"));

    const counterBase = "https://corsproxy.io/?url=" + encodeURIComponent("https://api.counterapi.dev/v1/reddit-guesser/visits");
    if (!localStorage.getItem("counted")) {
      fetch(counterBase + encodeURIComponent("/up"))
        .then((r) => r.json())
        .then((d) => { setVisitors(d.count); localStorage.setItem("counted", "1"); })
        .catch(() => {});
    } else {
      fetch(counterBase)
        .then((r) => r.json())
        .then((d) => setVisitors(d.count))
        .catch(() => {});
    }

    refreshLeaderboard();
    const saved = localStorage.getItem("playerName");
    if (saved) setNameInput(saved);
  }, [refreshLeaderboard]);

  const getPostsForSubreddit = useCallback(async (sub: string): Promise<Post[]> => {
    const cache = postCacheRef.current;
    if (cache.has(sub) && cache.get(sub)!.length > 0) return cache.get(sub)!;
    const posts = await fetchTopPosts(sub);
    cache.set(sub, posts);
    return posts;
  }, []);

  const buildRound = useCallback(async (sid: string | undefined): Promise<PrefetchedRound | null> => {
    if (subreddits.length < 2) return null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const sub1 = pickRandom(subreddits);
        let sub2 = pickRandom(subreddits);
        while (sub2.name === sub1.name) sub2 = pickRandom(subreddits);

        const [posts1, posts2] = await Promise.all([
          getPostsForSubreddit(sub1.name),
          getPostsForSubreddit(sub2.name),
        ]);
        if (posts1.length === 0 || posts2.length === 0) continue;

        const post1 = pickRandom(posts1);
        const post2 = pickRandom(posts2);
        if (post1.ups === post2.ups) continue;

        const reg = await registerRound(
          sid,
          { title: post1.title, subreddit: post1.subreddit, image: post1.imageUrl, ups: post1.ups },
          { title: post2.title, subreddit: post2.subreddit, image: post2.imageUrl, ups: post2.ups }
        );

        return {
          displayPosts: [
            { title: post1.title, subreddit: post1.subreddit, image: post1.imageUrl },
            { title: post2.title, subreddit: post2.subreddit, image: post2.imageUrl },
          ],
          sessionId: reg.session_id,
          roundId: reg.round_id,
        };
      } catch {
        continue;
      }
    }
    return null;
  }, [subreddits, getPostsForSubreddit]);

  const prefetchNextRound = useCallback(() => {
    prefetchRef.current = buildRound(sessionIdRef.current);
  }, [buildRound]);

  const loadRound = useCallback(async () => {
    if (subreddits.length < 2) return;
    setState("loading");
    setPicked(null);
    setResult(null);

    // Use prefetched round if available
    const prefetched = prefetchRef.current;
    prefetchRef.current = null;

    const round = prefetched ? await prefetched : await buildRound(sessionIdRef.current);

    if (round) {
      sessionIdRef.current = round.sessionId;
      roundIdRef.current = round.roundId;
      setDisplayPosts(round.displayPosts);
      setImgErrors(new Set());
      setState("playing");
    } else {
      setState("error");
    }
  }, [subreddits, buildRound]);

  useEffect(() => {
    if (subreddits.length > 0 && !displayPosts) loadRound();
  }, [subreddits, displayPosts, loadRound]);

  const handlePick = useCallback(async (index: 0 | 1) => {
    if (state !== "playing" || !displayPosts) return;
    setPicked(index);
    setState("revealed");

    try {
      const res = await submitPick(sessionIdRef.current!, roundIdRef.current, index);
      setResult(res);

      if (res.correct) {
        setScore(res.score);
        setBestScore((b) => Math.max(b, res.score));
        // Prefetch next round immediately while user sees the result
        prefetchNextRound();
      } else {
        if (res.score >= 3) {
          setPendingScore(res.score);
          pendingSessionRef.current = sessionIdRef.current!;
          setShowNamePrompt(true);
        }
        setScore(0);
        sessionIdRef.current = undefined;
        // New session — prefetch with undefined sessionId
        prefetchNextRound();
      }
    } catch {
      setState("error");
    }
  }, [state, displayPosts, prefetchNextRound]);

  useEffect(() => {
    if (state !== "revealed" || !result || showNamePrompt) return;
    const timer = setTimeout(() => loadRound(), 3000);
    return () => clearTimeout(timer);
  }, [state, result, loadRound, showNamePrompt]);

  const handleSubmitScore = async () => {
    const name = nameInput.trim();
    if (!name || pendingScore < 1) return;
    setSubmitting(true);
    setSubmitMsg(null);
    localStorage.setItem("playerName", name);

    const res = await submitScore(name, pendingScore, pendingSessionRef.current);
    setSubmitMsg(res.ok ? "Submitted!" : (res.error ?? "Failed"));
    setSubmitting(false);
    if (res.ok) refreshLeaderboard();

    setTimeout(() => {
      setShowNamePrompt(false);
      setSubmitMsg(null);
      loadRound();
    }, 1500);
  };

  const currentLb = lbData[lbPeriod];

  if (state === "error" && !displayPosts) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-zinc-500">Could not load data.</p>
          <button
            onClick={() => { sessionIdRef.current = undefined; loadRound(); }}
            className="text-sm text-zinc-400 hover:text-foreground underline underline-offset-4 cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center relative">
      {/* Leaderboard — desktop */}
      <div className="fixed top-4 right-4 z-40 w-52 hidden md:block">
        <div className="rounded-xl bg-zinc-100/90 dark:bg-zinc-900/90 backdrop-blur-sm p-3">
          <div className="flex gap-1 mb-2.5">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setLbPeriod(p.key)} className={`flex-1 rounded-md py-1 text-[10px] font-bold tracking-wide cursor-pointer transition-colors ${lbPeriod === p.key ? "bg-foreground text-background" : "text-zinc-400 hover:text-foreground"}`}>{p.label}</button>
            ))}
          </div>
          {currentLb.length === 0 ? (
            <p className="text-[10px] text-zinc-400 text-center py-2">No scores yet</p>
          ) : (
            <div className="space-y-1">
              {currentLb.map((entry, i) => (
                <div key={entry.id} className="flex items-center gap-1.5 text-xs leading-tight">
                  <span className={`w-4 text-right tabular-nums font-bold shrink-0 ${i < 3 ? "text-foreground" : "text-zinc-400"}`}>{i + 1}</span>
                  <span className="flex-1 truncate">{entry.player_name}</span>
                  <span className="font-black tabular-nums shrink-0">{entry.score}</span>
                  <span className="text-[9px] text-zinc-400 dark:text-zinc-600 w-8 text-right shrink-0">{timeAgo(entry.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Leaderboard — mobile */}
      <details className="fixed bottom-0 left-0 right-0 z-30 md:hidden">
        <summary className="flex items-center justify-center bg-zinc-100/90 dark:bg-zinc-900/90 backdrop-blur-sm py-2 cursor-pointer text-[10px] font-bold tracking-widest uppercase text-zinc-400">Leaderboard</summary>
        <div className="bg-zinc-100/95 dark:bg-zinc-900/95 backdrop-blur-sm px-4 pb-4 pt-1">
          <div className="flex gap-1 mb-2">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setLbPeriod(p.key)} className={`flex-1 rounded-md py-1 text-[10px] font-bold tracking-wide cursor-pointer transition-colors ${lbPeriod === p.key ? "bg-foreground text-background" : "text-zinc-400 hover:text-foreground"}`}>{p.label}</button>
            ))}
          </div>
          {currentLb.length === 0 ? (
            <p className="text-[10px] text-zinc-400 text-center py-2">No scores yet</p>
          ) : (
            <div className="space-y-1">
              {currentLb.map((entry, i) => (
                <div key={entry.id} className="flex items-center gap-1.5 text-xs leading-tight">
                  <span className={`w-4 text-right tabular-nums font-bold shrink-0 ${i < 3 ? "text-foreground" : "text-zinc-400"}`}>{i + 1}</span>
                  <span className="flex-1 truncate">{entry.player_name}</span>
                  <span className="font-black tabular-nums shrink-0">{entry.score}</span>
                  <span className="text-[9px] text-zinc-400 dark:text-zinc-600 w-8 text-right shrink-0">{timeAgo(entry.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* Header */}
      <header className="w-full max-w-2xl px-6 pt-10 pb-2 text-center">
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter leading-none">
          Higher<span className="text-zinc-300 dark:text-zinc-700 mx-1">/</span>Lower
        </h1>
        <p className="mt-2 text-xs tracking-widest uppercase text-zinc-400 dark:text-zinc-600">Which post got more upvotes?</p>
        {visitors !== null && (
          <p className="mt-1.5 text-[10px] text-zinc-300 dark:text-zinc-700 tabular-nums">{visitors.toLocaleString()} players</p>
        )}
      </header>

      {/* Score */}
      <div className="mt-4 flex items-baseline gap-3 tabular-nums">
        <span className="text-3xl font-black">{score}</span>
        {bestScore > 0 && <span className="text-xs text-zinc-400 dark:text-zinc-600">best {bestScore}</span>}
      </div>

      {/* Game area */}
      <main className="flex flex-1 w-full items-center justify-center px-4 py-8 pb-24">
        {!displayPosts ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
            <p className="text-xs text-zinc-500 tracking-wide">Loading...</p>
          </div>
        ) : (
          <div className={`relative flex w-full max-w-4xl flex-col items-stretch gap-3 md:flex-row md:gap-4 transition-opacity duration-300 ${state === "loading" ? "opacity-0" : "opacity-100"}`}>
            {displayPosts.map((post, i) => {
              const idx = i as 0 | 1;
              const hasResult = state === "revealed" && result;
              const winner = hasResult ? (result.post_a_ups >= result.post_b_ups ? 0 : 1) : null;
              const isWinner = winner === idx;
              const isLoser = winner !== null && winner !== idx;
              const wasPicked = picked === idx;
              const imgKey = `${roundIdRef.current}-${i}`;
              const showImage = post.image && !imgErrors.has(imgKey);
              const ups = hasResult ? (idx === 0 ? result.post_a_ups : result.post_b_ups) : null;

              return (
                <button
                  key={imgKey}
                  onClick={() => handlePick(idx)}
                  disabled={state !== "playing"}
                  className={`group relative flex flex-1 flex-col overflow-hidden rounded-xl text-left transition-all duration-300
                    ${state === "playing" ? "bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200/80 dark:hover:bg-zinc-800 cursor-pointer active:scale-[0.98]"
                      : isWinner ? "bg-green-50 dark:bg-green-950/30 ring-2 ring-green-500/40"
                      : "bg-zinc-100 dark:bg-zinc-900 opacity-50"}`}
                >
                  {showImage && (
                    <div className="relative w-full h-40 md:h-48 bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={post.image!} alt="" className="w-full h-full object-cover" onError={() => setImgErrors((prev) => new Set(prev).add(imgKey))} />
                    </div>
                  )}
                  <div className={`flex flex-1 flex-col justify-between p-5 md:p-6 ${showImage ? "" : "min-h-[180px]"}`}>
                    <div>
                      <span className="inline-block rounded-full bg-zinc-200/80 dark:bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">r/{post.subreddit}</span>
                      <h2 className={`mt-3 font-semibold leading-snug tracking-tight ${showImage ? "text-sm md:text-base line-clamp-2" : "text-base md:text-lg line-clamp-3"}`}>{post.title}</h2>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-2">
                      {hasResult && ups !== null ? (
                        <div className="animate-count-up flex items-baseline gap-1.5">
                          <span className={`text-2xl md:text-3xl font-black tabular-nums ${isWinner ? "text-green-600 dark:text-green-400" : "text-zinc-400 dark:text-zinc-600"}`}>{formatNumber(ups)}</span>
                          <span className={`text-[11px] ${isWinner ? "text-green-600/60 dark:text-green-400/60" : "text-zinc-400/60"}`}>upvotes</span>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors">&uarr; this one</span>
                      )}
                      {hasResult && wasPicked && (
                        <span className={`animate-fade-in text-xs font-bold tracking-wide uppercase ${result.correct ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{result.correct ? "Yes" : "Nope"}</span>
                      )}
                      {isLoser && !wasPicked && hasResult && (
                        <span className="animate-fade-in text-[10px] text-zinc-400 dark:text-zinc-600">lower</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {state === "playing" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="z-10 flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-black tracking-wider">VS</span>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Name prompt */}
      {showNamePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in px-4">
          <div className="w-full max-w-xs rounded-2xl bg-background p-6 space-y-4 text-center">
            <p className="text-lg font-black">Streak of {pendingScore}!</p>
            <p className="text-xs text-zinc-500">Submit to the leaderboard?</p>
            <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmitScore()} placeholder="Your name" maxLength={20} className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm text-center outline-none focus:border-zinc-400 dark:focus:border-zinc-600" autoFocus />
            {submitMsg && <p className={`text-xs font-medium ${submitMsg === "Submitted!" ? "text-green-600" : "text-red-500"}`}>{submitMsg}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowNamePrompt(false); loadRound(); }} className="flex-1 rounded-lg py-2 text-xs font-medium text-zinc-500 hover:text-foreground transition-colors cursor-pointer">Skip</button>
              <button onClick={handleSubmitScore} disabled={submitting || !nameInput.trim()} className="flex-1 rounded-lg bg-foreground text-background py-2 text-xs font-bold hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer">{submitting ? "..." : "Submit"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Next button */}
      {state === "revealed" && result && !showNamePrompt && (
        <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-14 md:pb-8 animate-fade-in z-20">
          <button onClick={() => loadRound()} className="relative overflow-hidden rounded-full bg-zinc-300 dark:bg-zinc-800 px-7 py-3 text-sm font-bold tracking-tight active:scale-95 transition-transform cursor-pointer">
            <span className="absolute inset-0 bg-foreground origin-left animate-fill-bar" />
            <span className="relative z-10 mix-blend-difference text-white">Next</span>
          </button>
        </div>
      )}
    </div>
  );
}
