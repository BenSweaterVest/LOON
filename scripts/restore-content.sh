#!/bin/bash
# =============================================================================
# LOON Content Restore Script
# =============================================================================
# Restores content from a backup file created by backup-content.sh
#
# Usage:
#   ./restore-content.sh backup.json              # Restore all pages
#   ./restore-content.sh backup.json page_id      # Restore specific page
#   ./restore-content.sh --list backup.json       # List pages in backup
#
# Prerequisites:
#   - jq (for JSON processing)
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
if ! command -v jq &> /dev/null; then
    log_error "jq is required. Install with: brew install jq (Mac) or apt-get install jq (Linux)"
    exit 1
fi

# Show usage
usage() {
    echo "Usage:"
    echo "  $0 <backup.json>              Restore all pages"
    echo "  $0 <backup.json> <page_id>    Restore specific page"
    echo "  $0 --list <backup.json>       List pages in backup"
    exit 1
}

# List pages in backup
list_pages() {
    local backup_file="$1"
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi
    
    echo "Pages in backup:"
    echo "================"
    jq -r '.pages | keys[]' "$backup_file" | while read -r page_id; do
        local modified=$(jq -r ".pages.\"$page_id\"._meta.lastModified // \"unknown\"" "$backup_file")
        echo "  - $page_id (modified: $modified)"
    done
    
    local timestamp=$(jq -r '.backup_timestamp // "unknown"' "$backup_file")
    echo ""
    echo "Backup created: $timestamp"
}

# Restore a single page
restore_page() {
    local backup_file="$1"
    local page_id="$2"
    
    # Check if page exists in backup
    if ! jq -e ".pages.\"$page_id\"" "$backup_file" > /dev/null 2>&1; then
        log_error "Page '$page_id' not found in backup"
        return 1
    fi
    
    # Create directory if needed
    mkdir -p "data/$page_id"
    
    # Extract and save content
    jq ".pages.\"$page_id\"" "$backup_file" > "data/$page_id/content.json"
    
    log_info "Restored: $page_id"
}

# Restore all pages
restore_all() {
    local backup_file="$1"
    local count=0
    
    log_warn "This will overwrite existing content files."
    read -p "Continue? (y/N) " confirm
    
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        log_info "Restore cancelled."
        exit 0
    fi
    
    for page_id in $(jq -r '.pages | keys[]' "$backup_file"); do
        restore_page "$backup_file" "$page_id"
        count=$((count + 1))
    done
    
    log_info "Restored $count pages."
    echo ""
    echo "Next steps:"
    echo "  1. Review changes: git diff"
    echo "  2. Commit: git add data/ && git commit -m 'Restore from backup'"
    echo "  3. Push to deploy: git push"
}

# Main
case "${1:-}" in
    --list)
        [[ -z "${2:-}" ]] && usage
        list_pages "$2"
        ;;
    --help|-h)
        usage
        ;;
    "")
        usage
        ;;
    *)
        backup_file="$1"
        
        if [[ ! -f "$backup_file" ]]; then
            log_error "Backup file not found: $backup_file"
            exit 1
        fi
        
        if [[ -n "${2:-}" ]]; then
            # Restore specific page
            restore_page "$backup_file" "$2"
        else
            # Restore all
            restore_all "$backup_file"
        fi
        ;;
esac
