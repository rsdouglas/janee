/**
 * Service Directory - Well-known API services with their configuration templates
 * 
 * Users can `janee add stripe` and Janee will know the baseUrl and auth type.
 */

export interface ServiceTemplate {
  name: string;
  description: string;
  baseUrl: string;
  auth: {
    type: 'bearer' | 'basic' | 'hmac-mexc' | 'hmac-bybit' | 'hmac-okx' | 'headers' | 'service-account';
    fields: string[];  // Required fields to prompt for
  };
  docs?: string;
  tags: string[];
}

// Auth type notes:
// - 'hmac-mexc': MEXC-specific HMAC - signs query string, adds signature as URL param
// - 'hmac-bybit': Bybit-specific HMAC - signature in headers
// - 'hmac-okx': OKX-specific HMAC - requires passphrase, base64 encoded
// - 'service-account': Google Cloud service account OAuth2 - requires credentialsFile and scope(s)

/**
 * Built-in service directory
 */
export const serviceDirectory: ServiceTemplate[] = [
  // Payment
  {
    name: 'stripe',
    description: 'Payment processing platform',
    baseUrl: 'https://api.stripe.com',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://stripe.com/docs/api',
    tags: ['payment', 'finance']
  },
  
  // Developer Tools
  {
    name: 'github',
    description: 'Code hosting and collaboration',
    baseUrl: 'https://api.github.com',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://docs.github.com/en/rest',
    tags: ['developer', 'git', 'code']
  },
  {
    name: 'linear',
    description: 'Issue tracking for software teams',
    baseUrl: 'https://api.linear.app',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://developers.linear.app/docs',
    tags: ['developer', 'project-management', 'issues']
  },
  {
    name: 'vercel',
    description: 'Frontend deployment platform',
    baseUrl: 'https://api.vercel.com',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://vercel.com/docs/rest-api',
    tags: ['developer', 'deployment', 'hosting']
  },
  {
    name: 'cloudflare',
    description: 'CDN and edge computing platform',
    baseUrl: 'https://api.cloudflare.com/client/v4',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://developers.cloudflare.com/api',
    tags: ['developer', 'cdn', 'dns']
  },
  
  // AI/ML
  {
    name: 'openai',
    description: 'OpenAI API for GPT and DALL-E',
    baseUrl: 'https://api.openai.com/v1',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://platform.openai.com/docs/api-reference',
    tags: ['ai', 'llm', 'ml']
  },
  {
    name: 'anthropic',
    description: 'Anthropic Claude API',
    baseUrl: 'https://api.anthropic.com',
    auth: { type: 'headers', fields: ['x-api-key'] },
    docs: 'https://docs.anthropic.com/en/api',
    tags: ['ai', 'llm', 'ml']
  },
  {
    name: 'replicate',
    description: 'Run ML models in the cloud',
    baseUrl: 'https://api.replicate.com/v1',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://replicate.com/docs/reference/http',
    tags: ['ai', 'ml', 'models']
  },
  
  // Crypto Exchanges
  {
    name: 'bybit',
    description: 'Cryptocurrency derivatives exchange',
    baseUrl: 'https://api.bybit.com',
    auth: { type: 'hmac-bybit', fields: ['apiKey', 'apiSecret'] },
    docs: 'https://bybit-exchange.github.io/docs',
    tags: ['crypto', 'exchange', 'trading']
  },
  {
    name: 'okx',
    description: 'Cryptocurrency exchange',
    baseUrl: 'https://www.okx.com',
    auth: { type: 'hmac-okx', fields: ['apiKey', 'apiSecret', 'passphrase'] },
    docs: 'https://www.okx.com/docs-v5',
    tags: ['crypto', 'exchange', 'trading']
  },
  {
    name: 'mexc',
    description: 'Cryptocurrency exchange',
    baseUrl: 'https://api.mexc.com',
    auth: { type: 'hmac-mexc', fields: ['apiKey', 'apiSecret'] },
    docs: 'https://mexcdevelop.github.io/apidocs',
    tags: ['crypto', 'exchange', 'trading']
  },
  {
    name: 'coinbase',
    description: 'Cryptocurrency exchange (Advanced Trade API)',
    baseUrl: 'https://api.coinbase.com',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://docs.cloud.coinbase.com/advanced-trade-api',
    tags: ['crypto', 'exchange', 'trading']
  },
  
  // Communication
  {
    name: 'slack',
    description: 'Team communication platform',
    baseUrl: 'https://slack.com/api',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://api.slack.com/methods',
    tags: ['communication', 'messaging', 'team']
  },
  {
    name: 'discord',
    description: 'Chat platform for communities',
    baseUrl: 'https://discord.com/api/v10',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://discord.com/developers/docs',
    tags: ['communication', 'messaging', 'community']
  },
  {
    name: 'sendgrid',
    description: 'Email delivery service',
    baseUrl: 'https://api.sendgrid.com/v3',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://docs.sendgrid.com/api-reference',
    tags: ['email', 'communication']
  },
  {
    name: 'twilio',
    description: 'Communication APIs (SMS, Voice)',
    baseUrl: 'https://api.twilio.com/2010-04-01',
    auth: { type: 'basic', fields: ['accountSid', 'authToken'] },
    docs: 'https://www.twilio.com/docs/usage/api',
    tags: ['sms', 'voice', 'communication']
  },
  {
    name: 'resend',
    description: 'Modern email API',
    baseUrl: 'https://api.resend.com',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://resend.com/docs/api-reference',
    tags: ['email', 'communication']
  },
  
  // Analytics & Data
  {
    name: 'google-analytics',
    description: 'Google Analytics Data API',
    baseUrl: 'https://analyticsdata.googleapis.com',
    auth: { type: 'service-account', fields: ['credentialsFile', 'scope'] },
    docs: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
    tags: ['analytics', 'data', 'google']
  },
  {
    name: 'posthog',
    description: 'Product analytics platform',
    baseUrl: 'https://app.posthog.com/api',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://posthog.com/docs/api',
    tags: ['analytics', 'data']
  },
  {
    name: 'mixpanel',
    description: 'Product analytics',
    baseUrl: 'https://mixpanel.com/api/2.0',
    auth: { type: 'basic', fields: ['username', 'password'] },
    docs: 'https://developer.mixpanel.com/reference',
    tags: ['analytics', 'data']
  },
  
  // Database / Backend
  {
    name: 'supabase',
    description: 'Open source Firebase alternative',
    baseUrl: 'https://<project>.supabase.co/rest/v1',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://supabase.com/docs/reference',
    tags: ['database', 'backend', 'auth']
  },
  {
    name: 'planetscale',
    description: 'Serverless MySQL platform',
    baseUrl: 'https://api.planetscale.com/v1',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://api-docs.planetscale.com',
    tags: ['database', 'mysql']
  },
  
  // Other
  {
    name: 'notion',
    description: 'All-in-one workspace',
    baseUrl: 'https://api.notion.com/v1',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://developers.notion.com/reference',
    tags: ['productivity', 'notes', 'wiki']
  },
  {
    name: 'airtable',
    description: 'Spreadsheet-database hybrid',
    baseUrl: 'https://api.airtable.com/v0',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://airtable.com/developers/web/api',
    tags: ['database', 'spreadsheet', 'productivity']
  },
  {
    name: 'cal',
    description: 'Cal.com scheduling API',
    baseUrl: 'https://api.cal.com/v1',
    auth: { type: 'bearer', fields: ['key'] },
    docs: 'https://cal.com/docs/enterprise-features/api',
    tags: ['calendar', 'scheduling']
  }
];

/**
 * Search the directory for matching services
 */
export function searchDirectory(query: string): ServiceTemplate[] {
  const q = query.toLowerCase();
  
  return serviceDirectory.filter(service => {
    // Match name
    if (service.name.toLowerCase().includes(q)) return true;
    // Match description
    if (service.description.toLowerCase().includes(q)) return true;
    // Match tags
    if (service.tags.some(tag => tag.includes(q))) return true;
    return false;
  });
}

/**
 * Get a specific service by exact name
 */
export function getService(name: string): ServiceTemplate | undefined {
  return serviceDirectory.find(s => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * List all services grouped by tags
 */
export function listByCategory(): Map<string, ServiceTemplate[]> {
  const categories = new Map<string, ServiceTemplate[]>();
  
  for (const service of serviceDirectory) {
    const primaryTag = service.tags[0] || 'other';
    if (!categories.has(primaryTag)) {
      categories.set(primaryTag, []);
    }
    categories.get(primaryTag)!.push(service);
  }
  
  return categories;
}
