#!/bin/bash
# Deploy local site files to the live FTP server.
# Usage:
#   ./deploy.sh --dry-run   preview what would upload, no changes made
#   ./deploy.sh             actually upload changed files
set -euo pipefail

HOST="50.6.42.22"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/"

DRYRUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRYRUN="--dry-run"
fi

lftp -e "
set ftp:ssl-allow yes;
set ftp:ssl-force no;
set ssl:verify-certificate no;
open $HOST;
mirror -R $DRYRUN --verbose --exclude-glob .git/ --exclude-glob .gitignore --exclude-glob README.md --exclude-glob CNAME --exclude-glob deploy.sh --exclude-glob .DS_Store --exclude-glob apps-script/ --exclude-glob *.xlsx --exclude-glob *.pDF --exclude-glob *.pdf $LOCAL_DIR /;
bye
"
