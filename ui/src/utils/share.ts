const RECENT_KEY = 'codite.recentScans';
const MAX_RECENT = 6;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Reads `?repo=owner/repo` from a URL search string. */
export const readRepoParam = (search: string): string | null => {
  const repo = new URLSearchParams(search).get('repo')?.trim();
  return repo && REPO_PATTERN.test(repo) ? repo : null;
};

/** Returns `href` with `?repo=` set (or removed when `repo` is null), keeping other params. */
export const withRepoParam = (href: string, repo: string | null): string => {
  const url = new URL(href);
  if (repo) url.searchParams.set('repo', repo);
  else url.searchParams.delete('repo');
  return url.toString();
};

/** Returns `href` with each param set, or removed when its value is null. */
export const withParams = (href: string, params: Record<string, string | null>): string => {
  const url = new URL(href);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return url.toString();
};

export const repoToUrl = (repo: string): string => `https://github.com/${repo}`;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaultStorage = (): StorageLike | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const loadRecentScans = (storage: StorageLike | null = defaultStorage()): string[] => {
  try {
    const parsed = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string' && REPO_PATTERN.test(r)) : [];
  } catch {
    return [];
  }
};

export const rememberScan = (repo: string, storage: StorageLike | null = defaultStorage()): string[] => {
  const next = [repo, ...loadRecentScans(storage).filter((r) => r !== repo)].slice(0, MAX_RECENT);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: recent scans are a convenience only.
  }
  return next;
};
