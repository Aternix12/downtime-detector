import * as cheerio from 'cheerio';
import { config } from './config.js';

const ASSET_SELECTOR = [
  'link[rel="stylesheet"][href]',
  'link[rel="preload"][as="style"][href]',
  'script[src]',
].join(',');

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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': config.userAgent,
        accept: '*/*',
        ...(options.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
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
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run());
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

  // Catch common bundler patterns referenced in HTML comments / preload modules
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
    let res = await fetchWithTimeout(asset.url, { method: 'GET' });
    // Some CDNs dislike GET body drain cost; still fine for small assets
    const status = res.status;
    const ok = status >= 200 && status < 400;
    // Soft body read to detect truncated/reset streams
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

export async function checkTarget(targetUrl) {
  const started = Date.now();
  const result = {
    url: targetUrl,
    checkedAt: new Date().toISOString(),
    ok: false,
    status: 0,
    ms: 0,
    error: null,
    finalUrl: targetUrl,
    assets: {
      total: 0,
      failed: 0,
      ok: 0,
      items: [],
    },
  };

  try {
    const res = await fetchWithTimeout(targetUrl, {
      method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    result.status = res.status;
    result.finalUrl = res.url || targetUrl;
    result.ms = Date.now() - started;

    if (!(res.status >= 200 && res.status < 400)) {
      result.error = `Main page HTTP ${res.status}`;
      return result;
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const html = await res.text();
    if (!contentType.includes('text/html') && !html.trim().startsWith('<')) {
      // Non-HTML 2xx still counts as up, no asset scan
      result.ok = true;
      result.error = null;
      return result;
    }

    const assets = extractAssets(result.finalUrl, html);
    const checked = await mapPool(assets, config.assetConcurrency, checkAsset);
    const failed = checked.filter((a) => !a.ok);

    result.assets = {
      total: checked.length,
      failed: failed.length,
      ok: checked.length - failed.length,
      items: checked
        .filter((a) => !a.ok)
        .slice(0, 25)
        .concat(
          checked
            .filter((a) => a.ok)
            .slice(0, 10)
        ),
    };

    const failureRatio = checked.length ? failed.length / checked.length : 0;
    // Default max ratio 0 => any failed asset fails
    const strictAssetsOk = failed.length === 0 || failureRatio <= config.maxAssetFailureRatio;
    result.ok = strictAssetsOk;
    result.ms = Date.now() - started;
    if (!result.ok) {
      const sample = failed
        .slice(0, 3)
        .map((f) => `${f.type} ${f.status || 'ERR'} ${f.url}`)
        .join('; ');
      result.error = `${failed.length}/${checked.length} assets failing. ${sample}`;
    }
    return result;
  } catch (err) {
    result.ms = Date.now() - started;
    result.error = err.name === 'AbortError' ? 'timeout waiting for main page' : err.message;
    result.ok = false;
    return result;
  }
}

export async function checkAll(targets = config.targets) {
  const results = [];
  for (const target of targets) {
    // sequential to be polite
    // eslint-disable-next-line no-await-in-loop
    results.push(await checkTarget(target));
  }
  return results;
}
