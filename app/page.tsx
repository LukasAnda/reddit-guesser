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

  // Load subreddits once
  useEffect(() => {
    fetchPopularSubreddits(150)
      .then((subs) => {
        setSubreddits(subs);
      })
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

    const maxRetries = 10;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const sub1 = pickRandom(subreddits);
        let sub2 = pickRandom(subreddits);
        while (sub2.name === sub1.name) {
          sub2 = pickRandom(subreddits);
        }

        const [posts1, posts2] = await Promise.all([
          getPostsForSubreddit(sub1.name),
          getPostsForSubreddit(sub2.name),
        ]);

        if (posts1.length === 0 || posts2.length === 0) continue;

        const post1 = pickRandom(posts1);
        const post2 = pickRandom(posts2);

        // Avoid trivially identical scores
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

  // Start first round when subreddits are loaded
  useEffect(() => {
    if (subreddits.length > 0 && !posts) {
      loadRound();
    }
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

  const handleNext = () => {
    loadRound();
  };

  if (state === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-lg text-zinc-500">
            Could not load data from Reddit.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm font-medium text-zinc-400 hover:text-zinc-200 underline underline-offset-4 cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5">
        <h1 className="text-sm font-medium tracking-tight text-zinc-400">
          Higher or Lower
        </h1>
        <div className="flex items-center gap-4 text-sm tabular-nums">
          {bestScore > 0 && (
            <span className="text-zinc-500">Best {bestScore}</span>
          )}
          <span className="font-semibold">{score}</span>
        </div>
      </header>

      {/* Game area */}
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        {state === "loading" && !posts ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
            <p className="text-sm text-zinc-500">Loading...</p>
          </div>
        ) : posts ? (
          <div className="flex w-full max-w-3xl flex-col items-stretch gap-4 md:flex-row md:gap-6">
            {posts.map((post, i) => {
              const idx = i as 0 | 1;
              const isWinner =
                state === "revealed" &&
                (posts[0].ups >= posts[1].ups ? 0 : 1) === idx;
              const wasPicked = picked === idx;

              return (
                <button
                  key={post.id + "-" + i}
                  onClick={() => handlePick(idx)}
                  disabled={state !== "playing"}
                  className={`
                    group relative flex flex-1 flex-col justify-between rounded-2xl border p-6 text-left transition-all duration-200
                    ${
                      state === "playing"
                        ? "border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 cursor-pointer"
                        : state === "revealed" && isWinner
                          ? "border-green-400/60 bg-green-50/50 dark:border-green-500/30 dark:bg-green-950/20"
                          : "border-zinc-200 dark:border-zinc-800 opacity-60"
                    }
                    ${state === "revealed" && isWinner ? "animate-pulse-win" : ""}
                  `}
                >
                  <div>
                    <span className="text-xs font-medium tracking-wide uppercase text-zinc-400 dark:text-zinc-500">
                      r/{post.subreddit}
                    </span>
                    <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight line-clamp-4">
                      {post.title}
                    </h2>
                  </div>

                  <div className="mt-6 flex items-end justify-between">
                    {state === "revealed" ? (
                      <span
                        className={`animate-count-up text-2xl font-bold tabular-nums ${isWinner ? "text-green-600 dark:text-green-400" : "text-zinc-400"}`}
                      >
                        {formatNumber(post.ups)}
                        <span className="ml-1 text-sm font-normal">
                          upvotes
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                        Pick this one
                      </span>
                    )}

                    {state === "revealed" && wasPicked && (
                      <span
                        className={`animate-fade-in text-xs font-medium ${correct ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}
                      >
                        {correct ? "Correct" : "Wrong"}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </main>

      {/* VS badge + Next button */}
      {posts && state === "playing" && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <span className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-bold tracking-widest text-white dark:bg-white dark:text-zinc-900">
            VS
          </span>
        </div>
      )}

      {state === "revealed" && (
        <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-8 animate-fade-in">
          <button
            onClick={handleNext}
            className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
          >
            Next round
          </button>
        </div>
      )}
    </div>
  );
}
