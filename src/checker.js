import * as cheerio from 'cheerio';
import { config } from './config.js';

const ASSET_SELECTOR = [
  'link[rel="stylesheet"][href]',
  'link[rel="preload"][as="style"][href]',
  'script[src]',
].join(',');

const SOFT_404_MARKERS = [
  'page not found',
  'page cannot be found',
  "page doesn't exist",
  'page does not exist',
  "couldn't find",
  'could not find the page',
  '404 not found',
  'error 404',
];

let lastRequestAt = 0;
let runCounter = 0;
const lastFunctionalBySite = new Map(); // site url -> last functional result snapshot

function absUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function isSkippableAsset(url) {
  if (!url) return true;
  if (url.startsWith('data:')) return true;
  if (url.startsWith('blob:')) return true;
  if (url.startsWith('javascript:')) return true;
  return false;
}

function includesAny(haystack, needles = []) {
  if (!needles.length) return true;
  const h = String(haystack || '').toLowerCase();
  return needles.some((n) => h.includes(String(n).toLowerCase()));
}

function extractTitle(html) {
  const $ = cheerio.load(html);
  return ($('title').first().text() || '').replace(/\s+/g, ' ').trim();
}

function looksLikeSoft404(status, title, html) {
  if (status === 404 || status === 410) return true;
  const blob = `${title}\n${html}`.toLowerCase();
  if (/(^|\s)404(\s|$)/.test(title.toLowerCase()) && /not found|page/.test(title.toLowerCase())) {
    return true;
  }
  return SOFT_404_MARKERS.some((m) => blob.includes(m));
}

function isRateLimitedStatus(status) {
  return status === 429 || status === 503;
}

function looksLikeChallenge(title, html) {
  const blob = `${title}\n${String(html || '').slice(0, 2000)}`.toLowerCase();
  return (
    blob.includes('just a moment') ||
    blob.includes('cf-browser-verification') ||
    blob.includes('attention required') ||
    blob.includes('checking your browser')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace() {
  const gap = Math.max(0, Number(config.minRequestGapMs || 0));
  if (!gap) return;
  const wait = lastRequestAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = config.requestTimeoutMs) {
  const retries = Math.max(0, Number(config.requestRetries || 0));
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': config.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-AU,en;q=0.9',
          ...(options.headers || {}),
        },
      });
      // Back off hard on edge rate limits / challenges; don't hammer
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after') || 0);
        const waitMs = Math.max(retryAfter * 1000, 2000 * (attempt + 1));
        await sleep(waitMs);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      if (config.assetDelayMs > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(config.assetDelayMs);
      }
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, items.length || 1) },
    () => run()
  );
  await Promise.all(runners);
  return results;
}

function extractAssets(pageUrl, html) {
  const $ = cheerio.load(html);
  const found = new Map();

  $(ASSET_SELECTOR).each((_, el) => {
    const tag = el.tagName?.toLowerCase?.() || el.name || '';
    const href = $(el).attr('href') || $(el).attr('src');
    const url = absUrl(pageUrl, href);
    if (isSkippableAsset(url)) return;
    const type = tag === 'script' || $(el).attr('as') === 'script' ? 'js' : 'css';
    if (!found.has(url)) found.set(url, type);
  });

  $('link[rel="modulepreload"][href], link[as="script"][href]').each((_, el) => {
    const url = absUrl(pageUrl, $(el).attr('href'));
    if (isSkippableAsset(url)) return;
    if (!found.has(url)) found.set(url, 'js');
  });

  return [...found.entries()].map(([url, type]) => ({ url, type }));
}

async function checkAsset(asset) {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(asset.url, {
      method: 'GET',
      headers: { accept: '*/*' },
    });
    const status = res.status;
    const ok = status >= 200 && status < 400;
    if (ok) {
      try {
        // Avoid downloading huge bodies; headers/status are enough for health
        res.body?.cancel?.();
      } catch {
        // ignore
      }
    } else {
      try {
        res.body?.cancel?.();
      } catch {
        // ignore
      }
    }
    return {
      ...asset,
      ok,
      status,
      ms: Date.now() - started,
      error: ok ? null : `HTTP ${status}`,
      rateLimited: isRateLimitedStatus(status),
    };
  } catch (err) {
    return {
      ...asset,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
      rateLimited: false,
    };
  }
}

