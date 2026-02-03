import { listServices } from '../config';

export async function listCommand(): Promise<void> {
  try {
    const services = listServices();

    if (services.length === 0) {
      console.log('No services configured yet.');
      console.log('');
      console.log('Add a service:');
      console.log('  janee add <service>');
      return;
    }

    console.log('');
    console.log('Configured services:');
    console.log('');

    services.forEach(service => {
      console.log(`  ${service.name}`);
      console.log(`    Base URL: ${service.baseUrl}`);
      if (service.description) {
        console.log(`    Description: ${service.description}`);
      }
      console.log(`    Added: ${new Date(service.createdAt).toLocaleString()}`);
      console.log('');
    });

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}
