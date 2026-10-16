/* Monthly trajectory-evidence audit (Phase 5C).
   Usage: node scripts/audit-trajectory-profiles.mjs [--json <path>] [--emit-review <dir>] [--offline]

   Read-only. This job never writes to the repository, never rewrites a profile and never promotes one:
   it validates the published artifact, index and review record, recomputes both anchoring gates from the
   artifact's own numbers, re-checks each published profile against fresh copies of the sources it cites,
   and reports. Its only outputs are the console, a JSON report, an optional candidate review record placed
   *outside* the repository, and the GitHub step summary when the workflow provides one.

   Exit codes: 0 = nothing to do (including sources that were simply unavailable), 1 = integrity failure or
   evidence drift that needs a human. A transient provider failure is never reported as a contradiction,
   and a source that does not answer can never demote a profile. The judgement itself lives in
   src/launches/trajectory-audit.mjs, which the tests exercise without a network; the drift policy is
   written down in docs/trajectory-audit.md. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as AUDIT from '../src/launches/trajectory-audit.mjs';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
};
const JSON_PATH = option('--json');
const EMIT_REVIEW = option('--emit-review');
const OFFLINE = args.includes('--offline');
const RETRIEVED_TODAY = new Date().toISOString().slice(0, 10);

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const artifact = readJson('../data/launches/trajectory-profiles.json');
const padIndex = readJson('../data/launches/trajectory-pad-index.json');
const review = readJson('../data/launches/trajectory-review.json');
const artifactBytes = readFileSync(new URL('../data/launches/trajectory-profiles.json', import.meta.url));
const artifactDigest = createHash('sha256').update(artifactBytes).digest('hex');

/* ---- 1. integrity: the committed files against themselves ---------------- */

const checks = AUDIT.auditIntegrity({ artifact, padIndex, review, artifactDigest });


/* ---- 2. live sources, best effort ---------------------------------------- */

const GCAT = 'https://planet4589.org/space/gcat/tsv/';
const CACHE = new URL('file:///tmp/wlu-trajectory-audit/');

// A source that does not answer yields an unavailable result, never a contradiction. With a cache name,
// the copy fetched by an earlier run is used instead of failing the check.
async function fetchText(url, cacheName) {
  if (cacheName && OFFLINE) {
    try { return { status: 'ok', text: readFileSync(new URL(cacheName, CACHE), 'utf8'), stale: true }; }
    catch { return { status: 'unavailable', detail: 'no cached copy and --offline was requested' }; }
  }
  try {
    const live = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!live.ok) return { status: 'unavailable', detail: `HTTP ${live.status}` };
    const text = await live.text();
    if (cacheName) {
      try { mkdirSync(CACHE, { recursive: true }); writeFileSync(new URL(cacheName, CACHE), text); } catch {}
    }
    return { status: 'ok', text };
  } catch (error) {
    if (cacheName) {
      try { return { status: 'ok', text: readFileSync(new URL(cacheName, CACHE), 'utf8'), stale: true }; } catch {}
    }
    return { status: 'unavailable', detail: String((error && error.message) || error).slice(0, 120) };
  }
}

function parseTsv(text, headerMarker) {
  let header = null;
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      if (line.startsWith(headerMarker)) header = line.slice(1).trim().split('\t');
      continue;
    }
    if (!header) continue;
    const parts = line.split('\t');
    if (parts.length < header.length) continue;
    rows.push(Object.fromEntries(header.map((name, index) => [name, parts[index]])));
  }
  return rows;
}
const clean = value => (value === undefined ? '' : String(value).trim());

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function launchInstantFromLog(raw) {
  const match = /^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(\d{2})(\d{2}))?/.exec(clean(raw));
  if (!match || MONTHS.indexOf(match[2]) < 0) return null;
  return `${match[1]}-${String(MONTHS.indexOf(match[2]) + 1).padStart(2, '0')}-${match[3].padStart(2, '0')}` +
    `T${match[4] || '00'}:${match[5] || '00'}:00.000Z`;
}

