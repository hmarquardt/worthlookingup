/* Worth Looking Up launch schedule engine.
 *
 * One normalized public feed, one upstream provider. This module is the launch boundary described in
 * src/launches/readme.md: it owns provider access, schedule normalization, scheduling precision,
 * status interpretation, duplicate handling, feed validation and the cache/stale policy that the
 * Cloudflare endpoint and the scheduled refresh job both use.
 *
 * It is a plain ES module on purpose: the Pages Worker (dist/_worker.js), the Node refresh script and
 * the Node regression tests all import this exact file, so there is no second implementation of the
 * schedule rules.
 *
 * Honesty rules encoded here (never relaxed to make a test or a UI nicer):
 *   - A launch is never given a precise time that the provider did not publish. LL2 uses the END of
 *     the announced period for coarse precision (a "Year" record carries 31 December), so coarse
 *     NETs are marked approximate and are never treated as a launch date.
 *   - An unknown status stays unknown. It is never promoted to "scheduled".
 *   - No visibility, brightness, trajectory, bearing or probability is produced here. Those need
 *     flight geometry the provider does not publish; see src/launches/launch-visibility.md.
 */

export const FEED_SCHEMA = 'worthlookingup.launches/1';
export const REFRESH_INTERVAL_MINUTES = 30;
export const STALE_AFTER_MINUTES = 180;
export const MAX_LAUNCHES = 800;

export const PROVIDER = Object.freeze({
  name: 'Launch Library 2',
  publisher: 'The Space Devs',
  api_version: '2.3.0',
  base: 'https://ll.thespacedevs.com/2.3.0',
  documentation: 'https://thespacedevs.com/llapi',
  attribution: 'Launch data: The Space Devs Launch Library 2',
  rights: 'Free unauthenticated access is limited to 15 requests per hour. Free access does not by itself grant commercial redistribution; review the provider terms before monetization.',
  rate_limit: Object.freeze({ unauthenticated_requests_per_hour: 15, max_pages_per_refresh: 3 }),
  user_agent: 'worthlookingup-launch-feed/1.0 (+https://worthlookingup.com/)',
  api_versions: Object.freeze(['2.3.0']),
  retired_api_versions: Object.freeze(['2.2.0'])
});

/* Scheduling precision. LL2 publishes a name and a description for each precision level; only the
   first three describe a time that can be counted down to. `exact` means "the provider published a
   time"; `dated` means "the provider published a specific day"; anything else is a period. */
const PRECISION_BY_NAME = Object.freeze({
  Second: { kind: 'second', exact: true, dated: true, countdown: true },
  Minute: { kind: 'minute', exact: true, dated: true, countdown: true },
  Hour: { kind: 'hour', exact: true, dated: true, countdown: true },
  Day: { kind: 'day', exact: false, dated: true, countdown: false },
  Month: { kind: 'month', exact: false, dated: false, countdown: false },
  'Quarter 1': { kind: 'quarter', exact: false, dated: false, countdown: false, quarter: 1 },
  'Quarter 2': { kind: 'quarter', exact: false, dated: false, countdown: false, quarter: 2 },
  'Quarter 3': { kind: 'quarter', exact: false, dated: false, countdown: false, quarter: 3 },
  'Quarter 4': { kind: 'quarter', exact: false, dated: false, countdown: false, quarter: 4 },
  'Year Half 1': { kind: 'half', exact: false, dated: false, countdown: false, half: 1 },
  'Year Half 2': { kind: 'half', exact: false, dated: false, countdown: false, half: 2 },
  Year: { kind: 'year', exact: false, dated: false, countdown: false }
});
const PRECISION_UNKNOWN = Object.freeze({ kind: 'unknown', exact: false, dated: false, countdown: false });
export const PRECISION_KINDS = Object.freeze(['second', 'minute', 'hour', 'day', 'month', 'quarter', 'half', 'year', 'unknown']);

/* Status. `scheduled` is a provider claim (Go for Launch), `unconfirmed` keeps the provider's own
   TBD/TBC wording, `hold` is On Hold, `in-flight` is a flight the provider reports as underway, and
   success/failure are outcomes. Anything unrecognised is `unknown` and is never guessed. */
