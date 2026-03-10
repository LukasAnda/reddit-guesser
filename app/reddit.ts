export interface Post {
  title: string;
  subreddit: string;
  ups: number;
  id: string;
  imageUrl: string | null;
}

export interface Subreddit {
  name: string;
}

const REDDIT_BASE = "https://www.reddit.com";
const CORS_PROXY = "https://corsproxy.io/?url=";

async function fetchJson(url: string) {
  const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
  const res = await fetch(proxiedUrl);
  if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
  return res.json();
}

function extractImageUrl(post: Record<string, unknown>): string | null {
  try {
    const preview = post.preview as { images?: { source?: { url?: string } }[] };
    const src = preview?.images?.[0]?.source?.url;
    if (src) return src.replace(/&amp;/g, "&");
  } catch {}
  const url = post.url as string | undefined;
  if (url && /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) return url;
  return null;
}

export async function fetchPopularSubreddits(count = 150): Promise<Subreddit[]> {
  const subreddits: Subreddit[] = [];
  let after: string | null = null;

  while (subreddits.length < count) {
    const limit = Math.min(100, count - subreddits.length);
    const url = `${REDDIT_BASE}/subreddits/popular.json?limit=${limit}${after ? `&after=${after}` : ""}`;
    const data = await fetchJson(url);
    for (const child of data.data.children) {
      if (!child.data.over18) {
        subreddits.push({ name: child.data.display_name });
      }
    }
    after = data.data.after;
    if (!after) break;
  }
  return subreddits;
}

export async function fetchTopPosts(subreddit: string, limit = 25): Promise<Post[]> {
  const url = `${REDDIT_BASE}/r/${subreddit}/top.json?limit=${limit}&t=week`;
  const data = await fetchJson(url);
  return data.data.children
    .map((child: { data: Record<string, unknown> }) => child.data)
    .filter((post: Record<string, unknown>) => !post.over_18)
    .map((post: Record<string, unknown>) => ({
      title: post.title as string,
      subreddit: post.subreddit as string,
      ups: post.ups as number,
      id: post.id as string,
      imageUrl: extractImageUrl(post),
    }));
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
