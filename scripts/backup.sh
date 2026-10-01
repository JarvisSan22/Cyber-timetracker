#!/bin/sh
# Nightly backup: download a consistent copy of the SQLite file, keep the last 14.
# Cron (on the Pi):  15 3 * * * /home/pi/hobby-tracker/scripts/backup.sh >> /home/pi/tracker-backups/backup.log 2>&1
set -eu

URL="${TRACKER_URL:-http://localhost:8686}"
DIR="${BACKUP_DIR:-$HOME/tracker-backups}"
KEEP="${KEEP:-14}"

mkdir -p "$DIR"
file="$DIR/tracker-$(date +%Y%m%d-%H%M%S).db"
curl -fsS --max-time 120 -o "$file.part" "$URL/api/backup"
mv "$file.part" "$file"
echo "$(date -Iseconds) saved $file"

# Delete everything but the newest $KEEP backups.
ls -1t "$DIR"/tracker-*.db 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old"
done
