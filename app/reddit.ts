export interface Subreddit {
  name: string;
  subscribers: number;
}

export interface Post {
  title: string;
  subreddit: string;
  ups: number;
  id: string;
}

const REDDIT_BASE = "https://www.reddit.com";

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
  return res.json();
}

export async function fetchPopularSubreddits(
  count: number = 150
): Promise<Subreddit[]> {
  const subreddits: Subreddit[] = [];
  let after: string | null = null;

  while (subreddits.length < count) {
    const limit = Math.min(100, count - subreddits.length);
    const url = `${REDDIT_BASE}/subreddits/popular.json?limit=${limit}${after ? `&after=${after}` : ""}`;
    const data = await fetchJson(url);

    for (const child of data.data.children) {
      const sub = child.data;
      if (!sub.over18) {
        subreddits.push({
          name: sub.display_name,
          subscribers: sub.subscribers,
        });
      }
    }

    after = data.data.after;
    if (!after) break;
  }

  return subreddits;
}

export async function fetchTopPosts(
  subreddit: string,
  limit: number = 25
): Promise<Post[]> {
  const url = `${REDDIT_BASE}/r/${subreddit}/top.json?limit=${limit}&t=week`;
  const data = await fetchJson(url);

  return data.data.children
    .map((child: { data: { title: string; subreddit: string; ups: number; id: string; over_18: boolean } }) => child.data)
    .filter((post: { over_18: boolean }) => !post.over_18)
    .map((post: { title: string; subreddit: string; ups: number; id: string }) => ({
      title: post.title,
      subreddit: post.subreddit,
      ups: post.ups,
      id: post.id,
    }));
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
