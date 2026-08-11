// Significant areas + low-cost functional path checks per site.
// Full JS/CSS asset scan runs on the site root only.
// Functional paths: HTTP 200, real HTML, not soft-404, optional title/body markers.

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
        path: '/resources/',
        name: 'Investor resources',
        titleIncludes: ['Resource', 'Investor', 'Betashares'],
      },
      {
        path: '/education/',
        name: 'Education / resources',
        titleIncludes: ['Education', 'Resource', 'Betashares', 'ETF'],
      },
      {
        path: '/category/',
        name: 'ETF categories',
        titleIncludes: ['ETF', 'Categor', 'Betashares', 'Fund'],
      },
      {
        path: '/about-us/',
        name: 'About us',
        titleIncludes: ['About', 'Betashares'],
      },
      {
        path: '/contact/',
        name: 'Contact',
        titleIncludes: ['Contact', 'Betashares'],
      },
      {
        path: '/news/',
        name: 'News',
        titleIncludes: ['News', 'Betashares'],
      },
      {
        path: '/privacy-policy/',
        name: 'Privacy policy',
        titleIncludes: ['Privacy'],
      },
    ],
  },
  {
    name: 'Betashares Direct',
    url: 'https://www.betashares.com.au/direct',
    checkAssets: true,
    functional: [
      {
        path: '/direct/pricing',
        name: 'Pricing',
        titleIncludes: ['Pricing', 'Direct'],
        bodyIncludes: ['Pricing', 'brokerage', 'fee'],
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
      {
        path: '/direct/account-types',
        name: 'Account types',
        titleIncludes: ['Account', 'Direct'],
      },
      {
        path: '/direct/brokerage-free',
        name: 'Brokerage-free ETFs & shares',
        titleIncludes: ['Brokerage', 'Direct', 'ETF'],
      },
      {
        path: '/direct/managed-portfolios',
        name: 'Managed portfolios',
        titleIncludes: ['Managed', 'Portfolio', 'Direct'],
      },
      {
        path: '/direct/tools-and-reporting',
        name: 'Tools & reporting',
        titleIncludes: ['Tool', 'Report', 'Direct'],
      },
      {
        path: '/direct/investment-options',
        name: 'Investment options',
        titleIncludes: ['Investment', 'Direct', 'Option'],
      },
      {
        path: '/direct/transfer-holdings',
        name: 'Transfer holdings',
        titleIncludes: ['Transfer', 'Direct', 'Portfolio'],
      },
      {
        path: '/direct/custom-portfolios',
        name: 'Custom portfolios',
        titleIncludes: ['Custom', 'Portfolio', 'Direct'],
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
        path: '/pie-funds/',
        name: 'PIE funds',
        titleIncludes: ['PIE', 'Fund', 'NZ', 'Betashares'],
      },
      {
        path: '/resources/',
        name: 'Resources',
        titleIncludes: ['Resource', 'Betashares'],
      },
      {
        path: '/insights/',
        name: 'Insights / knowledge',
        titleIncludes: ['Insight', 'Knowledge', 'Betashares', 'Market'],
      },
      {
        path: '/about-us/',
        name: 'About us',
        titleIncludes: ['About', 'Betashares'],
      },
      {
        path: '/contact/',
        name: 'Contact',
        titleIncludes: ['Contact', 'Betashares'],
      },
      {
        path: '/fund-materials/',
        name: 'Fund materials',
        titleIncludes: ['Fund', 'Material', 'Betashares'],
      },
      {
        path: '/news/',
        name: 'News',
        titleIncludes: ['News', 'Betashares'],
      },
      {
        path: '/education/frequently-asked-questions/',
        name: 'FAQs',
        titleIncludes: ['FAQ', 'Question', 'Betashares'],
      },
      {
        path: '/privacy-policy/',
        name: 'Privacy policy',
        titleIncludes: ['Privacy'],
      },
      {
        path: '/stewardship/',
        name: 'ESG / stewardship',
        titleIncludes: ['Steward', 'ESG', 'Betashares'],
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

    // Match by host+path prefix for slight variants
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
