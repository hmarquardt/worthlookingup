/* Scheduled launch-schedule ingestion for Worth Looking Up.
 *
 * This is the server-side refresh described in docs/launches.md. It runs from the scheduled workflow
 * (.github/workflows/launches-data.yml), never in a visitor's browser, and it publishes exactly one
 * artifact: data/launches/upcoming.json, the normalized public feed.
 *
 *   node scripts/refresh-launches.mjs             fetch upstream and publish if it validates
 *   node scripts/refresh-launches.mjs --check     validate the committed artifact offline (no network)
 *   node scripts/refresh-launches.mjs --no-network  alias for --check, matching the Python builders
 *
 * A failed or invalid retrieval leaves the previous artifact exactly as it was and exits non-zero, so
 * the site keeps serving the last good schedule instead of an empty or invented one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEED_SCHEMA, MAX_LAUNCHES, PROVIDER, REFRESH_INTERVAL_MINUTES, STALE_AFTER_MINUTES, assertValidFeed, buildFeed, feedStats, fetchUpstreamLaunches, mergeFeeds, validateFeed } from '../src/launches/launch-feed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(root, 'data/launches/upcoming.json');
const WINDOW_DAYS = 180;
const MAX_PAGES = 3;

function readPrevious() {
  try {
    const value = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    return value && value.schema === FEED_SCHEMA ? value : null;
  } catch { return null; }
}

function check() {
  const feed = readPrevious();
  if (!feed) { console.error('FAIL: ' + path.relative(root, artifact) + ' is missing or is not a ' + FEED_SCHEMA + ' artifact.'); process.exit(1); }
  const result = validateFeed(feed);
  const problems = [...result.errors];
  const stats = feedStats(feed.launches);
  if (feed.stats && feed.stats.count !== stats.count) problems.push('stats.count does not match the launch list');
  if (!Number.isFinite(Date.parse(feed.generated_at))) problems.push('generated_at is missing');
  if (feed.launches.length === 0) problems.push('the committed feed contains no launch, which is never a valid schedule');
  if (feed.launches.length > MAX_LAUNCHES) problems.push('the committed feed exceeds ' + MAX_LAUNCHES + ' launches');
  if (feed.source && feed.source.name !== PROVIDER.name) problems.push('the committed feed does not credit ' + PROVIDER.name);
  if (problems.length) { console.error('FAIL: ' + problems.slice(0, 8).join('; ')); process.exit(1); }
  const age = Math.round((Date.now() - Date.parse(feed.generated_at)) / 60000);
  console.log('PASS: ' + feed.launches.length + ' launches, ' + stats.with_published_time + ' with a published time, '
    + stats.with_published_date + ' with a published date, ' + stats.period_only + ' with a period only; generated '
    + feed.generated_at + ' (' + age + ' minutes ago); refresh every ' + REFRESH_INTERVAL_MINUTES + ' minutes, stale after '
    + STALE_AFTER_MINUTES + '; ' + result.warnings.length + ' warning(s)');
  if (result.warnings.length) console.log('      warnings: ' + result.warnings.slice(0, 3).join('; '));
}

async function refresh() {
  const previous = readPrevious();
  const now = Date.now();
  let upstream;
  try {
    upstream = await fetchUpstreamLaunches({ now, windowDays: WINDOW_DAYS, maxPages: MAX_PAGES });
  } catch (error) {
    console.error('FAIL: upstream retrieval failed (' + String((error && error.code) || 'unknown') + ': ' + String((error && error.message) || error) + ').');
    console.error('      The committed feed was left untouched, so the site keeps serving the last good schedule.');
    process.exit(1);
  }
  if (!upstream.records.length) {
    console.error('FAIL: upstream returned no launch records. Refusing to publish an empty schedule.');
    process.exit(1);
  }
  const merged = mergeFeeds(upstream.records, previous, { now });
  let feed;
  try {
    feed = buildFeed({ records: merged.records, previous, now, upstream: upstream.source, windowDays: WINDOW_DAYS });
  } catch (error) {
    console.error('FAIL: ' + String((error && error.message) || error));
    console.error('      The committed feed was left untouched.');
    process.exit(1);
  }
  assertValidFeed(feed);
  const serialized = JSON.stringify(feed, null, 1) + '\n';
  const temporary = artifact + '.tmp';
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(temporary, serialized);
  fs.renameSync(temporary, artifact);
  const changes = feed.launches.filter(record => record.change).length;
  console.log('PASS: published ' + feed.launches.length + ' launches (' + merged.fresh + ' refreshed, ' + merged.kept
    + ' kept from the previous feed, ' + changes + ' schedule change(s) detected) from ' + PROVIDER.name + ' '
    + PROVIDER.api_version + ' in ' + upstream.source.pages + ' request(s); upstream total '
    + String(upstream.source.count) + ', announced overall ' + String(upstream.source.announced_total) + '.');
  console.log('      ' + path.relative(root, artifact) + ' written atomically; ' + Buffer.byteLength(serialized)
    + ' bytes; sha256 ' + String(upstream.source.sha256 || 'unavailable').slice(0, 16) + '\u2026 of the upstream payload.');
}

const offline = process.argv.includes('--check') || process.argv.includes('--no-network');
if (offline) check();
else await refresh();
