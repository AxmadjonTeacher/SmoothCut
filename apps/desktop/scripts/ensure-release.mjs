/**
 * Creates the GitHub release for the current version BEFORE electron-builder
 * runs. electron-builder uploads a release's assets concurrently and each
 * upload independently does "find the release, create it if missing" — two of
 * those creates can race past each other and BOTH succeed, leaving two
 * published releases on the same tag (seen on v0.1.3–v0.1.5; GitHub happily
 * hosts both, and /releases/latest/download then 404s for whichever platform's
 * assets landed on the loser). Creating the release here, once and serially,
 * means every later find-or-create resolves to the existing release.
 *
 * Refuses to run if the tag has not been pushed: creating a release for a
 * missing tag would mint that tag at the default branch's HEAD, silently
 * bypassing the documented tag-first flow.
 */
import { readFileSync } from 'node:fs';

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) {
  console.error('ensure-release: GH_TOKEN (or GITHUB_TOKEN) must be set to publish.');
  process.exit(1);
}

const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const tag = `v${version}`;

// Single source of truth: the publish target in electron-builder.yml.
const builderYml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
const owner = builderYml.match(/^\s*owner:\s*(\S+)\s*$/m)?.[1];
const repo = builderYml.match(/^\s*repo:\s*(\S+)\s*$/m)?.[1];
if (!owner || !repo) {
  console.error('ensure-release: could not read publish.owner/repo from electron-builder.yml');
  process.exit(1);
}

const api = (path, init = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

const tagRes = await api(`/repos/${owner}/${repo}/git/ref/tags/${tag}`);
if (tagRes.status === 404) {
  console.error(
    `ensure-release: tag ${tag} does not exist on ${owner}/${repo} — push it first ` +
      `(git tag ${tag} && git push origin ${tag}). Creating the release without the ` +
      'tag would mint it at the default branch HEAD.',
  );
  process.exit(1);
}
if (!tagRes.ok) {
  console.error(`ensure-release: tag lookup failed: ${tagRes.status} ${await tagRes.text()}`);
  process.exit(1);
}

// List instead of /releases/tags/{tag}: that endpoint returns only ONE
// release, and we specifically care about the duplicate case.
const listRes = await api(`/repos/${owner}/${repo}/releases?per_page=100`);
if (!listRes.ok) {
  console.error(`ensure-release: release listing failed: ${listRes.status}`);
  process.exit(1);
}
const existing = (await listRes.json()).filter((r) => r.tag_name === tag);
if (existing.length > 1) {
  console.error(
    `ensure-release: ${existing.length} releases already exist for ${tag} ` +
      `(ids ${existing.map((r) => r.id).join(', ')}) — merge their assets into one and ` +
      'delete the rest before publishing (see README "Publishing a release").',
  );
  process.exit(1);
}
if (existing.length === 1) {
  console.log(`ensure-release: release for ${tag} already exists (id ${existing[0].id}).`);
  process.exit(0);
}

const createRes = await api(`/repos/${owner}/${repo}/releases`, {
  method: 'POST',
  body: JSON.stringify({ tag_name: tag, name: version, draft: false, prerelease: false }),
});
if (createRes.status === 201) {
  console.log(`ensure-release: created release ${tag}.`);
} else if (createRes.status === 422) {
  // Lost a (now tiny) creation race to another publisher — that's fine, the
  // release exists.
  console.log(`ensure-release: release ${tag} was created concurrently — continuing.`);
} else {
  console.error(`ensure-release: create failed: ${createRes.status} ${await createRes.text()}`);
  process.exit(1);
}
