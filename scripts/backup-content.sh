#!/bin/bash
# =============================================================================
# LOON Content Backup Script
# =============================================================================
# Exports all content.json files from the repository for backup purposes.
#
# Usage:
#   ./backup-content.sh                    # Backup to timestamped file
#   ./backup-content.sh my-backup.json     # Backup to specific file
#
# Output: JSON file containing all page content with metadata
#
# Prerequisites:
#   - git (to access repository)
#   - jq (for JSON processing)
# =============================================================================

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="${1:-${BACKUP_DIR}/loon_backup_${TIMESTAMP}.json}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check dependencies
check_dependencies() {
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed."
        echo "Install with: brew install jq (Mac) or apt-get install jq (Linux)"
        exit 1
    fi
}

# Main backup function
backup_content() {
    log_info "Starting LOON content backup..."
    
    # Create backup directory if needed
    mkdir -p "$(dirname "$OUTPUT_FILE")"
    
    # Start JSON object
    echo '{' > "$OUTPUT_FILE"
    echo '  "backup_timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",' >> "$OUTPUT_FILE"
    echo '  "pages": {' >> "$OUTPUT_FILE"
    
    # Find all content.json files in data/
    local first=true
    local count=0
    
    for content_file in data/*/content.json; do
        if [[ -f "$content_file" ]]; then
            # Extract page ID from path
            local page_id=$(basename $(dirname "$content_file"))
            
            # Add comma separator (except for first item)
            if [[ "$first" == "true" ]]; then
                first=false
            else
                echo ',' >> "$OUTPUT_FILE"
            fi
            
            # Add page content
            echo -n "    \"$page_id\": " >> "$OUTPUT_FILE"
            cat "$content_file" >> "$OUTPUT_FILE"
            
            count=$((count + 1))
            log_info "  Backed up: $page_id"
        fi
    done
    
    # Close JSON structure
    echo '' >> "$OUTPUT_FILE"
    echo '  }' >> "$OUTPUT_FILE"
    echo '}' >> "$OUTPUT_FILE"
    
    # Validate JSON
    if jq empty "$OUTPUT_FILE" 2>/dev/null; then
        log_info "Backup complete: $OUTPUT_FILE"
        log_info "Total pages backed up: $count"
    else
        log_error "Generated JSON is invalid. Check for syntax errors."
        exit 1
    fi
}

# Restore function (for reference)
show_restore_instructions() {
    echo ""
    echo "To restore from this backup:"
    echo "  1. Extract pages: jq -r '.pages.PAGE_ID' $OUTPUT_FILE > data/PAGE_ID/content.json"
    echo "  2. Or restore all: see scripts/restore-content.sh"
    echo ""
}

# Run
check_dependencies
backup_content
show_restore_instructions
