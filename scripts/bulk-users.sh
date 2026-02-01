#!/bin/bash
# =============================================================================
# LOON Phase 2: Bulk User Creation Script (scripts/bulk-users.sh)
# =============================================================================
#
# Creates multiple users from a CSV file. Useful for onboarding teams.
#
# USAGE:
#   ./bulk-users.sh <csv-file>
#
# CSV FORMAT:
#   username,role,password
#   john,editor,
#   jane,contributor,custom123
#
#   - First row must be header: username,role,password
#   - Password is optional (auto-generated if empty)
#   - Valid roles: admin, editor, contributor
#
# PREREQUISITES:
#   - curl, jq installed
#   - Admin session token (will prompt or use LOON_ADMIN_TOKEN env var)
#   - LOON site URL (will prompt or use LOON_URL env var)
#
# OUTPUT:
#   Creates users.csv.results file with created usernames and passwords
#
# EXAMPLE:
#   export LOON_URL="https://my-site.pages.dev"
#   export LOON_ADMIN_TOKEN="your-admin-token"
#   ./bulk-users.sh new-users.csv
#
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check dependencies
check_dependencies() {
    for cmd in curl jq; do
        if ! command -v $cmd &> /dev/null; then
            log_error "$cmd is required but not installed."
            exit 1
        fi
    done
}

# Get config
get_config() {
    # LOON URL
    if [[ -z "${LOON_URL:-}" ]]; then
        read -p "Enter LOON site URL (e.g., https://my-site.pages.dev): " LOON_URL
    fi
    LOON_URL="${LOON_URL%/}" # Remove trailing slash
    
    # Admin token
    if [[ -z "${LOON_ADMIN_TOKEN:-}" ]]; then
        read -sp "Enter admin session token: " LOON_ADMIN_TOKEN
        echo
    fi
}

# Validate CSV file
validate_csv() {
    local file="$1"
    
    if [[ ! -f "$file" ]]; then
        log_error "File not found: $file"
        exit 1
    fi
    
    # Check header
    local header
    header=$(head -1 "$file")
    if [[ "$header" != "username,role,password" && "$header" != "username,role,password"$'\r' ]]; then
        log_error "Invalid CSV header. Expected: username,role,password"
        log_error "Got: $header"
        exit 1
    fi
}

# Create a user
create_user() {
    local username="$1"
    local role="$2"
    local password="${3:-}"
    
    local body
    if [[ -n "$password" ]]; then
        body="{\"username\":\"$username\",\"role\":\"$role\",\"password\":\"$password\"}"
    else
        body="{\"username\":\"$username\",\"role\":\"$role\"}"
    fi
    
    local response
    response=$(curl -s -X POST "${LOON_URL}/api/users" \
        -H "Authorization: Bearer ${LOON_ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$body")
    
    echo "$response"
}

# Main
main() {
    local csv_file="${1:-}"
    
    if [[ -z "$csv_file" ]]; then
        echo "Usage: $0 <csv-file>"
        echo ""
        echo "CSV format:"
        echo "  username,role,password"
        echo "  john,editor,"
        echo "  jane,contributor,custom123"
        exit 1
    fi
    
    check_dependencies
    validate_csv "$csv_file"
    get_config
    
    # Verify admin token works
    log_info "Verifying admin access..."
    local verify
    verify=$(curl -s "${LOON_URL}/api/users" \
        -H "Authorization: Bearer ${LOON_ADMIN_TOKEN}")
    
    if echo "$verify" | jq -e '.error' > /dev/null 2>&1; then
        log_error "Admin verification failed: $(echo "$verify" | jq -r '.error')"
        exit 1
    fi
    
    log_info "Admin access verified"
    
    # Process CSV
    local results_file="${csv_file}.results.csv"
    echo "username,role,password,status" > "$results_file"
    
    local total=0
    local success=0
    local failed=0
    
    # Skip header line
    tail -n +2 "$csv_file" | while IFS=, read -r username role password || [[ -n "$username" ]]; do
        # Trim whitespace and carriage returns
        username=$(echo "$username" | tr -d '\r' | xargs)
        role=$(echo "$role" | tr -d '\r' | xargs)
        password=$(echo "$password" | tr -d '\r' | xargs)
        
        if [[ -z "$username" || -z "$role" ]]; then
            continue
        fi
        
        ((total++)) || true
        
        log_info "Creating user: $username ($role)"
        
        local response
        response=$(create_user "$username" "$role" "$password")
        
        if echo "$response" | jq -e '.success' > /dev/null 2>&1; then
            local created_password
            created_password=$(echo "$response" | jq -r '.password // "provided"')
            echo "$username,$role,$created_password,created" >> "$results_file"
            ((success++)) || true
            log_info "  Created: $username (password: $created_password)"
        else
            local error
            error=$(echo "$response" | jq -r '.error // "unknown error"')
            echo "$username,$role,,failed: $error" >> "$results_file"
            ((failed++)) || true
            log_warn "  Failed: $username - $error"
        fi
    done
    
    echo ""
    log_info "Bulk creation complete"
    log_info "  Total: $total"
    log_info "  Success: $success"
    log_info "  Failed: $failed"
    log_info "  Results saved to: $results_file"
    
    if [[ $failed -gt 0 ]]; then
        log_warn "Some users failed to create. Check $results_file for details."
    fi
}

main "$@"
