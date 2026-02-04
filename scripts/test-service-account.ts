#!/usr/bin/env tsx
/**
 * Integration test for service account authentication
 * 
 * This script tests the end-to-end flow with real Google credentials.
 * 
 * Usage:
 *   1. Create a service account in GCP Console
 *   2. Download the JSON key file
 *   3. Run: tsx scripts/test-service-account.ts /path/to/service-account.json
 * 
 * The script will:
 *   - Validate the credentials
 *   - Test JWT creation
 *   - Exchange JWT for access token
 *   - Verify token caching
 *   - Test a real API call (Google Analytics if property ID provided)
 */

import fs from 'fs';
import { validateServiceAccountCredentials, createServiceAccountJWT, getAccessToken, testServiceAccountAuth } from '../src/core/service-account';

const ANALYTICS_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly'
];

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: tsx scripts/test-service-account.ts <service-account.json> [property-id]');
    console.error('');
    console.error('Example:');
    console.error('  tsx scripts/test-service-account.ts ~/Downloads/my-project-abc123.json');
    console.error('  tsx scripts/test-service-account.ts ~/Downloads/my-project-abc123.json 123456789');
    process.exit(1);
  }

  const credPath = args[0];
  const propertyId = args[1];

  console.log('🔐 Service Account Integration Test\n');

  // Load credentials
  console.log(`📄 Loading credentials from: ${credPath}`);
  if (!fs.existsSync(credPath)) {
    console.error(`❌ File not found: ${credPath}`);
    process.exit(1);
  }

  let credentials;
  try {
    const content = fs.readFileSync(credPath, 'utf8');
    credentials = JSON.parse(content);
  } catch (error) {
    console.error('❌ Failed to parse JSON:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }

  // Step 1: Validate credentials
  console.log('\n1️⃣  Validating credentials...');
  try {
    validateServiceAccountCredentials(credentials);
    console.log('✅ Credentials are valid');
    console.log(`   Email: ${credentials.client_email}`);
    console.log(`   Project: ${credentials.project_id || 'N/A'}`);
  } catch (error) {
    console.error('❌ Validation failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }

  // Step 2: Create JWT
  console.log('\n2️⃣  Creating JWT...');
  try {
    const jwt = createServiceAccountJWT(credentials, ANALYTICS_SCOPES);
    console.log('✅ JWT created successfully');
    console.log(`   Length: ${jwt.length} chars`);
    
    // Decode to show claims (without verification)
    const jwtLib = require('jsonwebtoken');
    const decoded = jwtLib.decode(jwt) as any;
    console.log('   Claims:');
    console.log(`     iss: ${decoded.iss}`);
    console.log(`     scope: ${decoded.scope}`);
    console.log(`     aud: ${decoded.aud}`);
    console.log(`     exp: ${new Date(decoded.exp * 1000).toISOString()}`);
  } catch (error) {
    console.error('❌ JWT creation failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }

  // Step 3: Test authentication (exchange JWT for token)
  console.log('\n3️⃣  Testing authentication...');
  try {
    await testServiceAccountAuth(credentials, ANALYTICS_SCOPES);
    console.log('✅ Authentication successful');
  } catch (error) {
    console.error('❌ Authentication failed:', error instanceof Error ? error.message : 'Unknown error');
    console.error('');
    console.error('Common causes:');
    console.error('  - Service account doesn\'t have correct permissions');
    console.error('  - API not enabled in GCP project');
    console.error('  - Invalid credentials or expired key');
    process.exit(1);
  }

  // Step 4: Get access token (tests caching)
  console.log('\n4️⃣  Getting access token...');
  try {
    const token1 = await getAccessToken('test-service', credentials, ANALYTICS_SCOPES);
    console.log('✅ Access token obtained');
    console.log(`   Token: ${token1.substring(0, 20)}...`);

    // Get again to test cache
    console.log('\n5️⃣  Testing token cache...');
    const startTime = Date.now();
    const token2 = await getAccessToken('test-service', credentials, ANALYTICS_SCOPES);
    const elapsed = Date.now() - startTime;
    
    if (token1 === token2 && elapsed < 100) {
      console.log('✅ Token retrieved from cache');
      console.log(`   Response time: ${elapsed}ms`);
    } else {
      console.warn('⚠️  Expected cached token but got new one or slow response');
    }
  } catch (error) {
    console.error('❌ Token fetch failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }

  // Step 5: Test real API call (if property ID provided)
  if (propertyId) {
    console.log('\n6️⃣  Testing real API call (Google Analytics)...');
    try {
      const token = await getAccessToken('google-analytics', credentials, ANALYTICS_SCOPES);
      
      const response = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
            metrics: [{ name: 'sessions' }],
            dimensions: [{ name: 'date' }]
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API call failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ API call successful');
      console.log(`   Rows returned: ${data.rows?.length || 0}`);
      
      if (data.rows && data.rows.length > 0) {
        console.log('   Sample data:');
        data.rows.slice(0, 3).forEach((row: any) => {
          const date = row.dimensionValues[0].value;
          const sessions = row.metricValues[0].value;
          console.log(`     ${date}: ${sessions} sessions`);
        });
      }
    } catch (error) {
      console.error('❌ API call failed:', error instanceof Error ? error.message : 'Unknown error');
      console.error('');
      console.error('Make sure:');
      console.error('  - Service account has Analytics Viewer role on the property');
      console.error('  - Property ID is correct');
      console.error('  - Analytics Data API is enabled in GCP project');
      process.exit(1);
    }
  } else {
    console.log('\n💡 Tip: Provide a Google Analytics property ID to test a real API call:');
    console.log(`   tsx scripts/test-service-account.ts ${credPath} YOUR_PROPERTY_ID`);
  }

  console.log('\n🎉 All tests passed!\n');
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
