import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://janee.io',
  integrations: [
    starlight({
      title: 'Janee',
      description: 'Secure secrets proxy for AI agents',
      social: {
        github: 'https://github.com/rsdouglas/janee',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Why Janee?', slug: 'getting-started/why-janee' },
            { label: 'Quickstart', slug: 'getting-started/quickstart' },
            { label: 'Claude Desktop', slug: 'getting-started/claude-desktop' },
            { label: 'Cursor', slug: 'getting-started/cursor' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Request Policies', slug: 'guides/request-policies' },
            { label: 'Exec Mode', slug: 'guides/exec-mode' },
            { label: 'GitHub App Auth', slug: 'guides/github-app' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Runner / Authority', slug: 'architecture/runner-authority' },
          ],
        },
      ],
    }),
  ],
});
