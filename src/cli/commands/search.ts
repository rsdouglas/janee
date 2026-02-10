/**
 * Search the service directory
 */

import { searchDirectory, listByCategory, ServiceTemplate } from '../../core/directory';

function formatService(service: ServiceTemplate, verbose = false): string {
  const lines = [
    `  ${service.name}`,
    `    ${service.description}`,
  ];
  
  if (verbose) {
    lines.push(`    URL: ${service.baseUrl}`);
    lines.push(`    Auth: ${service.auth.type} (${service.auth.fields.join(', ')})`);
    if (service.docs) {
      lines.push(`    Docs: ${service.docs}`);
    }
    lines.push(`    Tags: ${service.tags.join(', ')}`);
  }
  
  return lines.join('\n');
}

function serviceToJSON(service: ServiceTemplate) {
  return {
    name: service.name,
    description: service.description,
    baseUrl: service.baseUrl,
    authType: service.auth.type,
    authFields: service.auth.fields,
    category: service.tags[0] || 'other',
    tags: service.tags,
    docs: service.docs
  };
}

export function searchCommand(query?: string, options: { verbose?: boolean; json?: boolean } = {}): void {
  const verbose = options.verbose || false;
  const json = options.json || false;

  if (!query) {
    // List all services
    const categories = listByCategory();
    const allServices: ServiceTemplate[] = [];
    
    for (const [_, services] of categories) {
      allServices.push(...services);
    }

    if (json) {
      console.log(JSON.stringify(allServices.map(serviceToJSON), null, 2));
      return;
    }

    // Human-readable output
    console.log('📚 Janee Service Directory\n');
    console.log('Usage: janee search <query>\n');
    
    for (const [category, services] of categories) {
      console.log(`\n${category.toUpperCase()}`);
      console.log('─'.repeat(40));
      for (const service of services) {
        console.log(formatService(service, verbose));
      }
    }
    
    console.log('\n💡 Tip: Use "janee add <service>" to add a known service');
    return;
  }

  const results = searchDirectory(query);

  if (json) {
    console.log(JSON.stringify(results.map(serviceToJSON), null, 2));
    return;
  }

  // Human-readable output
  if (results.length === 0) {
    console.log(`No services found matching "${query}"`);
    console.log('\nRun "janee search" to see all available services');
    return;
  }

  console.log(`Found ${results.length} service${results.length > 1 ? 's' : ''} matching "${query}":\n`);
  
  for (const service of results) {
    console.log(formatService(service, true));
    console.log('');
  }
  
  if (results.length === 1) {
    console.log(`💡 Add with: janee add ${results[0].name}`);
  }
}