const STATUS_BY_NAME = Object.freeze({
  'Go for Launch': 'scheduled',
  'To Be Determined': 'unconfirmed',
  'To Be Confirmed': 'unconfirmed',
  'On Hold': 'hold',
  'In Flight': 'in-flight',
  'Launch Successful': 'success',
  'Launch Failure': 'failure'
});
const STATUS_BY_ABBREV = Object.freeze({ Go: 'scheduled', TBD: 'unconfirmed', TBC: 'unconfirmed', Hold: 'hold', Success: 'success', Failure: 'failure' });
export const STATUS_KINDS = Object.freeze(['scheduled', 'unconfirmed', 'hold', 'in-flight', 'success', 'failure', 'unknown']);
export const ACTIVE_STATUS_KINDS = Object.freeze(['scheduled', 'unconfirmed', 'hold', 'in-flight']);
export const COMPLETED_STATUS_KINDS = Object.freeze(['success', 'failure']);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isoOrNull(value) {
  if (typeof value !== 'string' || !ISO.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function text(value, max = 400) {
  if (typeof value !== 'string') return null;
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '\u2026' : flat;
}
function finite(value) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}
function dedupeBy(list, key) {
  const seen = new Set();
  return list.filter(entry => {
    const value = key(entry);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
async function sha256Hex(value) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

export function precisionFor(raw) {
  const name = typeof raw === 'string' ? raw : raw && typeof raw.name === 'string' ? raw.name : null;
  const known = name && PRECISION_BY_NAME[name];
  const id = raw && typeof raw === 'object' && Number.isFinite(raw.id) ? raw.id : null;
  if (!known) return { ...PRECISION_UNKNOWN, id, name: name || null };
  return { ...known, id, name };
}
export function statusFor(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const name = typeof source.name === 'string' ? source.name : null;
  const abbrev = typeof source.abbrev === 'string' ? source.abbrev : null;
  const kind = STATUS_BY_NAME[name] || (abbrev && STATUS_BY_ABBREV[abbrev]) || 'unknown';
  return {
    id: Number.isFinite(source.id) ? source.id : null,
    name: name || null,
    abbrev: abbrev || null,
    description: text(source.description, 200),
    kind
  };
}

function collectLinks(raw, key, camelKey, kind) {
  const list = Array.isArray(raw[key]) ? raw[key] : Array.isArray(raw[camelKey]) ? raw[camelKey] : [];
  return dedupeBy(list
    .filter(entry => entry && typeof entry.url === 'string' && /^https:\/\/\S+$/.test(entry.url))
    .map(entry => ({
      kind,
      source: text(entry.source, 60),
      title: text(entry.title, 120),
      type: text(entry.type && entry.type.name, 60),
      official: !!(entry.type && typeof entry.type.name === 'string' && entry.type.name.startsWith('Official')),
      priority: finite(entry.priority) ?? 0,
      url: entry.url
    }))
    .sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url)), entry => entry.url).slice(0, 3);
}

/* Is this record already in our normalized shape? Keeps normalizeLaunch idempotent, which is what
   lets the Cloudflare endpoint merge an upstream refresh into a previously published feed. */
export function isNormalized(record) {
  return !!(record && typeof record === 'object' && record.precision && record.precision.kind && record.status && record.status.kind && typeof record.id === 'string');
}

export function normalizeLaunch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (isNormalized(raw)) return JSON.parse(JSON.stringify(raw));
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
  if (!id) return null;
  const pad = raw.pad && typeof raw.pad === 'object' ? raw.pad : null;
  const location = pad && pad.location && typeof pad.location === 'object' ? pad.location : null;
  const provider = raw.launch_service_provider && typeof raw.launch_service_provider === 'object' ? raw.launch_service_provider : null;
  const configuration = raw.rocket && raw.rocket.configuration && typeof raw.rocket.configuration === 'object' ? raw.rocket.configuration : null;
  const mission = raw.mission && typeof raw.mission === 'object' ? raw.mission : null;
  const families = configuration && Array.isArray(configuration.families) ? configuration.families : [];
  const country = pad && pad.country && typeof pad.country === 'object' ? pad.country : null;
  return {
    id,
    slug: text(raw.slug, 120),
    name: text(raw.name, 200) || 'Unnamed launch',
    mission: text(mission && mission.name, 120),
    mission_type: text(mission && mission.type, 80),
    mission_description: text(mission && mission.description, 400),
    orbit: text(mission && mission.orbit && mission.orbit.name, 80),
    vehicle: text(configuration && (configuration.full_name || configuration.name), 120),
    vehicle_family: text(families[0] && families[0].name, 80),
    provider: text(provider && provider.name, 120),
    provider_abbrev: text(provider && provider.abbrev, 20),
    site: {
      name: text((location && location.name) || (pad && pad.name), 160),
      timezone: text(location && location.timezone_name, 80),
      country: text(country && country.name, 80)
    },
    pad: {
      name: text(pad && pad.name, 160),
      latitude: pad ? finite(pad.latitude) : null,
      longitude: pad ? finite(pad.longitude) : null
    },
    status: statusFor(raw.status),
    net: isoOrNull(raw.net),
    precision: precisionFor(raw.net_precision ?? raw.netPrecision),
    window: { start: isoOrNull(raw.window_start ?? raw.windowStart), end: isoOrNull(raw.window_end ?? raw.windowEnd) },
    last_updated: isoOrNull(raw.last_updated ?? raw.lastUpdated),
    // A provider-recorded launch probability is not a local visibility probability and is not used.
    links: {
      ll2: typeof raw.url === 'string' && /^https:\/\//.test(raw.url) ? raw.url : null,
      info: collectLinks(raw, 'info_urls', 'infoURLs', 'info'),
      webcast: collectLinks(raw, 'vid_urls', 'vidURLs', 'webcast')
    },
    change: null
  };
}



/* Duplicate schedule records: LL2 can expose the same flight twice (for example through overlapping
   queries). Identity is the provider id; a second pass drops records that describe the same flight
   through a different id, keeping the most recently updated record. */
export function dedupeLaunches(records) {
  const byId = new Map();
  for (const record of records) {
    if (!record || !record.id) continue;
    const existing = byId.get(record.id);
    const stamp = Date.parse(record.last_updated || 0) || 0;
    if (!existing || stamp >= (Date.parse(existing.last_updated || 0) || 0)) byId.set(record.id, record);
  }
  const byFlight = new Map();
  const removed = [];
  const ordered = [...byId.values()].sort((a, b) => (Date.parse(b.last_updated || 0) || 0) - (Date.parse(a.last_updated || 0) || 0) || a.id.localeCompare(b.id));
  for (const record of ordered) {
    const flight = [record.provider || '', record.mission || record.name || '', record.net || '', (record.pad && record.pad.name) || ''].join('|').toLowerCase();
    if (byFlight.has(flight)) { removed.push(record.id); continue; }
    byFlight.set(flight, record);
  }
  return { records: [...byFlight.values()], removed };
}

export function scheduleChange(record, previous, now) {
  if (!previous) return null;
  const previousNet = previous.net || null;
  const previousStatus = (previous.status && previous.status.name) || null;
  const detected = new Date(now).toISOString();
  if (previousNet && record.net && previousNet !== record.net) {
    const delta = Date.parse(record.net) - Date.parse(previousNet);
    return {
      kind: delta > 0 ? 'postponed' : 'advanced',
      previous_net: previousNet,
      previous_status: previousStatus,
      delta_minutes: Number.isFinite(delta) ? Math.round(delta / 60000) : null,
      detected_at: detected
    };
  }
  if (previousStatus && record.status && record.status.name && previousStatus !== record.status.name) {
    return { kind: 'status', previous_status: previousStatus, previous_net: previousNet, delta_minutes: null, detected_at: detected };
  }
  return null;
}

export function feedStats(launches) {
  const byKind = {};
  const byPrecision = {};
  for (const record of launches) {
    byKind[record.status.kind] = (byKind[record.status.kind] || 0) + 1;
    byPrecision[record.precision.kind] = (byPrecision[record.precision.kind] || 0) + 1;
  }
  const dated = launches.filter(record => record.precision.dated).length;
  return {
    count: launches.length,
    by_status: byKind,
    by_precision: byPrecision,
    with_published_time: launches.filter(record => record.precision.exact).length,
    with_published_date: dated,
    period_only: launches.length - dated,
    sites: new Set(launches.map(record => record.site.name).filter(Boolean)).size,
    providers: new Set(launches.map(record => record.provider).filter(Boolean)).size,
    nearest_net: launches.length ? launches.map(record => record.net).filter(Boolean).sort()[0] : null
  };
}

/* Build the published feed. `records` are upstream records (or already-normalized ones); `previous`
   is the last published feed, used only to describe schedule changes, never to invent a time. */
export function buildFeed({ records = [], previous = null, now = Date.now(), upstream = {}, windowDays = 180, strict = true } = {}) {
  const normalized = records.map(normalizeLaunch).filter(Boolean);
  const { records: unique, removed } = dedupeLaunches(normalized);
  const previousById = new Map((previous && Array.isArray(previous.launches) ? previous.launches : []).map(record => [record.id, record]));
  const launches = unique
    .map(record => ({ ...record, change: scheduleChange(record, previousById.get(record.id), now) }))
    .sort((a, b) => String(a.net || '9999').localeCompare(String(b.net || '9999')) || a.id.localeCompare(b.id));
  const feed = {
    schema: FEED_SCHEMA,
    available: true,
    generated_at: new Date(now).toISOString(),
    refresh_interval_minutes: REFRESH_INTERVAL_MINUTES,
    stale_after_minutes: STALE_AFTER_MINUTES,
    stale: false,
    stale_reason: null,
    source: {
      name: PROVIDER.name,
      publisher: PROVIDER.publisher,
      api_version: PROVIDER.api_version,
      endpoint: upstream.endpoint || null,
      documentation: PROVIDER.documentation,
      attribution: PROVIDER.attribution,
      rights: PROVIDER.rights,
      rate_limit: PROVIDER.rate_limit,
      retrieved_at: upstream.retrieved_at || null,
      sha256: upstream.sha256 || null,
      pages: upstream.pages ?? null,
      upstream_count: upstream.count ?? null,
      upstream_records: upstream.records ?? normalized.length,
      announced_total: upstream.announced_total ?? null,
      duplicates_removed: removed.length
    },
    stats: { ...feedStats(launches), window_days: windowDays, announced_total: upstream.announced_total ?? null },
    launches
  };
  if (strict) assertValidFeed(feed);
  return feed;
}

export function validateFeed(feed) {
  const errors = [];
  const warnings = [];
  if (!feed || typeof feed !== 'object') return { ok: false, errors: ['feed is not an object'], warnings };
  if (feed.schema !== FEED_SCHEMA) errors.push('unexpected schema ' + String(feed.schema));
  if (feed.available === false) return { ok: !errors.length, errors, warnings };
  if (!Number.isFinite(Date.parse(feed.generated_at))) errors.push('generated_at is not a timestamp');
  if (!Array.isArray(feed.launches)) { errors.push('launches is not an array'); return { ok: false, errors, warnings }; }
  if (feed.launches.length > MAX_LAUNCHES) errors.push('more than ' + MAX_LAUNCHES + ' launches in one feed');
  if (!feed.source || feed.source.name !== PROVIDER.name) errors.push('source metadata is missing');
  const ids = new Set();
  feed.launches.forEach((record, index) => {
    const at = 'launches[' + index + ']';
    if (!record || typeof record !== 'object') { errors.push(at + ' is not an object'); return; }
    if (typeof record.id !== 'string' || !record.id) errors.push(at + ' has no stable id');
    else if (ids.has(record.id)) errors.push(at + ' repeats id ' + record.id);
    else ids.add(record.id);
    if (typeof record.name !== 'string' || !record.name) errors.push(at + ' has no mission name');
    if (!record.precision || !PRECISION_KINDS.includes(record.precision.kind)) errors.push(at + ' has an unknown precision');
    if (!record.status || !STATUS_KINDS.includes(record.status.kind)) errors.push(at + ' has an unknown status');
    // A published time without a published precision would be a fabricated precision.
    if (record.precision && record.precision.exact && !record.net) errors.push(at + ' claims a published time without a timestamp');
    if (record.net && !isoOrNull(record.net)) errors.push(at + ' has a malformed timestamp');
    if (record.change && record.change.previous_net && !isoOrNull(record.change.previous_net)) errors.push(at + ' has a malformed previous timestamp');
    for (const link of [...((record.links && record.links.info) || []), ...((record.links && record.links.webcast) || [])]) {
      if (!link || typeof link.url !== 'string' || !/^https:\/\//.test(link.url)) errors.push(at + ' has a non-HTTPS link');
    }
    if (!record.pad || record.pad.latitude === null || record.pad.longitude === null) warnings.push(at + ' has no pad coordinates; proximity cannot be estimated');
    if (record.precision && record.precision.dated && !record.precision.exact) warnings.push(at + ' publishes a date but no time');
  });
  const stats = feedStats(feed.launches);
  if (!feed.stats || feed.stats.count !== stats.count) warnings.push('feed stats do not match the launch list');
  return { ok: !errors.length, errors, warnings };
}

export function assertValidFeed(feed) {
  const result = validateFeed(feed);
  if (!result.ok) throw new Error('launch feed failed validation: ' + result.errors.slice(0, 5).join('; '));
  return result;
}

export function feedAgeMinutes(feed, now = Date.now()) {
  const generated = feed && Number.isFinite(Date.parse(feed.generated_at)) ? Date.parse(feed.generated_at) : null;
  if (generated === null) return null;
  return Math.max(0, (now - generated) / 60000);
}

export function isStale(feed, now = Date.now()) {
  const age = feedAgeMinutes(feed, now);
  if (age === null) return true;
  const limit = Number.isFinite(feed.stale_after_minutes) ? feed.stale_after_minutes : STALE_AFTER_MINUTES;
  return age > limit;
}

export function upstreamWindow(now, windowDays) {
  return { start: new Date(now - 36 * 3600000).toISOString(), end: new Date(now + windowDays * 86400000).toISOString() };
}


export function unavailableFeed({ now = Date.now(), reason = 'no launch schedule is available' } = {}) {
  return {
    schema: FEED_SCHEMA,
    available: false,
    generated_at: null,
    refresh_interval_minutes: REFRESH_INTERVAL_MINUTES,
    stale_after_minutes: STALE_AFTER_MINUTES,
    stale: true,
    stale_reason: reason,
    source: {
      name: PROVIDER.name,
      publisher: PROVIDER.publisher,
      api_version: PROVIDER.api_version,
      endpoint: null,
      documentation: PROVIDER.documentation,
      attribution: PROVIDER.attribution,
      rights: PROVIDER.rights,
      rate_limit: PROVIDER.rate_limit,
      retrieved_at: null,
      sha256: null,
      pages: null,
      upstream_count: null,
      upstream_records: 0,
      announced_total: null,
      duplicates_removed: 0
    },
    notice: 'The launch schedule could not be loaded, so no launch is listed. This is a missing feed, not an empty schedule.',
    stats: { count: 0, by_status: {}, by_precision: {}, with_published_time: 0, with_published_date: 0, period_only: 0, sites: 0, providers: 0, nearest_net: null },
    launches: [],
    requested_at: new Date(now).toISOString()
  };
}

/* Bounded upstream read. One page is 100 records (LL2 caps `limit`), pages are sequential and the
   caller decides the cap, so a single refresh can never exhaust the hourly allowance. A failed read
   throws a coded error so the caller can describe the failure honestly instead of guessing. */
export async function fetchUpstreamLaunches({ fetchImpl = globalThis.fetch, now = Date.now(), windowDays = 180, maxPages = 3, limit = 100, timeoutMs = 30000, includeAnnouncedTotal = true } = {}) {
  const window = upstreamWindow(now, windowDays);
  const params = new URLSearchParams({ limit: String(limit), mode: 'normal', ordering: 'net', net__gte: window.start, net__lte: window.end });
  let url = PROVIDER.base + '/launches/?' + params.toString();
  const records = [];
  const payloads = [];
  const retrievedAt = new Date(now).toISOString();
  let pages = 0;
  let count = null;
  while (url && pages < maxPages) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': PROVIDER.user_agent },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
      });
    } catch (error) {
      const failure = new Error('upstream request failed: ' + String((error && error.message) || error));
      failure.code = 'upstream-unreachable';
      throw failure;
    }
    if (!response.ok) {
      const failure = new Error('upstream HTTP ' + response.status);
      failure.code = response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'upstream-error' : 'upstream-rejected';
      failure.status = response.status;
      throw failure;
    }
    let body;
    try { body = await response.json(); } catch (error) { body = null; }
    if (!body || !Array.isArray(body.results)) {
      const failure = new Error('upstream payload is not a launch page');
      failure.code = 'upstream-malformed';
      throw failure;
    }
    payloads.push(JSON.stringify(body.results));
    records.push(...body.results);
    if (count === null && Number.isFinite(body.count)) count = body.count;
    pages += 1;
    url = typeof body.next === 'string' && body.next ? body.next : null;
  }
  // How many launches are announced in total, including the ones whose window is not published yet.
  // One tiny request; its failure is not fatal and is reported as null rather than guessed.
  let announcedTotal = null;
  if (includeAnnouncedTotal) {
    try {
      const response = await fetchImpl(PROVIDER.base + '/launches/upcoming/?limit=1&mode=list', {
        headers: { Accept: 'application/json', 'User-Agent': PROVIDER.user_agent },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
      });
      if (response.ok) {
        const body = await response.json();
        if (body && Number.isFinite(body.count)) announcedTotal = body.count;
      }
    } catch { announcedTotal = null; }
  }
  return {
    records,
    source: {
      endpoint: PROVIDER.base + '/launches/',
      retrieved_at: retrievedAt,
      sha256: await sha256Hex(payloads.join('\n')),
      pages,
      count,
      records: records.length,
      announced_total: announcedTotal
    }
  };
}

