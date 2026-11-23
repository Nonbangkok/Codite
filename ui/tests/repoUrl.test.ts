import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseAllowedHosts, parseRepoUrl, RepoUrlError } from '../server/repoUrl.ts';

const hosts = ['github.com'];

test('accepts a plain GitHub URL and builds a canonical clone URL', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/owner/repo', hosts), {
    host: 'github.com',
    owner: 'owner',
    repo: 'repo',
    cloneUrl: 'https://github.com/owner/repo.git',
  });
});

test('normalizes .git suffix, trailing paths, www, http and missing scheme', () => {
  for (const input of [
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo/',
    'https://github.com/owner/repo/tree/main/src?tab=readme#top',
    'http://www.github.com/owner/repo',
    '  github.com/owner/repo  ',
  ]) {
    assert.equal(parseRepoUrl(input, hosts).cloneUrl, 'https://github.com/owner/repo.git', input);
  }
});

test('allows dot-prefixed repo names like .github', () => {
  assert.equal(parseRepoUrl('https://github.com/owner/.github', hosts).repo, '.github');
});

test('rejects hosts outside the allowlist (SSRF)', () => {
  for (const input of [
    'http://localhost:3002/a/b',
    'http://169.254.169.254/latest/meta-data',
    'https://github.com.evil.com/owner/repo',
    'https://evil.com/github.com/owner/repo',
    'http://127.0.0.1/owner/repo',
  ]) {
    assert.throws(() => parseRepoUrl(input, hosts), RepoUrlError, input);
  }
});

test('rejects credentials, ports, non-http schemes and bad segments', () => {
  for (const input of [
    'https://user:token@github.com/owner/repo',
    'https://github.com:8443/owner/repo',
    'file:///etc/passwd',
    'ssh://github.com/owner/repo',
    'git@github.com:owner/repo.git',
    'https://github.com/owner',
    'https://github.com/owner/..',
    'https://github.com/own%20er/repo',
    'https://github.com/owner/re;po',
    '',
    42,
    `https://github.com/owner/${'a'.repeat(3000)}`,
  ]) {
    assert.throws(() => parseRepoUrl(input, hosts), RepoUrlError, String(input));
  }
});

test('parseAllowedHosts falls back to github.com and normalizes entries', () => {
  assert.deepEqual(parseAllowedHosts(undefined), ['github.com']);
  assert.deepEqual(parseAllowedHosts(' , '), ['github.com']);
  assert.deepEqual(parseAllowedHosts('GitHub.com, gitlab.com'), ['github.com', 'gitlab.com']);
});