async function scanAssets(pageUrl, html) {
  const assets = extractAssets(pageUrl, html);
  const checked = await mapPool(assets, config.assetConcurrency, checkAsset);
  const failed = checked.filter((a) => !a.ok);
  const rateLimited = failed.filter((a) => a.rateLimited);
  const hardFailed = failed.filter((a) => !a.rateLimited);
  const hardRatio = checked.length ? hardFailed.length / checked.length : 0;
  const ok =
    hardFailed.length === 0 || hardRatio <= config.maxAssetFailureRatio;
  const parts = [];
  if (hardFailed.length) {
    parts.push(
      `${hardFailed.length}/${checked.length} assets failing. ${hardFailed
        .slice(0, 3)
        .map((f) => `${f.type} ${f.status || 'ERR'} ${f.url}`)
        .join('; ')}`
    );
  }
  if (rateLimited.length) {
    parts.push(`${rateLimited.length} assets rate-limited`);
  }
  return {
    ok,
    total: checked.length,
    failed: failed.length,
    hardFailed: hardFailed.length,
    rateLimited: rateLimited.length,
    okCount: checked.length - failed.length,
    items: hardFailed
      .slice(0, 20)
      .concat(rateLimited.slice(0, 5))
      .concat(checked.filter((a) => a.ok).slice(0, 5)),
    error: parts.length ? parts.join(' | ') : null,
    degraded: ok && rateLimited.length > 0,
  };
}

async function checkPage({
  url,
  name = url,
  checkAssets = false,
  titleIncludes = [],
  bodyIncludes = [],
  timeoutMs = config.requestTimeoutMs,
}) {
  const started = Date.now();
  const result = {
    name,
    url,
    ok: false,
    status: 0,
    ms: 0,
    error: null,
    finalUrl: url,
    title: null,
    kind: checkAssets ? 'root' : 'functional',
    rateLimited: false,
    degraded: false,
    assets: {
      total: 0,
      failed: 0,
      ok: 0,
      items: [],
    },
  };

  try {
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } },
      timeoutMs
    );
    result.status = res.status;
    result.finalUrl = res.url || url;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const html = await res.text();
    result.title = extractTitle(html);
    result.ms = Date.now() - started;

    if (isRateLimitedStatus(res.status) || looksLikeChallenge(result.title || '', html)) {
      result.rateLimited = true;
      result.degraded = true;
      result.ok = config.rateLimitIsDegraded; // true => don't hard-fail
      result.error = `rate-limited/challenged HTTP ${res.status || 'challenge'}`;
      return result;
    }

    if (!(res.status >= 200 && res.status < 400)) {
      result.error = `HTTP ${res.status}`;
      return result;
    }

    const isHtml = contentType.includes('text/html') || html.trim().startsWith('<');
    if (!isHtml) {
      result.ok = true;
      return result;
    }

    if (looksLikeSoft404(res.status, result.title || '', html.slice(0, 4000))) {
      result.error = `soft-404 (${result.title || 'no title'})`;
      return result;
    }

    if (titleIncludes.length && !includesAny(result.title, titleIncludes)) {
      result.error = `title mismatch: got "${result.title || ''}" expected one of [${titleIncludes.join(', ')}]`;
      return result;
    }

    if (bodyIncludes.length && !includesAny(html.slice(0, 20000), bodyIncludes)) {
      result.error = `body missing expected markers: [${bodyIncludes.join(', ')}]`;
      return result;
    }

    if (checkAssets) {
      const assets = await scanAssets(result.finalUrl, html);
      result.assets = {
        total: assets.total,
        failed: assets.failed,
        ok: assets.okCount,
        items: assets.items,
        rateLimited: assets.rateLimited,
        hardFailed: assets.hardFailed,
      };
      result.ok = assets.ok;
      result.degraded = !!assets.degraded;
      result.error = assets.error;
      result.ms = Date.now() - started;
      return result;
    }

    result.ok = true;
    result.ms = Date.now() - started;
    return result;
  } catch (err) {
    result.ms = Date.now() - started;
    result.error = err.name === 'AbortError' ? 'timeout' : err.message;
    result.ok = false;
    return result;
  }
}

