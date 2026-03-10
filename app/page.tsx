"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPopularSubreddits,
  fetchTopPosts,
  pickRandom,
  type Post,
  type Subreddit,
} from "./reddit";

type GameState = "loading" | "playing" | "revealed" | "error";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

export default function Home() {
  const [subreddits, setSubreddits] = useState<Subreddit[]>([]);
  const [posts, setPosts] = useState<[Post, Post] | null>(null);
  const [state, setState] = useState<GameState>("loading");
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [picked, setPicked] = useState<0 | 1 | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const postCacheRef = useRef<Map<string, Post[]>>(new Map());

  useEffect(() => {
    fetchPopularSubreddits(150)
      .then((subs) => setSubreddits(subs))
      .catch(() => setState("error"));
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

  const handlePick = (index: 0 | 1) => {
    if (state !== "playing" || !posts) return;
    setPicked(index);
    setState("revealed");

    const winner = posts[0].ups >= posts[1].ups ? 0 : 1;
    const isCorrect = index === winner;
    setCorrect(isCorrect);

    if (isCorrect) {
      setScore((s) => {
        const next = s + 1;
        setBestScore((b) => Math.max(b, next));
        return next;
      });
    } else {
      setScore(0);
    }
  };

  // Auto-advance after 3 seconds
  useEffect(() => {
    if (state !== "revealed") return;
    const timer = setTimeout(() => loadRound(), 3000);
    return () => clearTimeout(timer);
  }, [state, loadRound]);

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
      </header>

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
      <main className="flex flex-1 w-full items-center justify-center px-4 py-8">
        {!posts ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
            <p className="text-xs text-zinc-500 tracking-wide">Loading posts...</p>
          </div>
        ) : (
          <div className={`relative flex w-full max-w-3xl flex-col items-stretch gap-3 md:flex-row md:gap-4 transition-opacity duration-300 ${state === "loading" ? "opacity-0" : "opacity-100"}`}>
            {posts.map((post, i) => {
              const idx = i as 0 | 1;
              const winner = posts[0].ups >= posts[1].ups ? 0 : 1;
              const isWinner = state === "revealed" && winner === idx;
              const isLoser = state === "revealed" && winner !== idx;
              const wasPicked = picked === idx;

              return (
                <button
                  key={post.id + "-" + i}
                  onClick={() => handlePick(idx)}
                  disabled={state !== "playing"}
                  className={`
                    group relative flex flex-1 flex-col justify-between rounded-xl p-5 md:p-6 text-left transition-all duration-300 min-h-[180px]
                    ${state === "playing"
                      ? "bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200/80 dark:hover:bg-zinc-800 cursor-pointer active:scale-[0.98]"
                      : isWinner
                        ? "bg-green-50 dark:bg-green-950/30 ring-2 ring-green-500/40"
                        : "bg-zinc-100 dark:bg-zinc-900 opacity-50"
                    }
                  `}
                >
                  {/* Subreddit tag */}
                  <span className="inline-block self-start rounded-full bg-zinc-200/80 dark:bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    r/{post.subreddit}
                  </span>

                  {/* Post title */}
                  <h2 className="mt-3 text-base md:text-lg font-semibold leading-snug tracking-tight line-clamp-3">
                    {post.title}
                  </h2>

                  {/* Bottom: vote count or prompt */}
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

      {/* Next button with fill progress */}
      {state === "revealed" && (
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
