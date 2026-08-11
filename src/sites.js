// Significant areas + low-cost functional path checks per site.
// Full JS/CSS asset scan runs on the site root only.
// Functional paths: HTTP 200, real HTML, not soft-404, optional title/body markers.
// Keep these suites small to avoid Cloudflare rate limits (esp. Direct).

export const DEFAULT_SITES = [
  {
    name: 'Betashares AU',
    url: 'https://www.betashares.com.au',
    checkAssets: true,
    functional: [
      {
        path: '/fund/',
        name: 'ETF fund list',
        titleIncludes: ['ETF', 'Fund'],
        bodyIncludes: ['ETF'],
      },
      {
        path: '/fund/australia-200-etf/',
        name: 'Sample fund A200',
        titleIncludes: ['A200', 'Australia 200', 'ETF'],
        bodyIncludes: ['A200'],
      },
      {
        path: '/super/',
        name: 'Super hub',
        titleIncludes: ['Super', 'Bendigo'],
      },
      {
        path: '/contact/',
        name: 'Contact',
        titleIncludes: ['Contact', 'Betashares'],
      },
    ],
  },
  {
    name: 'Betashares Direct',
    url: 'https://www.betashares.com.au/direct',
    checkAssets: true,
    // Direct is CF-sensitive — keep this especially small
    functional: [
      {
        path: '/direct/pricing',
        name: 'Pricing',
        titleIncludes: ['Pricing', 'Direct'],
      },
      {
        path: '/direct/faq',
        name: 'FAQ',
        titleIncludes: ['FAQ', 'Direct'],
      },
      {
        path: '/direct/auto-invest',
        name: 'Auto-invest',
        titleIncludes: ['Auto', 'Invest', 'Direct'],
      },
    ],
  },
  {
    name: 'Betashares NZ',
    url: 'https://www.betashares.co.nz',
    checkAssets: true,
    functional: [
      {
        path: '/nz-funds/',
        name: 'NZ funds',
        titleIncludes: ['NZ', 'Fund', 'PIE', 'Betashares'],
      },
      {
        path: '/resources/',
        name: 'Resources',
        titleIncludes: ['Resource', 'Betashares'],
      },
      {
        path: '/contact/',
        name: 'Contact',
        titleIncludes: ['Contact', 'Betashares'],
      },
      {
        path: '/about-us/',
        name: 'About us',
        titleIncludes: ['About', 'Betashares'],
      },
    ],
  },
  {
    name: 'Aternix',
    url: 'https://www.aternix.com',
    checkAssets: true,
    functional: [],
  },
];

function parseTargetsEnv(value) {
  if (!value || !String(value).trim()) return null;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeUrl(url) {
  return String(url).replace(/\/$/, '');
}

/**
 * Build runtime site list.
 * - If TARGETS env is set, keep those roots and attach matching built-in functional profiles.
 * - Unknown roots still get homepage+asset checks only.
 */
export function resolveSites(envTargets) {
  const defaultsByUrl = new Map(
    DEFAULT_SITES.map((s) => [normalizeUrl(s.url), s])
  );

  const targets = parseTargetsEnv(envTargets);
  if (!targets) {
    return DEFAULT_SITES.map((s) => ({ ...s, functional: [...(s.functional || [])] }));
  }

  return targets.map((raw) => {
    const url = normalizeUrl(raw);
    const known = defaultsByUrl.get(url);
    if (known) {
      return { ...known, url, functional: [...(known.functional || [])] };
    }

    const hit = DEFAULT_SITES.find((s) => {
      const base = normalizeUrl(s.url);
      return url === base || url.startsWith(base + '/');
    });
    if (hit) {
      return { ...hit, url, functional: [...(hit.functional || [])] };
    }

    return {
      name: url,
      url,
      checkAssets: true,
      functional: [],
    };
  });
}