const sources = { unavailable: [] };
const launchlog = await fetchText(`${GCAT}derived/launchlog.tsv`, 'launchlog.tsv');
if (launchlog.status !== 'ok') sources.unavailable.push(`launch log (${launchlog.detail})`);
else sources.launchlog = parseTsv(launchlog.text, '#Launch_Tag');
const satcat = await fetchText(`${GCAT}cat/satcat.tsv`, 'satcat.tsv');
if (satcat.status !== 'ok') sources.unavailable.push(`satellite catalogue (${satcat.detail})`);
else sources.satcat = parseTsv(satcat.text, '#JCAT');
const points = await fetchText(`${GCAT}tables/lp.tsv`, 'lp.tsv');
if (points.status !== 'ok') sources.unavailable.push(`launch points (${points.detail})`);
else sources.points = parseTsv(points.text, '#Site');
for (const note of sources.unavailable) {
  checks.push({ scope: 'sources', name: 'external source reachable', status: 'unavailable', detail: note });
}

/* ---- 4. each published profile against the live sources ------------------ */

for (const profile of artifact.profiles) {
  const live = {};
  const tag = profile.orbit && profile.orbit.piece ? String(profile.orbit.piece).replace(/[A-Z]+$/, '') : null;

  if (!sources.launchlog) {
    live.launchInstant = { available: false, detail: 'the launch log could not be read' };
  } else {
    const row = tag ? sources.launchlog.find(entry => clean(entry.Launch_Tag) === tag) : null;
    live.launchInstant = { available: true, utc: row ? launchInstantFromLog(row.Launch_Date) : null };
  }

  if (!sources.satcat) {
    live.orbit = { available: false, detail: 'the satellite catalogue could not be read' };
  } else {
    const row = profile.orbit && profile.orbit.piece
      ? sources.satcat.find(entry => clean(entry.Piece) === profile.orbit.piece) : null;
    live.orbit = row
      ? { available: true, found: true, perigeeKm: Number.parseFloat(clean(row.Perigee)),
          apogeeKm: Number.parseFloat(clean(row.Apogee)), inclinationDeg: Number.parseFloat(clean(row.Inc)) }
      : { available: true, found: false };
  }

  if (!sources.points) {
    live.pad = { looked: false, detail: 'the launch point catalogue could not be read' };
  } else {
    const row = sources.points.find(entry => clean(entry.Name) === profile.site.pad);
    live.pad = row
      ? { looked: true, found: true, latDeg: Number.parseFloat(clean(row.Latitude)),
          lonDeg: Number.parseFloat(clean(row.Longitude)) }
      : { looked: true, found: false };
  }

  const series = await fetchText(profile.evidence.sourceUrl, null);
  if (series.status !== 'ok') {
    live.series = { available: false, detail: series.detail };
  } else {
    try {
      const raw = JSON.parse(series.text);
      const named = Array.isArray(raw) ? Object.fromEntries(raw.map(entry => [entry[0], entry[1]])) : raw;
      const last = named.time.length - 1;
      live.series = { available: true, terminal: { altitudeM: Math.round(named.altitude[last] * 1000),
        velocityMps: Math.round(named.velocity[last] * 1000) / 1000 } };
    } catch (error) {
      live.series = { available: false, detail: `the response was not readable (${String(error.message).slice(0, 60)})` };
    }
  }

  checks.push(...AUDIT.auditAnchor(profile, live).checks);
}


/* ---- 5. report ----------------------------------------------------------- */

const { verdict, counts, failures, reviews, unavailable } = AUDIT.summarize(checks);
const drift = AUDIT.candidateReviewEntries(checks, RETRIEVED_TODAY);
const candidate = AUDIT.reviewRecordFor(drift, RETRIEVED_TODAY);

const report = {
  schema: AUDIT.AUDIT_SCHEMA,
  ran_utc: new Date().toISOString(), offline: OFFLINE, verdict, counts,
  artifact_digest: artifactDigest, profiles: artifact.profiles.map(profile => profile.id),
  checks, drift, candidate_review_record: candidate,
};