function functionalUrl(siteUrl, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`).toString();
}

function emptyFunctional(reason) {
  return {
    total: 0,
    failed: 0,
    ok: 0,
    skipped: true,
    skipReason: reason,
    items: [],
  };
}

export async function checkSite(site, { runFunctional = true } = {}) {
  const started = Date.now();
  const root = await checkPage({
    url: site.url,
    name: site.name || site.url,
    checkAssets: site.checkAssets !== false,
    timeoutMs: config.requestTimeoutMs,
  });

  let functional = [];
  let functionalMeta = null;

  // If root itself is rate-limited, skip functional this cycle to avoid making it worse
  if (root.rateLimited) {
    functionalMeta = emptyFunctional('skipped because root was rate-limited');
    const cached = lastFunctionalBySite.get(site.url);
    if (cached) functionalMeta.cached = true;
  } else if (!runFunctional || !(site.functional || []).length) {
    if (!(site.functional || []).length) {
      functionalMeta = emptyFunctional('no functional checks configured');
    } else {
      const cached = lastFunctionalBySite.get(site.url);
      functionalMeta = cached
        ? {
            ...cached,
            skipped: true,
            skipReason: `scheduled every ${config.functionalEveryN} runs`,
            cached: true,
          }
        : emptyFunctional(`scheduled every ${config.functionalEveryN} runs`);
      if (cached?.items) functional = cached.items;
    }
  } else {
    const functionalDefs = site.functional || [];
    for (let i = 0; i < functionalDefs.length; i++) {
      const def = functionalDefs[i];
      if (i > 0 && config.functionalDelayMs > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(config.functionalDelayMs);
      }
      // eslint-disable-next-line no-await-in-loop
      const page = await checkPage({
        url: functionalUrl(site.url, def.path),
        name: def.name || def.path,
        checkAssets: config.functionalCheckAssets,
        titleIncludes: def.titleIncludes || [],
        bodyIncludes: def.bodyIncludes || [],
        timeoutMs: config.functionalTimeoutMs,
      });
      functional.push(page);
      // If we start getting rate limited mid-suite, stop early
      if (page.rateLimited) {
        break;
      }
    }
    const failed = functional.filter((p) => !p.ok);
    functionalMeta = {
      total: functional.length,
      failed: failed.length,
      ok: functional.length - failed.length,
      skipped: false,
      items: functional,
    };
    lastFunctionalBySite.set(site.url, {
      total: functionalMeta.total,
      failed: functionalMeta.failed,
      ok: functionalMeta.ok,
      items: functional,
      at: new Date().toISOString(),
    });
  }

  const items = functionalMeta.items || functional;
  const failedFunctional = items.filter((p) => !p.ok);
  const hardFunctionalFails = failedFunctional.filter((p) => !p.rateLimited);
  const rateLimitedFunctional = failedFunctional.filter((p) => p.rateLimited);

  const rootHardFail = !root.ok && !root.rateLimited;
  const ok = !rootHardFail && hardFunctionalFails.length === 0;
  const degraded =
    !!root.rateLimited ||
    !!root.degraded ||
    rateLimitedFunctional.length > 0 ||
    (!!functionalMeta.skipped && !!functionalMeta.skipReason?.includes('rate-limited'));

  const errors = [];
  if (rootHardFail) errors.push(`root: ${root.error || 'failed'}`);
  if (root.rateLimited) errors.push(`root rate-limited: ${root.error || '429/503'}`);
  for (const f of hardFunctionalFails.slice(0, 5)) {
    errors.push(`${f.name}: ${f.error || 'failed'}`);
  }
  if (rateLimitedFunctional.length) {
    errors.push(
      `rate-limited functional checks: ${rateLimitedFunctional
        .slice(0, 4)
        .map((f) => f.name)
        .join(', ')}`
    );
  }
  if (functionalMeta.skipped && functionalMeta.skipReason) {
    errors.push(`functional: ${functionalMeta.skipReason}`);
  }

  return {
    name: site.name || site.url,
    url: site.url,
    checkedAt: new Date().toISOString(),
    ok,
    degraded: ok && degraded,
    // used by alerter: never call on pure rate-limit noise
    alertable: (!ok && rootHardFail) || (!ok && hardFunctionalFails.length > 0),
    status: root.status,
    ms: Date.now() - started,
    error: errors.length ? errors.join(' | ') : null,
    finalUrl: root.finalUrl,
    title: root.title,
    assets: root.assets,
    functional: {
      total: functionalMeta.total || 0,
      failed: functionalMeta.failed || 0,
      ok: functionalMeta.ok || 0,
      skipped: !!functionalMeta.skipped,
      skipReason: functionalMeta.skipReason || null,
      cached: !!functionalMeta.cached,
      items,
    },
    root,
  };
}

export async function checkAll(sites = config.sites) {
  runCounter += 1;
  const runFunctional = runCounter % config.functionalEveryN === 0 || runCounter === 1;
  const results = [];
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    if (i > 0) {
      // pause between sites to spread load
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.max(config.functionalDelayMs, 800));
    }
    // eslint-disable-next-line no-await-in-loop
    results.push(await checkSite(site, { runFunctional }));
  }
  return results;
}

export async function checkTarget(targetUrl) {
  return checkSite(
    { name: targetUrl, url: targetUrl, checkAssets: true, functional: [] },
    { runFunctional: false }
  );
}
