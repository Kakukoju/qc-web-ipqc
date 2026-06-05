#!/bin/bash
# Scheduled Excel auto-import from SMB shares — cron nightly at 00:00
# Source paths:
#   \\fls341\MBBU_FAB\MB_QA\Dora\6.QBi Beads IPQC\YYYY
#   \\fls341\MBBU_FAB\MB_QA\Dora\2.Disk A\YYYY年度IPQC化學特性批次紀錄
# Only uploads YYYY*.xlsx (YYYY = current year)

API_URL="http://127.0.0.1:3201/api/excel-import/upload-batch"
LOG="/tmp/scheduled-import.log"
YYYY=$(date +%Y)

# SMB mount config
SMB_SERVER="//fls341/MBBU_FAB"
SMB_MOUNT="/mnt/mbbu_fab"
SMB_CREDS="/etc/smb-ipqc-credentials"
SMB_OPTS="credentials=${SMB_CREDS},iocharset=utf8,file_mode=0644,dir_mode=0755,vers=3.0"

# Sub-paths under the share
DIR_QBI="MB_QA/Dora/6.QBi Beads IPQC/${YYYY}"
DIR_DISKA="MB_QA/Dora/2.Disk A/${YYYY}年度IPQC化學特性批次紀錄"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "=== Starting scheduled import (year=$YYYY) ==="

# Mount if not already mounted
if ! mountpoint -q "$SMB_MOUNT" 2>/dev/null; then
  mkdir -p "$SMB_MOUNT"
  mount -t cifs "$SMB_SERVER" "$SMB_MOUNT" -o "$SMB_OPTS" 2>>"$LOG"
  if [ $? -ne 0 ]; then
    log "ERROR: Failed to mount $SMB_SERVER"
    exit 1
  fi
  log "Mounted $SMB_SERVER → $SMB_MOUNT"
fi

# Collect matching xlsx files from both directories
FILES=()
for SUBDIR in "$DIR_QBI" "$DIR_DISKA"; do
  FULL_PATH="$SMB_MOUNT/$SUBDIR"
  if [ ! -d "$FULL_PATH" ]; then
    log "WARN: Directory not found: $FULL_PATH"
    continue
  fi
  while IFS= read -r -d '' f; do
    FILES+=("$f")
  done < <(find "$FULL_PATH" -maxdepth 1 -name "${YYYY}*.xlsx" ! -name '~\$*' -print0)
done

if [ ${#FILES[@]} -eq 0 ]; then
  log "No matching files found, skipping."
  exit 0
fi

log "Found ${#FILES[@]} files to upload"

# Upload in chunks of 20 to avoid timeout
CHUNK=20
for ((i=0; i<${#FILES[@]}; i+=CHUNK)); do
  CURL_ARGS=()
  for ((j=i; j<i+CHUNK && j<${#FILES[@]}; j++)); do
    CURL_ARGS+=(-F "files=@${FILES[$j]}")
  done

  RESPONSE=$(curl -s -m 300 -w "\n%{http_code}" "${CURL_ARGS[@]}" "$API_URL")
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  log "Chunk $((i/CHUNK+1)): HTTP $HTTP_CODE | Files: ${#CURL_ARGS[@]} / 2"
done

log "=== Import complete ==="
