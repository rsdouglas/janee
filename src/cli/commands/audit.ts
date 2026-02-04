import { loadYAMLConfig, hasYAMLConfig } from '../config-yaml';

export async function auditCommand(): Promise<void> {
  if (!hasYAMLConfig()) {
    console.error('❌ No config found. Run `janee init` first.');
    process.exit(1);
  }

  const config = loadYAMLConfig();
  const issues: string[] = [];
  const warnings: string[] = [];
  const effectivePolicy = config.defaultPolicy || 'allow';

  // Check for missing defaultPolicy
  if (!config.defaultPolicy) {
    warnings.push('defaultPolicy is not set — defaulting to "allow" (backward-compatible). Set `defaultPolicy: deny` for secure defaults.');
  }

  // Check each capability
  for (const [name, cap] of Object.entries(config.capabilities)) {
    const hasRules = cap.rules && (cap.rules.allow?.length || cap.rules.deny?.length);

    if (!hasRules && effectivePolicy === 'allow') {
      if (cap.autoApprove) {
        issues.push(`${name}: no rules + autoApprove — ALLOWS ALL requests to ${cap.service} (highest risk)`);
      } else {
        issues.push(`${name}: no rules — allows all requests to ${cap.service}`);
      }
    } else if (!hasRules && effectivePolicy === 'deny') {
      // Under deny policy, ruleless = blocked. Not an issue, but worth noting.
      warnings.push(`${name}: no rules defined — all requests blocked (defaultPolicy: deny)`);
    }
  }

  // Output results
  if (issues.length === 0 && warnings.length === 0) {
    console.log('✅ No security issues found.');
    console.log(`   defaultPolicy: ${effectivePolicy}`);
    console.log(`   ${Object.keys(config.capabilities).length} capability(s) checked`);
    process.exit(0);
  }

  if (issues.length > 0) {
    console.error(`Found ${issues.length} security issue(s):`);
    console.error('');
    for (const issue of issues) {
      console.error(`  ✗ ${issue}`);
    }
    console.error('');
  }

  if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s):`);
    console.log('');
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
    console.log('');
  }

  // Exit non-zero if there are issues (not just warnings)
  if (issues.length > 0) {
    process.exit(1);
  }
}