/* Merge a fresh upstream read into the last published feed. Upstream wins per id; a previously
   published flight is kept only while it is still plausible (not completed, not long past), so a
   bounded refresh can never silently delete the far-future part of the calendar. */
export function mergeFeeds(primary, previous, { now = Date.now() } = {}) {
  const chosen = new Map();
  for (const record of primary || []) if (record && record.id) chosen.set(record.id, { record, fresh: true });
  for (const record of (previous && previous.launches) || []) {
    if (!record || !record.id || chosen.has(record.id)) continue;
    if (COMPLETED_STATUS_KINDS.includes(record.status && record.status.kind)) continue;
    const net = Number.isFinite(Date.parse(record.net)) ? Date.parse(record.net) : null;
    if (net !== null && net < now - 36 * 3600000) continue;
    chosen.set(record.id, { record, fresh: false });
  }
  const records = [...chosen.values()].map(entry => entry.record)
    .sort((a, b) => String(a.net || '9999').localeCompare(String(b.net || '9999')) || a.id.localeCompare(b.id));
  return { records, kept: records.filter(record => !chosen.get(record.id).fresh).length, fresh: records.filter(record => chosen.get(record.id).fresh).length };
}

export function staleReason(error) {
  const code = error && error.code;
  if (code === 'rate-limited') return 'the provider rate limit was reached, so the last good schedule is being served';
  if (code === 'upstream-error') return 'the provider returned a server error, so the last good schedule is being served';
  if (code === 'upstream-unreachable') return 'the provider could not be reached, so the last good schedule is being served';
  if (code === 'upstream-malformed') return 'the provider returned an unusable response, so the last good schedule is being served';
  if (code === 'upstream-empty') return 'the provider returned no launch records, so the last good schedule is being served';
  if (code === 'upstream-rejected') return 'the provider rejected the request, so the last good schedule is being served';
  return 'the launch schedule could not be refreshed, so the last good schedule is being served';
}


