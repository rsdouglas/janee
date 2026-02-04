#!/bin/bash
# Integration test for service account file input

set -e

echo "🧪 Testing service account CLI with file input..."
echo ""

# Create a temporary service account file
TEMP_FILE=$(mktemp /tmp/janee-test-sa.XXXXXX.json)

cat > "$TEMP_FILE" << 'EOF'
{
  "type": "service_account",
  "project_id": "test-project-12345",
  "private_key_id": "abc123def456",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\nMzEfYyjiWA4R4/M2bS1+fWIcPm15j7A9kNK8wH2bapLW+fYUb3kDpKQDTQFT+7TI\nmTqKQdZx9Xfp6hqW9aRMC8VdJ9LH4Uc4rKzL0gD4bEU+y8QCKYjLjPHj2lQxBvCg\npfDfQYfqL7VmqVdHwH3yIR+lnhQzKfCqF2XY4IkJBqrz+1t3e/lFEj7u8Q8i7Hkd\n7r+1t3e/lFEj7u8Q8i7Hkd\n-----END PRIVATE KEY-----\n",
  "client_email": "test-sa@test-project-12345.iam.gserviceaccount.com",
  "client_id": "123456789012345678901",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/test-sa%40test-project-12345.iam.gserviceaccount.com"
}
EOF

echo "✅ Created test service account file: $TEMP_FILE"
echo ""

# Test 1: Non-interactive with absolute path
echo "Test 1: Non-interactive with absolute path"
echo "Command: janee add test-ga --base-url https://analyticsdata.googleapis.com --auth-type service-account --credentials-file $TEMP_FILE --scope https://www.googleapis.com/auth/analytics.readonly"
echo ""

# Note: This will fail auth test (invalid credentials), but will test file reading
janee add test-ga \
  --base-url https://analyticsdata.googleapis.com \
  --auth-type service-account \
  --credentials-file "$TEMP_FILE" \
  --scope https://www.googleapis.com/auth/analytics.readonly || true

echo ""

# Test 2: Test ~ expansion (create a file in home directory)
HOME_FILE="$HOME/.janee-test-sa.json"
cp "$TEMP_FILE" "$HOME_FILE"

echo "Test 2: ~ expansion"
echo "Command: janee add test-ga-2 --base-url https://analyticsdata.googleapis.com --auth-type service-account --credentials-file ~/.janee-test-sa.json --scope https://www.googleapis.com/auth/analytics.readonly"
echo ""

janee add test-ga-2 \
  --base-url https://analyticsdata.googleapis.com \
  --auth-type service-account \
  --credentials-file ~/.janee-test-sa.json \
  --scope https://www.googleapis.com/auth/analytics.readonly || true

echo ""

# Cleanup
rm -f "$TEMP_FILE" "$HOME_FILE"
echo "✅ Cleaned up test files"
echo ""
echo "🎉 Tests complete. Check output above for file reading behavior."
