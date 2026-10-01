#!/bin/sh
# One-time setup on the Raspberry Pi: checks Docker, writes .env, builds and
# starts the container, waits until it is healthy, and offers to add the
# nightly backup to cron. Safe to run again (it rebuilds and restarts).
#
#   cd ~/cyber-tracker && ./scripts/install-pi.sh
set -eu

cd "$(dirname "$0")/.."
REPO="$(pwd)"

ask() {  # ask "Question" -> 0 for yes (default), 1 for no
  printf '%s [Y/n] ' "$1"
  read -r reply || reply=""
  case "$reply" in [nN]*) return 1 ;; *) return 0 ;; esac
}

echo "== Cyber Tracker: Raspberry Pi install"

# 1. CPU architecture
arch="$(uname -m)"
case "$arch" in
  aarch64) echo "Architecture: $arch (64-bit OS, recommended)" ;;
  armv7l)  echo "Architecture: $arch (32-bit OS). It works, but the 64-bit Raspberry Pi OS is recommended." ;;
  *)       echo "Architecture: $arch (not a Raspberry Pi? continuing anyway)" ;;
esac

# 2. Docker and the compose plugin
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed."
  if ask "Install Docker now with the official script from get.docker.com?"; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    echo
    echo "Docker installed. Log out and back in (or reboot) so your user can run docker,"
    echo "then run this script again: $REPO/scripts/install-pi.sh"
    exit 0
  fi
  echo "Install Docker first: https://docs.docker.com/engine/install/raspberry-pi-os/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Your user cannot talk to Docker. Run: sudo usermod -aG docker $USER, log out and back in, then retry."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "The docker compose plugin is missing. Run: sudo apt-get install -y docker-compose-plugin"
  exit 1
fi

# 3. .env with this user's uid/gid
if [ ! -f .env ]; then
  sed -e "s/^PUID=.*/PUID=$(id -u)/" -e "s/^PGID=.*/PGID=$(id -g)/" .env.example > .env
  echo "Created .env (edit it to change the port or timezone)."
fi
PORT="$(sed -n 's/^TRACKER_PORT=//p' .env | tail -n 1)"
PORT="${PORT:-8686}"

# 4. Data folder owned by this user (the container runs as PUID:PGID)
mkdir -p data
if [ "$(stat -c %u data)" != "$(id -u)" ]; then
  echo "Fixing ownership of ./data (needs sudo)."
  sudo chown -R "$(id -u):$(id -g)" data
fi

# 5. Build and start. The first build on a Pi 3 takes a few minutes.
echo "Building and starting the container..."
docker compose up -d --build

printf 'Waiting for the app to become healthy'
i=0
until curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo
    echo "The app did not answer within 2 minutes. Check: docker compose logs --tail 50"
    exit 1
  fi
  printf '.'
  sleep 2
done
echo " ok"

# 6. Nightly backup at 03:15
CRON_LINE="15 3 * * * TRACKER_URL=http://localhost:$PORT $REPO/scripts/backup.sh >> $HOME/tracker-backups/backup.log 2>&1"
if crontab -l 2>/dev/null | grep -q "scripts/backup.sh"; then
  echo "Nightly backup is already in crontab."
elif ask "Add a nightly backup at 03:15 to your crontab (keeps the last 14 in ~/tracker-backups)?"; then
  mkdir -p "$HOME/tracker-backups"
  { crontab -l 2>/dev/null || true; echo "$CRON_LINE"; } | crontab -
  echo "Backup added to crontab."
fi

# 7. Where to open it
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Done. Open the app on any device on your home network:"
echo "  http://${IP:-<pi-ip>}:$PORT"
echo "Give the Pi a fixed IP in your router (DHCP reservation) so this address never changes."