function newestFeed(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!candidate || !candidate.available) continue;
    if (!validateFeed(candidate).ok) continue;
    if (!best || (Date.parse(candidate.generated_at) || 0) > (Date.parse(best.generated_at) || 0)) best = candidate;
  }
  return best;
}

/* Cloudflare ingestion + caching for GET /api/launches.json.
   Visitors never call the provider: the edge cache is shared, the optional KV namespace carries the
   last good schedule between colos, and the committed feed is the durable seed. A refresh is only
   attempted when the freshest available copy is older than the refresh interval, and every upstream
   failure degrades to the last good copy with an explicit stale flag. */
export async function handleLaunchFeedRequest(request, env = {}, options = {}) {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxAge = options.maxAgeSeconds ?? 900;
  const minRefreshMinutes = options.minRefreshMinutes ?? REFRESH_INTERVAL_MINUTES;
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD' } });
  }
  const cache = options.cache ?? (typeof caches !== 'undefined' && caches.default ? caches.default : null);
  const cacheKey = new Request(new URL('/api/launches.json', url.origin).toString(), { method: 'GET' });
  let edge = null;
  if (cache) { try { const hit = await cache.match(cacheKey); if (hit) edge = await hit.json(); } catch { edge = null; } }
  const stored = await readStoredFeed(env);
  const seeded = await readSeededFeed(env, url);
  const best = newestFeed([edge, stored, seeded]);
  const servedFrom = best === edge && edge ? 'edge-cache' : best === stored && stored ? 'kv' : best === seeded && seeded ? 'committed-feed' : 'none';
  const age = best ? feedAgeMinutes(best, now) : null;
  if (!best || age === null || age >= minRefreshMinutes) {
    try {
      const upstream = await fetchUpstreamLaunches({ fetchImpl, now, maxPages: options.maxPages ?? 2, timeoutMs: options.timeoutMs ?? 20000 });
      // An empty upstream page is a provider failure, not a schedule without launches.
      if (!upstream.records.length) {
        const failure = new Error('upstream returned no launch records');
        failure.code = 'upstream-empty';
        throw failure;
      }
      const merged = mergeFeeds(upstream.records, best, { now });
      const feed = buildFeed({ records: merged.records, previous: best, now, upstream: upstream.source });
      await writeStoredFeed(env, feed);
      await putEdge(cache, cacheKey, feed, maxAge);
      return feedResponse(feed, { served: 'upstream', from: servedFrom, now, maxAge });
    } catch (error) {
      const reason = staleReason(error);
      if (best) {
        const stale = { ...best, stale: true, stale_reason: reason };
        await putEdge(cache, cacheKey, stale, 120);
        return feedResponse(stale, { served: 'last-good', from: servedFrom, now, maxAge: 120 });
      }
      const empty = unavailableFeed({ now, reason });
      await putEdge(cache, cacheKey, empty, 60);
      return feedResponse(empty, { served: 'unavailable', from: 'none', now, maxAge: 60 });
    }
  }
  const old = isStale(best, now);
  const fresh = { ...best, stale: old, stale_reason: old ? 'the published schedule is older than the expected refresh interval' : null };
  await putEdge(cache, cacheKey, fresh, maxAge);
  return feedResponse(fresh, { served: 'cached', from: servedFrom, now, maxAge });
}

