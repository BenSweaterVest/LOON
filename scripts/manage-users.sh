#!/bin/bash
# ============================================================================
# LOON User Management Script (scripts/manage-users.sh)
# ============================================================================
#
# This script provides command-line tools for managing LOON users (pages).
# It interacts with the Cloudflare API to add, remove, or reset user passwords.
#
# OVERVIEW:
#   LOON uses Cloudflare environment variables to store user passwords.
#   Each page has a password stored as USER_{PAGEID}_PASSWORD.
#   This script automates the creation and management of these variables.
#
# PREREQUISITES:
#   - bash (or compatible shell)
#   - curl (for API requests)
#   - jq (for JSON parsing)
#   - openssl (for password generation)
#
# USAGE:
#   ./manage-users.sh <command> [options]
#
# COMMANDS:
#   add <page_id>     Create a new user with an auto-generated password
#   reset <page_id>   Reset an existing user's password
#   remove <page_id>  Deactivate a user (sets password to unusable value)
#   list              Show all configured users
#   help              Display this help message
#
# ENVIRONMENT VARIABLES (Required):
#   CF_ACCOUNT_ID     Your Cloudflare account ID (found in dashboard URL)
#   CF_API_TOKEN      Cloudflare API token with "Pages: Edit" permission
#   CF_PROJECT_NAME   Your Cloudflare Pages project name (default: loon-skeleton)
#
# EXAMPLES:
#   # Add a new user for the "tacos" food truck
#   export CF_ACCOUNT_ID="abc123"
#   export CF_API_TOKEN="your-token-here"
#   ./manage-users.sh add tacos
#
#   # Reset password for an existing user
#   ./manage-users.sh reset tacos
#
#   # List all users
#   ./manage-users.sh list
#
# SECURITY NOTES:
#   - Passwords are generated using cryptographically secure random bytes
#   - Passwords are 32 characters, alphanumeric
#   - Passwords are stored as encrypted secrets in Cloudflare
#   - This script outputs passwords to stdout - handle securely!
#   - DO NOT run this script in CI/CD pipelines (passwords may be logged)
#   - Clear shell history after running: history -c
#
# LIMITATIONS:
#   - This script only manages Cloudflare environment variables
#   - You must manually create the data/{page_id}/ folder with schema.json
#   - Cloudflare has a limit of ~100 environment variables per project
#
# ============================================================================

# Exit on error, undefined variables, and pipe failures
set -euo pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================

# Colors for terminal output (if supported)
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

# Cloudflare configuration from environment variables
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
CF_API_TOKEN="${CF_API_TOKEN:-}"
CF_PROJECT_NAME="${CF_PROJECT_NAME:-loon-skeleton}"

# ============================================================================
# LOGGING FUNCTIONS
# ============================================================================

# Print an informational message
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

# Print a success message
log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Print a warning message
log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

# Print an error message to stderr
log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

# Check that required CLI tools are installed
check_dependencies() {
  local missing=()
  
  for cmd in curl jq openssl; do
    if ! command -v "$cmd" &> /dev/null; then
      missing+=("$cmd")
    fi
  done
  
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required tools: ${missing[*]}"
    log_error "Please install them and try again."
    echo ""
    echo "Installation hints:"
    echo "  macOS:   brew install curl jq openssl"
    echo "  Ubuntu:  sudo apt-get install curl jq openssl"
    echo "  Windows: Use WSL or Git Bash with these tools installed"
    exit 1
  fi
}

# Check that required environment variables are set
check_env_vars() {
  local missing=()
  
  [[ -z "$CF_ACCOUNT_ID" ]] && missing+=("CF_ACCOUNT_ID")
  [[ -z "$CF_API_TOKEN" ]] && missing+=("CF_API_TOKEN")
  
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required environment variables: ${missing[*]}"
    echo ""
    echo "Please set them before running this script:"
    echo ""
    echo "  export CF_ACCOUNT_ID='your-account-id'"
    echo "  export CF_API_TOKEN='your-api-token'"
    echo "  export CF_PROJECT_NAME='your-project-name'  # Optional, defaults to loon-skeleton"
    echo ""
    echo "Where to find these values:"
    echo "  CF_ACCOUNT_ID:   Look at your Cloudflare dashboard URL:"
    echo "                   https://dash.cloudflare.com/ACCOUNT_ID/..."
    echo ""
    echo "  CF_API_TOKEN:    Create at https://dash.cloudflare.com/profile/api-tokens"
    echo "                   Required permission: Account > Cloudflare Pages > Edit"
    exit 1
  fi
}

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

# Generate a cryptographically secure random password
# Uses openssl for randomness, removes special characters for ease of use
generate_password() {
  # Generate 32 bytes of random data, base64 encode, remove problematic chars
  openssl rand -base64 32 | tr -d '/+=' | head -c 32
}

