#!/bin/bash
# =============================================================================
# LOON: Bootstrap Admin Script (scripts/bootstrap-admin.sh)
# =============================================================================
#
# Creates the first admin user in Cloudflare KV. This is required before
# you can log into the admin interface.
#
# WHY IS THIS NEEDED?
#   LOON stores users in Cloudflare KV. Since the database starts empty,
#   you can't log in to create users via the UI. This script creates the
#   initial admin account directly in KV.
#
# WHAT HAPPENS:
#   1. Script creates a user record in KV with bootstrap=true flag
#   2. On first login, auth.js detects the bootstrap flag
#   3. Password is re-hashed with PBKDF2 and stored securely
#   4. Bootstrap flag is removed, plain password is deleted
#
# PREREQUISITES:
#   - Cloudflare KV namespace "LOON_DB" created and bound to Pages project
#   - curl installed
#   - jq installed (optional, for error display)
#
# USAGE:
#   ./bootstrap-admin.sh <username> <password>
#
# ENVIRONMENT VARIABLES (Required):
#   CF_ACCOUNT_ID     Your Cloudflare account ID
#   CF_API_TOKEN      API token with "Account.Workers KV Storage: Edit"
#   KV_NAMESPACE_ID   The LOON_DB namespace ID (from Cloudflare dashboard)
#
# EXAMPLE:
#   export CF_ACCOUNT_ID="abc123..."
#   export CF_API_TOKEN="your-api-token"
#   export KV_NAMESPACE_ID="def456..."
#   ./bootstrap-admin.sh admin MySecurePassword123
#
# SECURITY NOTES:
#   - Password is stored in plain text temporarily (bootstrap mode only)
#   - On first login, password is hashed with PBKDF2 (100k iterations)
#   - Use a strong password (minimum 8 characters enforced)
#   - Delete shell history after running: history -c
#
# =============================================================================

set -euo pipefail

# Configuration (set via environment or edit here)
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:?Set CF_ACCOUNT_ID environment variable}"
CF_API_TOKEN="${CF_API_TOKEN:?Set CF_API_TOKEN environment variable}"
KV_NAMESPACE_ID="${KV_NAMESPACE_ID:?Set KV_NAMESPACE_ID environment variable}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Validate arguments
USERNAME="${1:-}"
PASSWORD="${2:-}"

if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
    echo "Usage: $0 <username> <password>"
    echo ""
    echo "Example: $0 admin MySecurePassword123"
    echo ""
    echo "Required environment variables:"
    echo "  CF_ACCOUNT_ID    - Your Cloudflare account ID"
    echo "  CF_API_TOKEN     - API token with KV write permissions"
    echo "  KV_NAMESPACE_ID  - The LOON_DB namespace ID"
    exit 1
fi

# Validate password strength
if [[ ${#PASSWORD} -lt 8 ]]; then
    log_error "Password must be at least 8 characters"
    exit 1
fi

log_info "Creating admin user: $USERNAME"

# Build user record
# Note: bootstrap=true tells the auth worker to re-hash on first login
USER_JSON=$(cat <<EOF
{
  "role": "admin",
  "password": "$PASSWORD",
  "bootstrap": true,
  "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "createdBy": "bootstrap-script"
}
EOF
)

# Write to KV
log_info "Writing to Cloudflare KV..."

RESPONSE=$(curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/user:${USERNAME}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$USER_JSON")

# Check response
if echo "$RESPONSE" | grep -q '"success":true'; then
    log_info "Admin user created successfully"
    echo ""
    echo "=========================================="
    echo "  Admin Account Created"
    echo "=========================================="
    echo "  Username: $USERNAME"
    echo "  Password: $PASSWORD"
    echo "  Role:     admin"
    echo ""
    echo "  Login URL: /admin.html"
    echo "=========================================="
    echo ""
    log_warn "SECURITY: Clear your shell history to remove the password:"
    echo "  history -c  # or close this terminal"
    echo ""
    log_info "What happens next:"
    echo "  1. Log in at /admin.html with these credentials"
    echo "  2. Your password will be automatically re-hashed (PBKDF2)"
    echo "  3. The plain-text password is deleted from KV"
    echo "  4. Use the 'Users' tab to create additional users"
    echo ""
    log_warn "If you cannot log in immediately, wait 1-2 minutes for propagation."
    echo ""
else
    log_error "Failed to create user"
    echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
    exit 1
fi
