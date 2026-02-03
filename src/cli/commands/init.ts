import { initConfig, getConfigDir } from '../config';

export async function initCommand(): Promise<void> {
  try {
    const config = initConfig();
    
    console.log('✅ Janee initialized successfully!');
    console.log();
    console.log(`Config directory: ${getConfigDir()}`);
    console.log(`Master key generated and saved`);
    console.log();
    console.log('Next steps:');
    console.log('  1. Add a service:   janee add <service>');
    console.log('  2. Start proxy:     janee serve');
    console.log('  3. Configure agent: http://localhost:9119/<service>/...');
    
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}