# ============================================================================
# CLOUDFLARE API FUNCTIONS
# ============================================================================

# Make a request to the Cloudflare API
# Arguments:
#   $1 - HTTP method (GET, POST, PATCH, etc.)
#   $2 - API endpoint (relative to /accounts/{account_id})
#   $3 - Request body (optional, for POST/PATCH)
cf_api() {
  local method=$1
  local endpoint=$2
  local data=${3:-}
  
  local url="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}${endpoint}"
  
  if [[ -n "$data" ]]; then
    curl -s -X "$method" "$url" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -s -X "$method" "$url" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

# Get the full project configuration from Cloudflare
get_project_config() {
  cf_api GET "/pages/projects/${CF_PROJECT_NAME}"
}

# Get just the environment variables from the project configuration
get_env_vars() {
  get_project_config | jq -r '.result.deployment_configs.production.env_vars // {}'
}

# Update environment variables in the Cloudflare project
# Arguments:
#   $1 - JSON object with the environment variable updates
update_env_vars() {
  local env_json=$1
  cf_api PATCH "/pages/projects/${CF_PROJECT_NAME}" "$env_json"
}

# ============================================================================
# COMMAND IMPLEMENTATIONS
# ============================================================================

# Add a new user with an auto-generated password
cmd_add() {
  local page_id="${1:-}"
  
  if [[ -z "$page_id" ]]; then
    log_error "Usage: $0 add <page_id>"
    echo ""
    echo "Example: $0 add tacos"
    exit 1
  fi
  
  # Normalize page ID: lowercase, alphanumeric + hyphens only
  page_id=$(echo "$page_id" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')
  
  log_info "Adding user: $page_id"
  
  # Generate a secure password
  local password
  password=$(generate_password)
  
  # Build the environment variable name
  local env_key="USER_${page_id^^}_PASSWORD"  # ${var^^} converts to uppercase
  
  # Create the API request body
  local env_json
  env_json=$(cat <<EOF
{
  "deployment_configs": {
    "production": {
      "env_vars": {
        "${env_key}": {
          "type": "secret_text",
          "value": "${password}"
        }
      }
    }
  }
}
EOF
)

  # Make the API request
  local result
  result=$(update_env_vars "$env_json")
  
  # Check for success
  local success
  success=$(echo "$result" | jq -r '.success')
  
  if [[ "$success" != "true" ]]; then
    log_error "Failed to add user"
    echo "$result" | jq -r '.errors[]?.message // .messages[]?.message // "Unknown error"'
    exit 1
  fi
  
  # Print success message with the generated password
  echo ""
  echo "=========================================="
  log_success "User added"
  echo "=========================================="
  echo ""
  echo "  Page ID:   $page_id"
  echo "  Password:  $password"
  echo ""
  echo "  Login URL: https://${CF_PROJECT_NAME}.pages.dev/admin.html"
  echo ""
  log_warn "IMPORTANT: Copy the password now - it cannot be retrieved later!"
  echo ""
  echo "  =============================================="
  echo "  REQUIRED: You MUST complete these steps"
  echo "  =============================================="
  echo ""
  echo "  1. CREATE THE PAGE FILES (required for login to work!):"
  echo "     mkdir -p data/${page_id}"
  echo "     # Copy an example schema:"
  echo "     cp examples/food-truck/schema.json data/${page_id}/"
  echo "     echo '{}' > data/${page_id}/content.json"
  echo ""
  echo "  2. COMMIT AND PUSH to GitHub:"
  echo "     git add data/${page_id}"
  echo "     git commit -m 'Add ${page_id} page'"
  echo "     git push"
  echo ""
  echo "  3. WAIT FOR DEPLOYMENT:"
  echo "     Cloudflare Pages may take 1-2 minutes to deploy."
  echo "     If login fails immediately, wait and retry."
  echo ""
  echo "  4. SHARE CREDENTIALS with the user securely"
  echo ""
  log_warn "Without step 1, the user will see a 404 error after login!"
  echo ""
  echo "=========================================="
}

# Reset an existing user's password
cmd_reset() {
  local page_id="${1:-}"
  
  if [[ -z "$page_id" ]]; then
    log_error "Usage: $0 reset <page_id>"
    exit 1
  fi
  
  # Normalize page ID
  page_id=$(echo "$page_id" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')
  
  log_info "Resetting password for: $page_id"
  
  # Generate new password
  local password
  password=$(generate_password)
  
  local env_key="USER_${page_id^^}_PASSWORD"
  
  local env_json
  env_json=$(cat <<EOF
{
  "deployment_configs": {
    "production": {
      "env_vars": {
        "${env_key}": {
          "type": "secret_text",
          "value": "${password}"
        }
      }
    }
  }
}
EOF
)

  local result
  result=$(update_env_vars "$env_json")
  
  local success
  success=$(echo "$result" | jq -r '.success')
  
  if [[ "$success" != "true" ]]; then
    log_error "Failed to reset password"
    echo "$result" | jq -r '.errors[]?.message // "Unknown error"'
    exit 1
  fi
  
  echo ""
  log_success "Password reset for: $page_id"
  echo ""
  echo "  New password: $password"
  echo ""
  echo "  Give this new password to the user."
  echo "  The old password will no longer work."
  echo ""
}

# Deactivate a user by setting their password to an unusable value
cmd_remove() {
  local page_id="${1:-}"
  
  if [[ -z "$page_id" ]]; then
    log_error "Usage: $0 remove <page_id>"
    exit 1
  fi
  
  # Normalize page ID
  page_id=$(echo "$page_id" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')
  
  log_warn "Removing user: $page_id"
  log_warn "Note: This deactivates the user by setting an unusable password."
  log_warn "The data files in data/${page_id}/ will remain (delete manually if needed)."
  
  # Set password to an unusable value (prefixed with DEACTIVATED_)
  local password="DEACTIVATED_$(generate_password)"
  local env_key="USER_${page_id^^}_PASSWORD"
  
  local env_json
  env_json=$(cat <<EOF
{
  "deployment_configs": {
    "production": {
      "env_vars": {
        "${env_key}": {
          "type": "secret_text",
          "value": "${password}"
        }
      }
    }
  }
}
EOF
)

  local result
  result=$(update_env_vars "$env_json")
  
  local success
  success=$(echo "$result" | jq -r '.success')
  
  if [[ "$success" != "true" ]]; then
    log_error "Failed to remove user"
    echo "$result" | jq -r '.errors[]?.message // "Unknown error"'
    exit 1
  fi
  
  log_success "User $page_id has been deactivated."
  echo ""
  echo "The user can no longer log in. To fully remove:"
  echo "  1. Delete the data/${page_id}/ folder from your repo"
  echo "  2. Optionally remove the env var from Cloudflare dashboard"
  echo ""
}

# List all configured users
cmd_list() {
  log_info "Fetching configured users from Cloudflare..."
  
  local env_vars
  env_vars=$(get_env_vars)
  
  echo ""
  echo "Configured Users:"
  echo "================="
  
  # Extract USER_*_PASSWORD variables and display the page IDs
  local found=0
  echo "$env_vars" | jq -r 'to_entries[] | select(.key | startswith("USER_") and endswith("_PASSWORD")) | .key' | while read -r key; do
    # Extract page ID from USER_PAGEID_PASSWORD
    local page_id
    page_id=$(echo "$key" | sed 's/^USER_//' | sed 's/_PASSWORD$//' | tr '[:upper:]' '[:lower:]')
    echo "  • $page_id"
    found=1
  done
  
  if [[ $found -eq 0 ]]; then
    echo "  (no users configured)"
  fi
  
  echo ""
  echo "Note: Passwords are stored as secrets and cannot be displayed."
  echo "Use '$0 reset <page_id>' to generate a new password."
  echo ""
}

# Display help message
cmd_help() {
  echo ""
  echo "LOON User Management Script"
  echo "==========================="
  echo ""
  echo "Manage users for your LOON installation via the Cloudflare API."
  echo ""
  echo "USAGE:"
  echo "  $0 <command> [options]"
  echo ""
  echo "COMMANDS:"
  echo "  add <page_id>     Create a new user with auto-generated password"
  echo "  reset <page_id>   Reset an existing user's password"
  echo "  remove <page_id>  Deactivate a user"
  echo "  list              List all configured users"
  echo "  help              Show this help message"
  echo ""
  echo "ENVIRONMENT VARIABLES (Required):"
  echo "  CF_ACCOUNT_ID     Your Cloudflare account ID"
  echo "  CF_API_TOKEN      Cloudflare API token with Pages edit permission"
  echo "  CF_PROJECT_NAME   Cloudflare Pages project name (default: loon-skeleton)"
  echo ""
  echo "EXAMPLES:"
  echo "  # Set up environment"
  echo "  export CF_ACCOUNT_ID='abc123def456'"
  echo "  export CF_API_TOKEN='your-api-token'"
  echo ""
  echo "  # Add a new user"
  echo "  $0 add tacos"
  echo ""
  echo "  # Reset a password"
  echo "  $0 reset tacos"
  echo ""
  echo "  # List all users"
  echo "  $0 list"
  echo ""
}

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

main() {
  # Always check dependencies first
  check_dependencies
  
  local command="${1:-help}"
  
  case "$command" in
    add|reset|remove|list)
      # These commands require environment variables
      check_env_vars
      "cmd_${command}" "${@:2}"
      ;;
    help|--help|-h)
      cmd_help
      ;;
    *)
      log_error "Unknown command: $command"
      cmd_help
      exit 1
      ;;
  esac
}

# Run main function with all arguments
main "$@"