function feedResponse(feed, { served, from, now, maxAge }) {
  const age = feedAgeMinutes(feed, now);
  const body = { ...feed, served_by: served, served_from: from, served_at: new Date(now).toISOString() };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=' + maxAge,
      'X-WLU-Launch-Feed': served,
      'X-WLU-Launch-Feed-Age': age === null ? 'unknown' : String(Math.round(age))
    }
  });
}

async function putEdge(cache, key, feed, maxAge) {
  if (!cache || typeof cache.put !== 'function') return;
  try {
    await cache.put(key, new Response(JSON.stringify(feed), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + maxAge } }));
  } catch { /* the edge cache is an optimisation, never a requirement */ }
}

async function readStoredFeed(env) {
  const store = env && env.LAUNCHES;
  if (!store || typeof store.get !== 'function') return null;
  try {
    const value = await store.get('upcoming', { type: 'json' });
    return value && value.available !== false && value.schema === FEED_SCHEMA ? value : null;
  } catch { return null; }
}

async function writeStoredFeed(env, feed) {
  const store = env && env.LAUNCHES;
  if (!store || typeof store.put !== 'function') return;
  try { await store.put('upcoming', JSON.stringify({ ...feed, stored_at: new Date().toISOString() })); } catch { /* optional binding */ }
}

async function readSeededFeed(env, url) {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  try {
    const response = await env.ASSETS.fetch(new Request(new URL('/data/launches/upcoming.json', url.origin).toString(), { headers: { Accept: 'application/json' } }));
    if (!response.ok) return null;
    const value = await response.json();
    return value && value.schema === FEED_SCHEMA ? value : null;
  } catch { return null; }
}

