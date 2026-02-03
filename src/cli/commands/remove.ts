import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { removeService } from '../config';

export async function removeCommand(service: string): Promise<void> {
  try {
    const rl = readline.createInterface({ input, output });

    // Confirm deletion
    const answer = await rl.question(
      `Are you sure you want to remove service "${service}"? This cannot be undone. (y/N): `
    );

    rl.close();

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('❌ Cancelled');
      return;
    }

    removeService(service);

    console.log(`✅ Service "${service}" removed successfully!`);

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}
