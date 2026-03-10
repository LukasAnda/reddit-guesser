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
  fetchLeaderboard,
  submitScore,
  type LeaderboardEntry,
  type Round,
} from "./supabase";

type GameState = "loading" | "playing" | "revealed" | "error";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function generateSessionId(): string {
  return crypto.randomUUID();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function Home() {
  const [subreddits, setSubreddits] = useState<Subreddit[]>([]);
  const [posts, setPosts] = useState<[Post, Post] | null>(null);
  const [state, setState] = useState<GameState>("loading");
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [picked, setPicked] = useState<0 | 1 | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [visitors, setVisitors] = useState<number | null>(null);
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());
  const postCacheRef = useRef<Map<string, Post[]>>(new Map());

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingScore, setPendingScore] = useState(0);

  // Proof-of-play tracking
  const sessionIdRef = useRef(generateSessionId());
  const roundsRef = useRef<Round[]>([]);

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

    fetchLeaderboard().then(setLeaderboard).catch(() => {});

    // Restore saved name
    const saved = localStorage.getItem("playerName");
    if (saved) setNameInput(saved);
  }, []);

  const refreshLeaderboard = useCallback(() => {
    fetchLeaderboard().then(setLeaderboard).catch(() => {});
  }, []);

  const getPostsForSubreddit = useCallback(
    async (sub: string): Promise<Post[]> => {
      const cache = postCacheRef.current;
      if (cache.has(sub) && cache.get(sub)!.length > 0) {
        return cache.get(sub)!;
      }
      const posts = await fetchTopPosts(sub);
      cache.set(sub, posts);
      return posts;
    },
    []
  );

  const loadRound = useCallback(async () => {
    if (subreddits.length < 2) return;
    setState("loading");
    setPicked(null);
    setCorrect(null);

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

        setPosts([post1, post2]);
        setImgErrors(new Set());
        setState("playing");
        return;
      } catch {
        continue;
      }
    }
    setState("error");
  }, [subreddits, getPostsForSubreddit]);

  useEffect(() => {
    if (subreddits.length > 0 && !posts) loadRound();
  }, [subreddits, posts, loadRound]);

  const handlePick = useCallback((index: 0 | 1) => {
    if (state !== "playing" || !posts) return;
    setPicked(index);

    const winner = posts[0].ups >= posts[1].ups ? 0 : 1;
    const isCorrect = index === winner;
    setCorrect(isCorrect);

    // Record round for proof-of-play
    roundsRef.current.push({
      postA_id: posts[0].id,
      postB_id: posts[1].id,
      postA_ups: posts[0].ups,
      postB_ups: posts[1].ups,
      picked: index,
      timestamp: Date.now(),
    });

    if (isCorrect) {
      setScore((s) => {
        const next = s + 1;
        setBestScore((b) => Math.max(b, next));
        return next;
      });
    } else {
      // Wrong answer: check if streak was worth submitting
      setScore((prevScore) => {
        if (prevScore >= 3) {
          setPendingScore(prevScore);
          setShowNamePrompt(true);
        }
        return 0;
      });
    }

    setState("revealed");
  }, [state, posts]);

  // Auto-advance (pause when name prompt is showing)
  useEffect(() => {
    if (state !== "revealed" || showNamePrompt) return;
    const timer = setTimeout(() => loadRound(), 3000);
    return () => clearTimeout(timer);
  }, [state, loadRound, showNamePrompt]);

  const handleSubmitScore = async () => {
    const name = nameInput.trim();
    if (!name || pendingScore < 1) return;
    setSubmitting(true);
    setSubmitMsg(null);

    localStorage.setItem("playerName", name);

    const result = await submitScore(
      name,
      pendingScore,
      sessionIdRef.current,
      roundsRef.current
    );

    if (result.ok) {
      setSubmitMsg("Submitted!");
      refreshLeaderboard();
      // Reset session for next game
      sessionIdRef.current = generateSessionId();
      roundsRef.current = [];
    } else {
      setSubmitMsg(result.error ?? "Failed to submit");
    }

    setSubmitting(false);
    setTimeout(() => {
      setShowNamePrompt(false);
      setSubmitMsg(null);
      loadRound();
    }, 1500);
  };

  if (state === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-zinc-500">Could not load data from Reddit.</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-zinc-400 hover:text-foreground underline underline-offset-4 cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-2xl px-6 pt-10 pb-2 text-center">
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter leading-none">
          Higher
          <span className="text-zinc-300 dark:text-zinc-700 mx-1">/</span>
          Lower
        </h1>
        <p className="mt-2 text-xs tracking-widest uppercase text-zinc-400 dark:text-zinc-600">
          Which post got more upvotes?
        </p>
        <div className="mt-1.5 flex items-center justify-center gap-3">
          {visitors !== null && (
            <span className="text-[10px] text-zinc-300 dark:text-zinc-700 tabular-nums">
              {visitors.toLocaleString()} players
            </span>
          )}
          <button
            onClick={() => { setShowLeaderboard(!showLeaderboard); refreshLeaderboard(); }}
            className="text-[10px] text-zinc-400 dark:text-zinc-600 hover:text-foreground transition-colors cursor-pointer underline underline-offset-2"
          >
            {showLeaderboard ? "hide" : "leaderboard"}
          </button>
        </div>
      </header>

      {/* Leaderboard panel */}
      {showLeaderboard && (
        <div className="w-full max-w-sm px-4 mt-2 animate-fade-in">
          <div className="rounded-xl bg-zinc-100 dark:bg-zinc-900 p-4">
            <h3 className="text-xs font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-600 mb-3">
              Top Scores
            </h3>
            {leaderboard.length === 0 ? (
              <p className="text-xs text-zinc-400">No scores yet. Be the first!</p>
            ) : (
              <div className="space-y-1.5">
                {leaderboard.map((entry, i) => (
                  <div key={entry.id} className="flex items-center gap-2 text-sm">
                    <span className={`w-5 text-right tabular-nums font-bold ${i < 3 ? "text-foreground" : "text-zinc-400"}`}>
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate">{entry.player_name}</span>
                    <span className="font-black tabular-nums">{entry.score}</span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600 w-14 text-right">
                      {timeAgo(entry.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Score */}
      <div className="mt-4 flex items-baseline gap-3 tabular-nums">
        <span className="text-3xl font-black">{score}</span>
        {bestScore > 0 && (
          <span className="text-xs text-zinc-400 dark:text-zinc-600">
            best {bestScore}
          </span>
        )}
      </div>

      {/* Game area */}
      <main className="flex flex-1 w-full items-center justify-center px-4 py-8 pb-24">
        {!posts ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
            <p className="text-xs text-zinc-500 tracking-wide">Loading posts...</p>
          </div>
        ) : (
          <div className={`relative flex w-full max-w-4xl flex-col items-stretch gap-3 md:flex-row md:gap-4 transition-opacity duration-300 ${state === "loading" ? "opacity-0" : "opacity-100"}`}>
            {posts.map((post, i) => {
              const idx = i as 0 | 1;
              const winner = posts[0].ups >= posts[1].ups ? 0 : 1;
              const isWinner = state === "revealed" && winner === idx;
              const isLoser = state === "revealed" && winner !== idx;
              const wasPicked = picked === idx;
              const showImage = post.imageUrl && !imgErrors.has(post.id);

              return (
                <button
                  key={post.id + "-" + i}
                  onClick={() => handlePick(idx)}
                  disabled={state !== "playing"}
                  className={`
                    group relative flex flex-1 flex-col overflow-hidden rounded-xl text-left transition-all duration-300
                    ${state === "playing"
                      ? "bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200/80 dark:hover:bg-zinc-800 cursor-pointer active:scale-[0.98]"
                      : isWinner
                        ? "bg-green-50 dark:bg-green-950/30 ring-2 ring-green-500/40"
                        : "bg-zinc-100 dark:bg-zinc-900 opacity-50"
                    }
                  `}
                >
                  {/* Image */}
                  {showImage && (
                    <div className="relative w-full h-40 md:h-48 bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={post.imageUrl!}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={() => setImgErrors((prev) => new Set(prev).add(post.id))}
                      />
                    </div>
                  )}

                  {/* Content */}
                  <div className={`flex flex-1 flex-col justify-between p-5 md:p-6 ${showImage ? "" : "min-h-[180px]"}`}>
                    <div>
                      <span className="inline-block rounded-full bg-zinc-200/80 dark:bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        r/{post.subreddit}
                      </span>
                      <h2 className={`mt-3 font-semibold leading-snug tracking-tight ${showImage ? "text-sm md:text-base line-clamp-2" : "text-base md:text-lg line-clamp-3"}`}>
                        {post.title}
                      </h2>
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-2">
                      {state === "revealed" ? (
                        <div className="animate-count-up flex items-baseline gap-1.5">
                          <span className={`text-2xl md:text-3xl font-black tabular-nums ${isWinner ? "text-green-600 dark:text-green-400" : "text-zinc-400 dark:text-zinc-600"}`}>
                            {formatNumber(post.ups)}
                          </span>
                          <span className={`text-[11px] ${isWinner ? "text-green-600/60 dark:text-green-400/60" : "text-zinc-400/60"}`}>
                            upvotes
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors">
                          &uarr; this one
                        </span>
                      )}

                      {state === "revealed" && wasPicked && (
                        <span
                          className={`animate-fade-in text-xs font-bold tracking-wide uppercase ${correct ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
                        >
                          {correct ? "Yes" : "Nope"}
                        </span>
                      )}

                      {isLoser && !wasPicked && state === "revealed" && (
                        <span className="animate-fade-in text-[10px] text-zinc-400 dark:text-zinc-600">
                          lower
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* VS divider */}
            {state === "playing" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="z-10 flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-black tracking-wider">
                  VS
                </span>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Name prompt overlay */}
      {showNamePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in px-4">
          <div className="w-full max-w-xs rounded-2xl bg-background p-6 space-y-4 text-center">
            <p className="text-lg font-black">Streak of {pendingScore}!</p>
            <p className="text-xs text-zinc-500">Submit your score to the leaderboard?</p>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmitScore()}
              placeholder="Your name"
              maxLength={20}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm text-center outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              autoFocus
            />
            {submitMsg && (
              <p className={`text-xs font-medium ${submitMsg === "Submitted!" ? "text-green-600" : "text-red-500"}`}>
                {submitMsg}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowNamePrompt(false); roundsRef.current = []; sessionIdRef.current = generateSessionId(); loadRound(); }}
                className="flex-1 rounded-lg py-2 text-xs font-medium text-zinc-500 hover:text-foreground transition-colors cursor-pointer"
              >
                Skip
              </button>
              <button
                onClick={handleSubmitScore}
                disabled={submitting || !nameInput.trim()}
                className="flex-1 rounded-lg bg-foreground text-background py-2 text-xs font-bold hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                {submitting ? "..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Next button with fill progress */}
      {state === "revealed" && !showNamePrompt && (
        <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-8 animate-fade-in">
          <button
            onClick={() => loadRound()}
            className="relative overflow-hidden rounded-full bg-zinc-300 dark:bg-zinc-800 px-7 py-3 text-sm font-bold tracking-tight active:scale-95 transition-transform cursor-pointer"
          >
            <span
              className="absolute inset-0 bg-foreground origin-left animate-fill-bar"
            />
            <span className="relative z-10 mix-blend-difference text-white">
              Next
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