const icon = status => ({ pass: 'PASS', fail: 'FAIL', unavailable: 'UNAVAILABLE', 'review-required': 'REVIEW' })[status] || status;
const lines = [];
lines.push('# Trajectory evidence audit', '');
lines.push(`Verdict: **${verdict}** — ${counts.pass} passed, ${counts['review-required']} need review, ` +
  `${counts.unavailable} unavailable, ${counts.fail} failed.`);
lines.push('');
lines.push(`Artifact \`${artifactDigest.slice(0, 12)}…\` with ${artifact.profiles.length} published and ` +
  `${artifact.rejected.length} rejected candidates${OFFLINE ? '; external sources were read from the local cache (--offline)' : ''}.`);
lines.push('');
if (reviews.length) {
  lines.push('## Needs a human', '');
  lines.push('A source that answers with a materially different record is a review item, never an automatic');
  lines.push('demotion: the profile stays published exactly as verified until someone commits a review entry.');
  lines.push('');
  lines.push('| profile | check | what changed |');
  lines.push('| --- | --- | --- |');
  for (const entry of reviews) lines.push(`| \`${entry.scope}\` | ${entry.name} | ${entry.detail} |`);
  lines.push('');
  if (candidate) {
    lines.push('Candidate entries for the reviews you decide are justified. Commit them to');
    lines.push('`data/launches/trajectory-review.json` yourself: the audit never writes that file, and a review');
    lines.push('can only withhold output, never restore or promote it.');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(candidate, null, 1));
    lines.push('```');
    lines.push('');
  }
}
if (unavailable.length) {
  lines.push('## Unavailable', '');
  lines.push('Nothing here is a contradiction: a source that did not answer can never demote a profile.');
  lines.push('');
  for (const entry of unavailable) lines.push(`- \`${entry.scope}\`: ${entry.name} — ${entry.detail}`);
  lines.push('');
}
if (failures.length) {
  lines.push('## Integrity failures', '');
  for (const entry of failures) lines.push(`- \`${entry.scope}\`: ${entry.name} — ${entry.detail}`);
  lines.push('');
}
lines.push('## All checks', '');
lines.push('| profile | check | status | detail |');
lines.push('| --- | --- | --- | --- |');
for (const entry of checks) lines.push(`| \`${entry.scope}\` | ${entry.name} | ${icon(entry.status)} | ${entry.detail} |`);
lines.push('');
const summary = lines.join('\n');

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  try { writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n', { flag: 'a' }); } catch (error) {
    console.error('could not write the step summary:', error.message);
  }
}
if (JSON_PATH) {
  writeFileSync(JSON_PATH, JSON.stringify(report, null, 1) + '\n');
  console.log(`wrote ${JSON_PATH}`);
}
if (EMIT_REVIEW) {
  // Deliberately outside the repository's data directory: a candidate is a proposal for a human, not a
  // publication, and this script has no code path that writes the review record itself.
  if (!candidate) {
    console.log('no review entries are warranted; nothing emitted');
  } else {
    mkdirSync(EMIT_REVIEW, { recursive: true });
    const target = `${EMIT_REVIEW.replace(/\/$/, '')}/trajectory-review-candidate.json`;
    writeFileSync(target, JSON.stringify(candidate, null, 1) + '\n');
    console.log(`wrote the candidate review record to ${target} for human review`);
  }
}

if (failures.length) {
  for (const entry of failures) console.error(`::error title=Trajectory evidence integrity::${entry.scope}: ${entry.name} - ${entry.detail}`);
  process.exitCode = 1;
} else if (reviews.length) {
  for (const entry of reviews) console.error(`::warning title=Trajectory evidence review::${entry.scope}: ${entry.name} - ${entry.detail}`);
  process.exitCode = 1;
} else {
  console.log(`Audit clean: ${counts.pass} checks passed, ${counts.unavailable} unavailable.`);
}

