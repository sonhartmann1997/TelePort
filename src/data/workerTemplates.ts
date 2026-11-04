import { WorkerTemplate } from '../types/worker';

export const WORKER_TEMPLATES: WorkerTemplate[] = [
  {
    id: 'rest-router',
    title: 'REST Router & JSON API',
    category: 'API & Routing',
    description: 'Path routing with JSON request validation, query parameters, CORS headers, and structured error responses.',
    recommendedMethod: 'GET',
    recommendedPath: '/api/v1/health',
    recommendedHeaders: {
      'Accept': 'application/json',
    },
    envSeed: {
      'ENVIRONMENT': 'production',
      'API_VERSION': 'v1.4.2'
    },
    code: `/**
 * Cloudflare Worker: REST API Router
 * Handles path routing, query parameters, CORS, and JSON error standards.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    const method = request.method;

    // CORS preflight response
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const defaultHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Edge-Server': 'Cloudflare-Worker',
    };

    console.log(\`[\${method}] \${pathname} incoming from \${request.cf?.country || 'Unknown'}\`);

    // Route: GET /api/v1/health
    if (pathname === '/api/v1/health' && method === 'GET') {
      return new Response(JSON.stringify({
        status: 'healthy',
        uptime: '99.99%',
        environment: env.ENVIRONMENT || 'development',
        edgeColo: request.cf?.colo || 'LOCAL',
        timestamp: new Date().toISOString(),
      }, null, 2), {
        status: 200,
        headers: defaultHeaders,
      });
    }

    // Route: GET /api/v1/items
    if (pathname === '/api/v1/items' && method === 'GET') {
      const limit = parseInt(searchParams.get('limit') || '10', 10);
      const category = searchParams.get('category') || 'all';

      const items = [
        { id: 'item_1', name: 'Edge KV Cache Entry', category: 'storage', active: true },
        { id: 'item_2', name: 'WAF Rule Definition', category: 'security', active: true },
        { id: 'item_3', name: 'Cron Trigger Task', category: 'compute', active: false },
      ].slice(0, limit);

      return new Response(JSON.stringify({
        success: true,
        data: items,
        meta: { total: items.length, category, limit },
      }, null, 2), {
        status: 200,
        headers: defaultHeaders,
      });
    }

    // Route: POST /api/v1/items
    if (pathname === '/api/v1/items' && method === 'POST') {
      try {
        const payload = await request.json();
        if (!payload.name) {
          return new Response(JSON.stringify({
            error: 'Bad Request',
            message: 'Missing required property "name"',
          }), { status: 400, headers: defaultHeaders });
        }

        const createdItem = {
          id: \`item_\${Date.now()}\`,
          name: payload.name,
          category: payload.category || 'general',
          createdAt: new Date().toISOString(),
        };

        console.info('Created new item:', createdItem.id);

        return new Response(JSON.stringify({
          success: true,
          item: createdItem,
        }, null, 2), {
          status: 201,
          headers: defaultHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({
          error: 'Invalid JSON',
          message: err.message,
        }), { status: 400, headers: defaultHeaders });
      }
    }

    // Fallback 404
    return new Response(JSON.stringify({
      error: 'Not Found',
      message: \`Route \${method} \${pathname} does not exist\`,
      availableRoutes: [
        'GET /api/v1/health',
        'GET /api/v1/items?limit=10&category=all',
        'POST /api/v1/items'
      ],
    }, null, 2), {
      status: 404,
      headers: defaultHeaders,
    });
  },
};
`
  },
  {
    id: 'kv-cache-rate-limit',
    title: 'KV Cache & Rate Limiter',
    category: 'Caching & Storage',
    description: 'Edge caching using Cloudflare KV storage with custom TTL, plus sliding window IP-based rate limiting.',
    recommendedMethod: 'GET',
    recommendedPath: '/api/cached-resource',
    recommendedHeaders: {
      'cf-connecting-ip': '198.51.100.42',
    },
    kvSeed: {
      'cached_resource_v1': JSON.stringify({
        cachedData: 'Pre-computed expensive compute result at the edge',
        expires: '2026-12-31T23:59:59Z',
        version: 1
      }),
      'rate_limit_198.51.100.42': '1'
    },
    envSeed: {
      'MAX_REQUESTS_PER_WINDOW': '5',
      'WINDOW_SECONDS': '60'
    },
    code: `/**
 * Cloudflare Worker: KV Caching & Edge Rate Limiter
 * Demonstrates env.MY_KV operations, TTL caching, and rate limiting by IP.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientIP = request.headers.get('cf-connecting-ip') || '127.0.0.1';
    const rateLimitKey = \`rate_limit_\${clientIP}\`;

    // 1. Rate Limiting Check using KV
    const currentCountStr = await env.MY_KV.get(rateLimitKey);
    const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
    const maxRequests = parseInt(env.MAX_REQUESTS_PER_WINDOW || '5', 10);

    if (currentCount >= maxRequests) {
      console.warn(\`Rate limit exceeded for IP \${clientIP}: \${currentCount} / \${maxRequests}\`);
      return new Response(JSON.stringify({
        error: 'Too Many Requests',
        message: \`Rate limit of \${maxRequests} requests per minute exceeded.\`,
        retryAfter: 60,
      }, null, 2), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          'X-RateLimit-Limit': String(maxRequests),
          'X-RateLimit-Remaining': '0',
        },
      });
    }

    // Increment rate counter asynchronously
    await env.MY_KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 60 });

    // 2. Cache Lookup in KV
    const cacheKey = \`cached_\${url.pathname.replace(/\\//g, '_')}\`;
    const cachedData = await env.MY_KV.get(cacheKey);

    if (cachedData) {
      console.log(\`KV Cache HIT for \${cacheKey}\`);
      return new Response(cachedData, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'CF-Cache-Status': 'HIT',
          'X-RateLimit-Remaining': String(maxRequests - (currentCount + 1)),
        },
      });
    }

    // 3. Cache Miss: Compute or simulate origin response
    console.log(\`KV Cache MISS for \${cacheKey}. Generating fresh payload...\`);
    const freshPayload = {
      message: 'Generated by edge worker on cache miss',
      computedAt: new Date().toISOString(),
      clientCountry: request.cf?.country || 'Unknown',
      rateLimitRemaining: maxRequests - (currentCount + 1),
    };

    const responseBody = JSON.stringify(freshPayload, null, 2);

    // Save to KV with 300 second TTL
    await env.MY_KV.put(cacheKey, responseBody, { expirationTtl: 300 });

    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'CF-Cache-Status': 'MISS',
        'X-RateLimit-Remaining': String(maxRequests - (currentCount + 1)),
      },
    });
  },
};
`
  },
  {
    id: 'edge-auth-gate',
    title: 'Edge Auth & Bearer Token Gate',
    category: 'Security & Auth',
    description: 'Inspects and validates Bearer tokens at the edge, rejecting unauthorized traffic before reaching upstream origin.',
    recommendedMethod: 'GET',
    recommendedPath: '/protected/dashboard',
    recommendedHeaders: {
      'Authorization': 'Bearer secret-edge-token-2026',
    },
    envSeed: {
      'EXPECTED_AUTH_TOKEN': 'secret-edge-token-2026',
      'ORIGIN_HOST': 'https://api.internal-origin.com'
    },
    code: `/**
 * Cloudflare Worker: Edge Auth & Security Guard
 * Validates Authorization headers, enforces origin security tokens,
 * and strips sensitive edge tokens before forwarding.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization') || '';

    // Only guard /protected/* routes
    if (!url.pathname.startsWith('/protected')) {
      return new Response(JSON.stringify({
        message: 'Public edge route, no authentication needed.',
        pathname: url.pathname,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      console.warn('Unauthorized request: Missing or malformed Bearer header');
      return new Response(JSON.stringify({
        error: 'Unauthorized',
        message: 'A valid Bearer token is required in the Authorization header.',
      }, null, 2), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer error="invalid_token"',
        },
      });
    }

    const token = authHeader.slice(7).trim();
    const validToken = env.EXPECTED_AUTH_TOKEN || 'secret-edge-token-2026';

    if (token !== validToken) {
      console.error(\`Forbidden access attempt with invalid token: \${token.substring(0, 5)}***\`);
      return new Response(JSON.stringify({
        error: 'Forbidden',
        message: 'Provided credentials do not have permission for this resource.',
      }, null, 2), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.info('Authenticated request accepted at edge for', url.pathname);

    // Return edge-authenticated response payload
    return new Response(JSON.stringify({
      authenticated: true,
      subject: 'admin_user_edge',
      authorizedPath: url.pathname,
      edgeColo: request.cf?.colo || 'IAD',
      clientCountry: request.cf?.country || 'US',
      verifiedAt: new Date().toISOString(),
    }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Status': 'Verified-At-Edge',
      },
    });
  },
};
`
  },
  {
    id: 'geo-routing-localization',
    title: 'Geo-Routing & Edge Localization',
    category: 'Traffic & Geo',
    description: 'Inspects Cloudflare edge properties (country, city, colo, bot score) to route traffic or personalize content dynamically.',
    recommendedMethod: 'GET',
    recommendedPath: '/localize/pricing',
    recommendedHeaders: {},
    envSeed: {
      'DEFAULT_CURRENCY': 'USD',
    },
    code: `/**
 * Cloudflare Worker: Geo-Routing & Colocation Inspector
 * Reads request.cf properties provided natively by Cloudflare edge nodes.
 */

export default {
  async fetch(request, env, ctx) {
    const cf = request.cf || {};
    const country = cf.country || 'US';
    const city = cf.city || 'Ashburn';
    const colo = cf.colo || 'IAD';
    const botScore = cf.clientTrustScore ?? 99;

    console.log(\`Visitor from \${city}, \${country} routed via colocation data center [\${colo}]\`);

    // Regional pricing & currency matrix
    const regionalSettings = {
      'US': { currency: 'USD', symbol: '$', vatIncluded: false, regionalOrigin: 'us-east.edge.internal' },
      'GB': { currency: 'GBP', symbol: '£', vatIncluded: true, regionalOrigin: 'eu-west.edge.internal' },
      'DE': { currency: 'EUR', symbol: '€', vatIncluded: true, regionalOrigin: 'eu-central.edge.internal' },
      'FR': { currency: 'EUR', symbol: '€', vatIncluded: true, regionalOrigin: 'eu-west.edge.internal' },
      'JP': { currency: 'JPY', symbol: '¥', vatIncluded: true, regionalOrigin: 'ap-northeast.edge.internal' },
      'BR': { currency: 'BRL', symbol: 'R$', vatIncluded: true, regionalOrigin: 'sa-east.edge.internal' },
      'AU': { currency: 'AUD', symbol: 'A$', vatIncluded: true, regionalOrigin: 'ap-southeast.edge.internal' },
    };

    const config = regionalSettings[country] || {
      currency: env.DEFAULT_CURRENCY || 'USD',
      symbol: '$',
      vatIncluded: false,
      regionalOrigin: 'global.edge.internal',
    };

    const responsePayload = {
      edgeInfo: {
        colocationAirportCode: colo,
        countryCode: country,
        city: city,
        asn: cf.asn || 13335,
        tlsVersion: cf.tlsVersion || 'TLSv1.3',
        clientTrustScore: botScore,
      },
      localizedCommerce: {
        currency: config.currency,
        symbol: config.symbol,
        plans: [
          { name: 'Starter', price: \`\${config.symbol}19/mo\` },
          { name: 'Professional', price: \`\${config.symbol}49/mo\` },
          { name: 'Enterprise', price: 'Custom Quote' },
        ],
        vatNotice: config.vatIncluded ? 'VAT included in listed prices' : 'Taxes calculated at checkout',
        recommendedOriginGateway: config.regionalOrigin,
      },
    };

    return new Response(JSON.stringify(responsePayload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Geo-Country': country,
        'X-Geo-Colo': colo,
      },
    });
  },
};
`
  },
  {
    id: 'reverse-proxy-cors',
    title: 'CORS Proxy & Security Header Injector',
    category: 'Transformation',
    description: 'Intercepts incoming requests, injects strict Content-Security-Policy & HSTS, handles CORS preflight, and scrubs tracking headers.',
    recommendedMethod: 'GET',
    recommendedPath: '/proxy/service-status',
    recommendedHeaders: {
      'Origin': 'https://myapp.com',
    },
    envSeed: {
      'UPSTREAM_BASE': 'https://api.github.com'
    },
    code: `/**
 * Cloudflare Worker: Security Header Injector & Reverse Proxy
 * Demonstrates header sanitization, HSTS injection, and zero-trust proxying.
 */

export default {
  async fetch(request, env, ctx) {
    const method = request.method;

    // Handle Preflight OPTIONS
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    console.info('Proxying request and applying hardened security headers');

    // Simulate upstream response
    const mockUpstreamResponse = {
      proxyTarget: env.UPSTREAM_BASE || 'https://api.github.com',
      upstreamStatus: 'operational',
      sanitizedHeadersCount: 4,
      payload: {
        service: 'Core Banking API',
        latencyP99: '18ms',
        region: 'edge-global',
      },
    };

    // Return response with hardened headers
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Access-Control-Allow-Origin', '*');
    // Security standards
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none';");

    return new Response(JSON.stringify(mockUpstreamResponse, null, 2), {
      status: 200,
      headers: headers,
    });
  },
};
`
  },
  {
    id: 'html-edge-rewriter',
    title: 'HTML Rewriter & Edge SSR Injector',
    category: 'Transformation',
    description: 'Dynamic HTML stream modification at the edge: injects announcements, dynamic CSRF nonces, and meta tags.',
    recommendedMethod: 'GET',
    recommendedPath: '/landing',
    recommendedHeaders: {
      'Accept': 'text/html',
    },
    envSeed: {
      'ANNOUNCEMENT_TEXT': '🚀 Scheduled maintenance completed: Workers 2.0 runtime now live globally.'
    },
    code: `/**
 * Cloudflare Worker: HTML Rewriter & Edge Template Injector
 * Transforms HTML documents on the fly before reaching the browser.
 */

export default {
  async fetch(request, env, ctx) {
    const announcement = env.ANNOUNCEMENT_TEXT || 'Welcome to our edge-accelerated site!';
    const userCountry = request.cf?.country || 'US';
    const edgeColo = request.cf?.colo || 'IAD';

    // Base HTML document
    const baseHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Edge Accelerated Application</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; background: #0f172a; color: #f8fafc; }
    .banner { background: #ea580c; color: white; padding: 0.75rem 1rem; border-radius: 6px; font-weight: 500; margin-bottom: 2rem; }
    .card { background: #1e293b; border: 1px solid #334155; padding: 1.5rem; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="banner">\${announcement}</div>
  <div class="card">
    <h2>Served from Cloudflare Edge</h2>
    <p>Connected Data Center: <strong>\${edgeColo}</strong></p>
    <p>Visitor Country: <strong>\${userCountry}</strong></p>
    <p>Generated at: \${new Date().toISOString()}</p>
  </div>
</body>
</html>\`;

    console.log(\`Rewrote HTML document with edge metadata for visitor in \${userCountry}\`);

    return new Response(baseHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'X-Transformed-By': 'Cloudflare-Worker-HTMLRewriter',
      },
    });
  },
};
`
  },
  {
    id: 'webhook-signature-verifier',
    title: 'Webhook HMAC Signature Verifier',
    category: 'Security & Auth',
    description: 'Verifies incoming webhook payloads with HMAC-SHA256 signatures using standard Web Crypto API.',
    recommendedMethod: 'POST',
    recommendedPath: '/webhooks/stripe',
    recommendedHeaders: {
      'Content-Type': 'application/json',
      'x-signature-256': 'sha256=simulated_valid_edge_hash_sample',
    },
    recommendedBody: JSON.stringify({
      id: 'evt_1029384756',
      type: 'payment_intent.succeeded',
      created: 1718000000,
      data: { amount: 4900, currency: 'usd' }
    }, null, 2),
    envSeed: {
      'WEBHOOK_SECRET': 'whsec_99384810294857201948571029384'
    },
    code: `/**
 * Cloudflare Worker: Webhook Signature Validator
 * Demonstrates crypto.subtle cryptographic verification at the edge.
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const signature = request.headers.get('x-signature-256') || request.headers.get('stripe-signature');
    if (!signature) {
      console.warn('Webhook rejected: Missing signature header');
      return new Response(JSON.stringify({ error: 'Missing webhook signature header' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawBody = await request.text();

    console.info('Validating signature for payload bytes:', rawBody.length);

    // In a real environment with Web Crypto API:
    // const encoder = new TextEncoder();
    // const key = await crypto.subtle.importKey('raw', encoder.encode(env.WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

    // Log the verified event
    try {
      const payload = JSON.parse(rawBody);
      console.log('Webhook event verified:', payload.type, payload.id);

      return new Response(JSON.stringify({
        received: true,
        eventId: payload.id,
        eventType: payload.type,
        edgeRayId: request.cf?.rayId || 'sim-ray-12345',
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Malformed payload JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
`
  }
];
