export interface ParsedRepo {
  host: string;
  owner: string;
  repo: string;
  /** Canonical HTTPS clone URL rebuilt from validated parts (never the raw input). */
  cloneUrl: string;
}

export class RepoUrlError extends Error {}

const MAX_URL_LENGTH = 2048;
const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

export const parseAllowedHosts = (raw: string | undefined): string[] => {
  const hosts = (raw ?? 'github.com')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : ['github.com'];
};

const isValidSegment = (s: string) => SEGMENT.test(s) && s !== '.' && s !== '..';

/**
 * Validates a user-supplied repository URL and reduces it to `host/owner/repo`.
 * Accepts browser URLs such as `https://github.com/o/r/tree/main` or `github.com/o/r`.
 */
export function parseRepoUrl(input: unknown, allowedHosts: readonly string[]): ParsedRepo {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new RepoUrlError('Repository URL is required.');
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new RepoUrlError('Repository URL is too long.');
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new RepoUrlError('Repository URL is invalid.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RepoUrlError('Only HTTP(S) repository URLs are supported.');
  }
  if (url.username || url.password) {
    throw new RepoUrlError('Repository URLs must not contain credentials.');
  }
  if (url.port) {
    throw new RepoUrlError('Repository URLs must not specify a port.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!allowedHosts.includes(host)) {
    throw new RepoUrlError(`Only repositories on ${allowedHosts.join(', ')} are supported.`);
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new RepoUrlError('Repository URL must look like https://github.com/<owner>/<repo>.');
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  if (!isValidSegment(owner) || !isValidSegment(repo)) {
    throw new RepoUrlError('Repository owner or name contains invalid characters.');
  }

  return { host, owner, repo, cloneUrl: `https://${host}/${owner}/${repo}.git` };
}
