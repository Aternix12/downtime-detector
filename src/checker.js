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
  // Keep this conservative: title hard markers or obvious body markers
  if (/(^|\s)404(\s|$)/.test(title.toLowerCase()) && /not found|page/.test(title.toLowerCase())) {
    return true;
  }
  return SOFT_404_MARKERS.some((m) => blob.includes(m));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = config.requestTimeoutMs) {
  const retries = Math.max(0, Number(config.requestRetries || 0));
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
      // Back off on edge rate limits / challenge interstitial responses
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
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
    const res = await fetchWithTimeout(asset.url, { method: 'GET' });
    const status = res.status;
    const ok = status >= 200 && status < 400;
    if (ok) {
      try {
        await res.arrayBuffer();
      } catch (err) {
        return {
          ...asset,
          ok: false,
          status,
          ms: Date.now() - started,
          error: `body read failed: ${err.message}`,
        };
      }
    }
    return {
      ...asset,
      ok,
      status,
      ms: Date.now() - started,
      error: ok ? null : `HTTP ${status}`,
    };
  } catch (err) {
    return {
      ...asset,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
    };
  }
}

async function scanAssets(pageUrl, html) {
  const assets = extractAssets(pageUrl, html);
  const checked = await mapPool(assets, config.assetConcurrency, checkAsset);
  const failed = checked.filter((a) => !a.ok);
  const failureRatio = checked.length ? failed.length / checked.length : 0;
  const ok = failed.length === 0 || failureRatio <= config.maxAssetFailureRatio;
  return {
    ok,
    total: checked.length,
    failed: failed.length,
    okCount: checked.length - failed.length,
    items: checked
      .filter((a) => !a.ok)
      .slice(0, 25)
      .concat(checked.filter((a) => a.ok).slice(0, 8)),
    error: ok
      ? null
      : `${failed.length}/${checked.length} assets failing. ${failed
          .slice(0, 3)
          .map((f) => `${f.type} ${f.status || 'ERR'} ${f.url}`)
          .join('; ')}`,
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

    if (!(res.status >= 200 && res.status < 400)) {
      result.error = `HTTP ${res.status}`;
      return result;
    }

    const isHtml = contentType.includes('text/html') || html.trim().startsWith('<');
    if (!isHtml) {
      // Non-HTML 2xx is fine for simple up checks
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
      };
      result.ok = assets.ok;
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

export async function checkSite(site) {
  const started = Date.now();
  const root = await checkPage({
    url: site.url,
    name: site.name || site.url,
    checkAssets: site.checkAssets !== false,
    timeoutMs: config.requestTimeoutMs,
  });

  const functionalDefs = site.functional || [];
  const functional = [];
  for (let i = 0; i < functionalDefs.length; i++) {
    const def = functionalDefs[i];
    if (i > 0 && config.functionalDelayMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(config.functionalDelayMs);
    }
    // sequential + polite
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
  }

  const failedFunctional = functional.filter((p) => !p.ok);
  // Cloudflare rate-limits/challenges shouldn't page as full site outages
  const hardFunctionalFails = failedFunctional.filter(
    (p) => p.status !== 429 && p.status !== 503
  );
  const rateLimitedFunctional = failedFunctional.filter(
    (p) => p.status === 429 || p.status === 503
  );
  const ok = root.ok && hardFunctionalFails.length === 0;
  const errors = [];
  if (!root.ok) errors.push(`root: ${root.error || 'failed'}`);
  for (const f of hardFunctionalFails.slice(0, 5)) {
    errors.push(`${f.name}: ${f.error || 'failed'}`);
  }
  if (rateLimitedFunctional.length) {
    const sample = rateLimitedFunctional
      .slice(0, 3)
      .map((f) => f.name)
      .join(', ');
    const note = `rate-limited functional checks: ${sample}`;
    if (ok) {
      // surface as non-fatal note
      errors.push(note);
    } else {
      errors.push(note);
    }
  }

  return {
    name: site.name || site.url,
    url: site.url,
    checkedAt: new Date().toISOString(),
    ok,
    status: root.status,
    ms: Date.now() - started,
    error: errors.length ? errors.join(' | ') : null,
    degraded: ok && rateLimitedFunctional.length > 0,
    finalUrl: root.finalUrl,
    title: root.title,
    assets: root.assets,
    functional: {
      total: functional.length,
      failed: failedFunctional.length,
      ok: functional.length - failedFunctional.length,
      items: functional,
    },
    root,
  };
}

export async function checkAll(sites = config.sites) {
  const results = [];
  for (const site of sites) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await checkSite(site));
  }
  return results;
}

// Back-compat single URL helper
export async function checkTarget(targetUrl) {
  return checkSite({ name: targetUrl, url: targetUrl, checkAssets: true, functional: [] });
}
