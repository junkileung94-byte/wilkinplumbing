'use strict';
/* Commit edited files back to GitHub.
 *
 * The live site is redeployed from the repo, so anything the admin writes to the
 * server's own filesystem is erased on the next deploy. Every save therefore ends with
 * a real commit — git stays the source of truth and edits survive redeploys.
 *
 * Uses the Git Data API (blobs → tree → commit → ref) so one save lands as ONE commit
 * even though it touches index.html plus the eleven generated location pages.
 *
 * Config, all from the environment — never from the repo, which is public:
 *   GITHUB_TOKEN   fine-grained PAT, Contents: read+write on this repo only  (required)
 *   GITHUB_REPO    owner/name                             (default junkileung94-byte/wilkinplumbing)
 *   GITHUB_BRANCH  branch to commit to                    (default main)
 *   GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL                    (defaults below)
 */

const API = 'https://api.github.com';

function config() {
  return {
    token: process.env.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || 'junkileung94-byte/wilkinplumbing',
    branch: process.env.GITHUB_BRANCH || 'main',
    name: process.env.GIT_AUTHOR_NAME || 'Wilkin Plumbing admin',
    email: process.env.GIT_AUTHOR_EMAIL || 'info@wilkinplumbing.ca',
  };
}

function enabled() {
  return !!config().token;
}

async function gh(pathname, { method = 'GET', body } = {}) {
  const { token, repo } = config();
  const res = await fetch(`${API}/repos/${repo}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wilkin-admin',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try { detail = JSON.parse(text).message || detail; } catch (err) { /* keep raw */ }
    throw new Error(`GitHub ${method} ${pathname} → ${res.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Commit a set of files in one commit.
 * @param {Array<{path:string, content:string, encoding?:'utf-8'|'base64'}>} files
 * @param {string} message
 * @returns {Promise<{committed:boolean, sha?:string, url?:string, reason?:string}>}
 */
async function commitFiles(files, message) {
  if (!enabled()) {
    return { committed: false, reason: 'no-token' };
  }
  if (!files.length) {
    return { committed: false, reason: 'no-changes' };
  }
  const { branch, name, email } = config();

  const ref = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const headCommit = await gh(`/git/commits/${headSha}`);

  const tree = [];
  for (const f of files) {
    const blob = await gh('/git/blobs', {
      method: 'POST',
      body: { content: f.content, encoding: f.encoding === 'base64' ? 'base64' : 'utf-8' },
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await gh('/git/trees', {
    method: 'POST',
    body: { base_tree: headCommit.tree.sha, tree },
  });

  const commit = await gh('/git/commits', {
    method: 'POST',
    body: {
      message,
      tree: newTree.sha,
      parents: [headSha],
      author: { name, email, date: new Date().toISOString() },
    },
  });

  await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
  });

  return { committed: true, sha: commit.sha.slice(0, 7), url: commit.html_url };
}

module.exports = { commitFiles, enabled, config };
