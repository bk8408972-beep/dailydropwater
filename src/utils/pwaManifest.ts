import type { AppRole } from '../types';

export interface WebAppManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: 'any' | 'maskable';
}

export interface RolePwaManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  orientation: 'portrait';
  background_color: string;
  theme_color: string;
  lang: string;
  icons: WebAppManifestIcon[];
}

export interface RolePwaMeta {
  role: 'customer' | 'owner' | 'rider';
  name: string;
  shortName: string;
  themeColor: string;
  icon192: string;
  icon512: string;
  maskableIcon512: string;
  appleTouchIcon: string;
  installButtonLabel: string;
}

export function normalizePwaRole(role: AppRole): 'customer' | 'owner' | 'rider' {
  if (role === 'owner') return 'owner';
  if (role === 'rider') return 'rider';
  return 'customer';
}

export function getRolePwaMeta(role: AppRole): RolePwaMeta {
  const normalized = normalizePwaRole(role);
  if (normalized === 'owner') {
    return {
      role: 'owner',
      name: 'DailyDrop Owner',
      shortName: 'DD Owner',
      themeColor: '#0f172a',
      icon192: '/icon-owner-192x192.png',
      icon512: '/icon-owner-512x512.png',
      maskableIcon512: '/icon-owner-maskable-512x512.png',
      appleTouchIcon: '/apple-touch-icon-owner.png',
      installButtonLabel: '⬇️ Download Owner App',
    };
  }
  if (normalized === 'rider') {
    return {
      role: 'rider',
      name: 'DailyDrop Rider',
      shortName: 'DD Rider',
      themeColor: '#1e40af',
      icon192: '/icon-rider-192x192.png',
      icon512: '/icon-rider-512x512.png',
      maskableIcon512: '/icon-rider-maskable-512x512.png',
      appleTouchIcon: '/apple-touch-icon-rider.png',
      installButtonLabel: '⬇️ Download Rider App',
    };
  }
  return {
    role: 'customer',
    name: 'DailyDrop Water',
    shortName: 'DailyDrop',
    themeColor: '#1d4ed8',
    icon192: '/icon-192x192.png',
    icon512: '/icon-512x512.png',
    maskableIcon512: '/icon-maskable-512x512.png',
    appleTouchIcon: '/apple-touch-icon.png',
    installButtonLabel: '⬇️ Install App',
  };
}

/**
 * Builds a complete standalone Web App Manifest tailored to the active DailyDrop role.
 * When `origin` is provided (required inside `blob:` URL manifests so Chromium resolves
 * URLs cleanly against the page origin), all paths are prefixed with `origin`.
 */
export function buildRolePwaManifest(
  role: AppRole,
  origin: string = ''
): RolePwaManifest {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const withOrigin = (path: string) => `${cleanOrigin}${path}`;
  const meta = getRolePwaMeta(role);

  if (meta.role === 'owner') {
    return {
      id: withOrigin('/?app=owner'),
      name: 'DailyDrop Owner',
      short_name: 'DD Owner',
      description: 'DailyDrop Owner Store Command Center — Orders, Riders & Fees',
      start_url: withOrigin('/?app=owner'),
      scope: withOrigin('/'),
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#0f172a',
      theme_color: '#0f172a',
      lang: 'en-IN',
      icons: [
        {
          src: withOrigin(meta.icon192),
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: withOrigin(meta.icon512),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: withOrigin(meta.maskableIcon512),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    };
  }

  if (meta.role === 'rider') {
    return {
      id: withOrigin('/?app=rider'),
      name: 'DailyDrop Rider',
      short_name: 'DD Rider',
      description: 'DailyDrop Rider Delivery Fleet Portal — Live Orders & Navigation',
      start_url: withOrigin('/?app=rider'),
      scope: withOrigin('/'),
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#1e40af',
      theme_color: '#1e40af',
      lang: 'en-IN',
      icons: [
        {
          src: withOrigin(meta.icon192),
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: withOrigin(meta.icon512),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: withOrigin(meta.maskableIcon512),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    };
  }

  return {
    id: withOrigin('/'),
    name: 'DailyDrop Water',
    short_name: 'DailyDrop',
    description: 'Fast Water Cans & Cold Drinks Delivery Near You',
    start_url: withOrigin('/'),
    scope: withOrigin('/'),
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#1d4ed8',
    theme_color: '#1d4ed8',
    lang: 'en-IN',
    icons: [
      {
        src: withOrigin(meta.icon192),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: withOrigin(meta.icon512),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: withOrigin(meta.maskableIcon512),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

let activeManifestBlobUrl: string | null = null;

function upsertMetaTag(name: string, content: string): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function updateLinkHref(selector: string, href: string): void {
  if (typeof document === 'undefined') return;
  const link = document.querySelector<HTMLLinkElement>(selector);
  if (link) {
    link.href = href;
  }
}

/**
 * Dynamically injects a per-role `<link rel="manifest">` blob for Owner and Rider
 * (or restores `/manifest.json` for Customer) along with matching icons and meta tags.
 */
export function applyRolePwaManifest(role: AppRole): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const normalized = normalizePwaRole(role);
  const meta = getRolePwaMeta(role);

  upsertMetaTag('theme-color', meta.themeColor);
  upsertMetaTag('application-name', meta.name);
  upsertMetaTag('apple-mobile-web-app-title', meta.shortName);
  updateLinkHref('link[rel="icon"][sizes="192x192"]', meta.icon192);
  updateLinkHref('link[rel="icon"][sizes="512x512"]', meta.icon512);
  updateLinkHref('link[rel="apple-touch-icon"]', meta.appleTouchIcon);

  let manifestLink = document.querySelector<HTMLLinkElement>(
    'link[rel="manifest"]'
  );

  // If index.html bootstrap script already injected the matching role blob, reuse it cleanly
  if (
    manifestLink &&
    manifestLink.dataset.pwaRole === normalized &&
    ((normalized === 'customer' && manifestLink.getAttribute('href') === '/manifest.json') ||
      (normalized !== 'customer' && manifestLink.href.startsWith('blob:')))
  ) {
    return;
  }

  if (activeManifestBlobUrl) {
    URL.revokeObjectURL(activeManifestBlobUrl);
    activeManifestBlobUrl = null;
  }

  if (!manifestLink) {
    manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    document.head.appendChild(manifestLink);
  }

  if (normalized === 'customer') {
    manifestLink.href = '/manifest.json';
    manifestLink.dataset.pwaRole = 'customer';
    return;
  }

  const manifestObj = buildRolePwaManifest(normalized, window.location.origin);
  const blob = new Blob([JSON.stringify(manifestObj)], {
    type: 'application/manifest+json',
  });
  const blobUrl = URL.createObjectURL(blob);
  activeManifestBlobUrl = blobUrl;
  manifestLink.href = blobUrl;
  manifestLink.dataset.pwaRole = normalized;
}
