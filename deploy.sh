#!/usr/bin/env bash
#
# deploy.sh: deploy / update the face-attendance backend and dashboard on a VPS with Docker.
#
# Brings up two containers via Docker Compose (docker-compose.yml), both on the shared `web`
# network so the GLOBAL Caddy can reverse-proxy them by name:
#   * face-attendance-api        FastAPI backend, SQLite + face photos in the
#                                face-attendance-data volume      -> api.<domain>
#   * face-attendance-dashboard  Next.js lecturer dashboard        -> dashboard.<domain>
#                                and the public landing page      -> <domain>
#
# Usage:
#   ./deploy.sh              # first run: ask for the domain and settings, then build + start;
#                            # later runs: rebuild + restart (asks for the Resend API key and the
#                            # sender address first if .env does not have them yet)
#   ./deploy.sh --pull       # git pull first, then build + restart
#   ./deploy.sh --logs       # after a successful deploy, tail the logs
#   ./deploy.sh setup        # re-run the setup questions (rewrites .env, keeps JWT_SECRET)
#   ./deploy.sh test-email you@example.com   # send a test message with this server's email settings
#   ./deploy.sh app-links    # change the landing page's APK / TestFlight links (restart, no rebuild)
#   ./deploy.sh caddy        # print the Caddyfile blocks for this domain
#   ./deploy.sh seed         # load the demo data into an EMPTY database (demo logins, password123)
#   ./deploy.sh backup       # copy the database + face photos to ./backups/<timestamp>.tar.gz
#   ./deploy.sh rollback     # re-run the previous images (bad-deploy escape)
#   ./deploy.sh down         # stop + remove containers (the data volume is kept)
#
# Email: new accounts confirm their address with a code sent through Resend (https://resend.com).
# RESEND_API_KEY and EMAIL_FROM live in .env. Without a terminal, pass them in the environment:
#   RESEND_API_KEY=re_... EMAIL_FROM=no-reply@example.com ./deploy.sh
#
set -euo pipefail

# Always operate from the directory this script lives in (the repo root).
cd "$(dirname "$0")"

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

API_CONTAINER=face-attendance-api
WEB_CONTAINER=face-attendance-dashboard
IMAGES="face-attendance-api face-attendance-dashboard"
DATA_VOLUME=face-attendance-data

# --- Resolve the compose command (v2 plugin vs legacy v1) -------------------
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "Docker Compose not found. Install Docker Engine + the compose plugin."
fi
COMPOSE="$COMPOSE -f docker-compose.yml"

# --- Helpers ------------------------------------------------------------------
env_val() { [ -f "$1" ] && grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | tr -d '"' ; return 0; }

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 96 | tr -d '/+=\n' | cut -c1-"${1:-64}"
  else
    head -c 128 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-"${1:-64}"
  fi
}

# ask VAR "Prompt" "default": sets VAR from the answer, or the default on Enter.
ask() {
  local __var="$1" __prompt="$2" __default="${3:-}" __reply=""
  if [ -n "$__default" ]; then
    read -r -p "$__prompt [$__default]: " __reply || true
  else
    read -r -p "$__prompt: " __reply || true
  fi
  printf -v "$__var" '%s' "${__reply:-$__default}"
}
ask_required() {  # like ask, but keeps asking until there is an answer
  while :; do
    ask "$@"
    [ -n "${!1}" ] && return 0
    echo "  This one is needed."
  done
}
strip_host() { local h="$1"; h="${h#https://}"; h="${h#http://}"; printf '%s' "${h%%/*}"; }

# A value as it is written to .env: quoted when it has spaces ("Name <address>").
env_quote() { case "$1" in *[[:space:]]*) printf '"%s"' "$1" ;; *) printf '%s' "$1" ;; esac; }

# set_env KEY VALUE: replace that line of .env, or add it. Everything else is kept as it is.
set_env() {
  local tmp
  tmp="$(mktemp)"
  KEY="$1" LINE="$1=$(env_quote "$2")" awk '
    index($0, ENVIRON["KEY"] "=") == 1 { if (!done) print ENVIRON["LINE"]; done = 1; next }
    { print }
    END { if (!done) print ENVIRON["LINE"] }
  ' .env > "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
  chmod 600 .env
}

# ask_resend_key VAR [current]: what is typed is not shown. Enter keeps the current key, if any.
ask_resend_key() {
  local __var="$1" __current="${2:-}" __reply __eof
  echo "    New accounts confirm their email with a code sent through Resend (https://resend.com)."
  echo "    Create an API key at https://resend.com/api-keys (\"Sending access\" is enough) and paste it here."
  while :; do
    __reply=""; __eof=0
    if [ -n "$__current" ]; then
      read -r -s -p "Resend API key [Enter keeps the current one]: " __reply || __eof=1
    else
      read -r -s -p "Resend API key (starts with re_, hidden as you type): " __reply || __eof=1
    fi
    echo
    __reply="$(printf '%s' "$__reply" | tr -d '[:space:]')"
    __reply="${__reply:-$__current}"
    [ -n "$__reply" ] && break
    [ "$__eof" -eq 0 ] || die "No Resend API key given."
    echo "  This one is needed: without it nobody can create an account."
  done
  case "$__reply" in
    re_*) ;;
    *) warn "Resend API keys start with re_ and this one does not. Saved as typed: check it with ./deploy.sh test-email" ;;
  esac
  printf -v "$__var" '%s' "$__reply"
}

# ask_sender VAR default: the address confirmation emails come from.
ask_sender() {
  local __var="$1" __default="$2" __value
  echo "    The sender must be on a domain you have verified at https://resend.com/domains."
  while :; do
    ask __value "Send confirmation emails from" "$__default"
    case "$__value" in
      *@*.*) break ;;
    esac
    echo "  Enter an email address, e.g. no-reply@example.com"
    [ -t 0 ] || die "No sender address given."
  done
  printf -v "$__var" '%s' "$__value"
}
# ask_link VAR "Prompt" [current]: a web address, or nothing. Enter keeps the current one, "-" removes it.
ask_link() {
  local __var="$1" __prompt="$2" __current="${3:-}" __value
  while :; do
    if [ -n "$__current" ]; then
      ask __value "$__prompt (Enter keeps it, - removes it)" "$__current"
    else
      ask __value "$__prompt (Enter to skip)" ""
    fi
    __value="$(printf '%s' "$__value" | tr -d '[:space:]')"
    case "$__value" in
      -) __value=""; break ;;
      ""|https://*|http://*) break ;;
    esac
    echo "  Enter a link starting with https://, or press Enter to skip."
    [ -t 0 ] || die "Not a link: $__value"
  done
  printf -v "$__var" '%s' "$__value"
}

# ask_app_links APK_VAR TESTFLIGHT_VAR: the download links the landing page shows.
ask_app_links() {
  echo "    The landing page offers the phone app. Paste the links (an empty one shows \"coming soon\"):"
  echo "      Android: a direct link to the .apk file (e.g. the EAS build's \"Install\" artifact)."
  echo "      iPhone:  the public TestFlight link (https://testflight.apple.com/join/...)."
  ask_link "$1" "Android APK download link" "$(env_val .env ANDROID_APK_URL)"
  ask_link "$2" "iPhone TestFlight link" "$(env_val .env IOS_TESTFLIGHT_URL)"
}

backup_file() { [ -f "$1" ] && cp "$1" "$1.bak.$(date +%Y%m%d-%H%M%S)" && warn "Previous $1 kept as $1.bak.*"; return 0; }
interactive() { [ -t 0 ] || [ "${DEPLOY_INTERACTIVE:-0}" = "1" ]; }

api_host()  { strip_host "$(env_val .env PUBLIC_API_URL)"; }
dash_host() { strip_host "$(env_val .env DASHBOARD_URL)"; }
site_host() { strip_host "$(env_val .env SITE_URL)"; }

print_caddy() {
  cat <<EOF

    Add these to the global Caddyfile (Caddy must be on the 'web' network), then reload Caddy,
    e.g.  docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile

        $(api_host) {
            reverse_proxy $API_CONTAINER:8000
        }
        $(dash_host) {
            reverse_proxy $WEB_CONTAINER:3000
        }
        $(site_host) {
            reverse_proxy $WEB_CONTAINER:3000
        }

    The last one is the landing page ($(site_host) shows it; its other paths go to the dashboard).
    All three hostnames need DNS A/AAAA records pointing at this server.
    Mobile app (EAS build): point it at https://$(api_host)

EOF
}

# --- Setup ----------------------------------------------------------------------
setup_env() {
  echo
  log "Setup: the site addresses and secrets (.env)"
  echo "    The API is served on api.<domain>, the dashboard on dashboard.<domain>,"
  echo "    and a landing page with the app downloads on <domain> itself."
  local domain api dash site tz threshold jwt mail_key mail_from apk testflight
  ask_required domain "Base domain (without https://, e.g. example.com)" \
    "$(api_host | sed 's/^api\.//')"
  domain="$(strip_host "$domain")"
  ask api  "API hostname" "api.$domain"
  ask dash "Dashboard hostname" "dashboard.$domain"
  site="$(site_host)"
  ask site "Landing page hostname" "${site:-$domain}"
  api="$(strip_host "$api")"; dash="$(strip_host "$dash")"; site="$(strip_host "${site:-$domain}")"
  ask_app_links apk testflight
  ask tz "Time zone for statistics and CSV exports" "$(env_val .env DISPLAY_TIMEZONE || true)"
  tz="${tz:-Africa/Lagos}"
  ask threshold "Face match threshold (cosine distance, lower = stricter)" \
    "$(env_val .env FACE_DISTANCE_THRESHOLD || true)"
  threshold="${threshold:-0.30}"

  mail_key="$(env_val .env RESEND_API_KEY)"; mail_from="$(env_val .env EMAIL_FROM)"
  ask_resend_key mail_key "${mail_key:-${RESEND_API_KEY:-}}"
  mail_from="${mail_from:-${EMAIL_FROM:-}}"
  ask_sender mail_from "${mail_from:-no-reply@$domain}"

  # Keep an existing secret: changing it signs every user and every lecturer phone out.
  jwt="$(env_val .env JWT_SECRET)"
  if [ -z "$jwt" ] || [ "$jwt" = "dev-secret-change-me" ] || [ "${#jwt}" -lt 32 ]; then
    jwt="$(gen_secret 64)"
  fi

  backup_file .env
  cat > .env <<EOF
# Written by deploy.sh. Edit by hand or re-run: ./deploy.sh setup
# Changing a URL needs a rebuild (./deploy.sh): the dashboard bakes PUBLIC_API_URL in at build time.

# Public https URLs the global Caddy serves
PUBLIC_API_URL=https://$api
DASHBOARD_URL=https://$dash
# Browser origins allowed to call the API (the dashboard), comma-separated
CORS_ORIGINS=https://$dash

# The landing page (on SITE_URL) and its app links. Read at start-up: after editing these,
# restart with ./deploy.sh app-links (or: docker compose up -d dashboard). No rebuild needed.
SITE_URL=https://$site
ANDROID_APK_URL=$apk
IOS_TESTFLIGHT_URL=$testflight

# Signs login tokens. Changing it signs everyone out, including lecturer phones.
JWT_SECRET=$jwt
DISPLAY_TIMEZONE=$tz
FACE_DISTANCE_THRESHOLD=$threshold

# Email: confirmation codes for new accounts are sent through Resend (https://resend.com).
# EMAIL_FROM must be on a domain verified in Resend ("Name <address>" in quotes also works).
# Check both with: ./deploy.sh test-email you@example.com
RESEND_API_KEY=$mail_key
EMAIL_FROM=$(env_quote "$mail_from")

# Legacy server-side recognition for old app versions that upload photos only.
# Needs the big image: set both to true and redeploy (~1 GB more, 200 MB weights on first start).
WITH_DEEPFACE=false
FACE_LEGACY=false
EOF
  chmod 600 .env
  log "Wrote .env (API https://$api, dashboard https://$dash, landing page https://$site, email from $mail_from)"
  MAIL_NEW=1
}

# --- Email settings ---------------------------------------------------------------
# A .env written before email confirmation existed has no RESEND_API_KEY / EMAIL_FROM. They are
# asked for once (or taken from the environment) and added to .env; nothing else in it changes.
mail_ok() { [ -n "$(env_val .env RESEND_API_KEY)" ] && [ -n "$(env_val .env EMAIL_FROM)" ]; }

ensure_mail_env() {
  local key from
  key="$(env_val .env RESEND_API_KEY)"; from="$(env_val .env EMAIL_FROM)"
  key="${key:-${RESEND_API_KEY:-}}"; from="${from:-${EMAIL_FROM:-}}"
  if [ -z "$key" ] || [ -z "$from" ]; then
    interactive || die "Email is not set up and there is no terminal to ask on. Add RESEND_API_KEY=re_... and EMAIL_FROM=no-reply@<a domain verified in Resend> to .env, or pass them in the environment, then run ./deploy.sh again."
    echo
    log "Email: the Resend API key and sender address (.env)"
    [ -n "$key" ] || ask_resend_key key
    [ -n "$from" ] || ask_sender from "no-reply@$(dash_host | sed 's/^dashboard\.//')"
  fi
  grep -q -E '^(RESEND_API_KEY|EMAIL_FROM)=' .env \
    || printf '\n# Email: confirmation codes for new accounts are sent through Resend (https://resend.com).\n# EMAIL_FROM must be on a domain verified in Resend. Check both with: ./deploy.sh test-email you@example.com\n' >> .env
  set_env RESEND_API_KEY "$key"
  set_env EMAIL_FROM "$from"
  log "Saved the email settings to .env (sending from $from)"
  MAIL_NEW=1
}

# --- Landing page settings --------------------------------------------------------
# A .env written before the landing page existed has no SITE_URL: it is the root of the dashboard's
# domain. The app links are asked for once when there is a terminal; they can be added later too.
ensure_site_env() {
  local site apk testflight
  site="$(dash_host | sed 's/^dashboard\.//')"
  grep -q -E '^SITE_URL=' .env \
    || printf '\n# The landing page (on SITE_URL) and its app links. Change the links with: ./deploy.sh app-links\n' >> .env
  set_env SITE_URL "https://$site"
  if interactive; then
    echo
    log "Landing page: https://$site shows the dashboard sign-in and the app downloads"
    ask_app_links apk testflight
  fi
  set_env ANDROID_APK_URL "${apk:-}"
  set_env IOS_TESTFLIGHT_URL "${testflight:-}"
  log "Saved the landing page settings to .env"
  SITE_NEW=1
}

env_ok() {
  local jwt api dash
  jwt="$(env_val .env JWT_SECRET)"
  api="$(env_val .env PUBLIC_API_URL)"; dash="$(env_val .env DASHBOARD_URL)"
  case "$api"  in https://*) ;; *) return 1 ;; esac
  case "$dash" in https://*) ;; *) return 1 ;; esac
  case "$api" in https://api.example.com) return 1 ;; esac   # the .env.example template
  [ -n "$jwt" ] && [ "$jwt" != "dev-secret-change-me" ] && [ "${#jwt}" -ge 32 ]
}

# --- Health wait (shared by deploy and rollback) ---------------------------------
# No host ports to curl, so probe from inside the containers: the API's own /health, then
# the dashboard's home page, then the API by name from the dashboard (proves both share `web`).
wait_healthy() {
  log "Waiting for the API and the dashboard to answer..."
  for _ in $(seq 1 45); do
    if docker exec "$API_CONTAINER" python -c \
         "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" \
         >/dev/null 2>&1 \
       && docker exec "$WEB_CONTAINER" wget -q -O /dev/null http://127.0.0.1:3000/ >/dev/null 2>&1 \
       && docker exec "$WEB_CONTAINER" wget -q -O /dev/null "http://$API_CONTAINER:8000/health" >/dev/null 2>&1; then
      log "API and dashboard are up."
      return 0
    fi
    sleep 2
  done
  return 1
}

# --- Subcommands ----------------------------------------------------------------
case "${1:-}" in
  down)
    log "Stopping the stack (the $DATA_VOLUME volume is preserved)..."
    # Compose will not read docker-compose.yml without the email settings; stopping does not use them
    [ -n "$(env_val .env RESEND_API_KEY)" ] || export RESEND_API_KEY="${RESEND_API_KEY:-unset}"
    [ -n "$(env_val .env EMAIL_FROM)" ] || export EMAIL_FROM="${EMAIL_FROM:-unset}"
    $COMPOSE down
    exit 0
    ;;
  setup)
    interactive || die "setup needs a terminal to ask on."
    setup_env
    print_caddy
    log "Setup done. Deploy with: ./deploy.sh"
    exit 0
    ;;
  caddy)
    env_ok || die "Not set up yet: run ./deploy.sh setup"
    print_caddy
    exit 0
    ;;
  app-links)
    env_ok || die "Not set up yet: run ./deploy.sh setup"
    interactive || die "app-links needs a terminal to ask on. Or edit ANDROID_APK_URL / IOS_TESTFLIGHT_URL in .env, then: $COMPOSE up -d dashboard"
    [ -n "$(env_val .env SITE_URL)" ] || set_env SITE_URL "https://$(dash_host | sed 's/^dashboard\.//')"
    ask_app_links apk testflight
    set_env ANDROID_APK_URL "$apk"
    set_env IOS_TESTFLIGHT_URL "$testflight"
    if docker ps --format '{{.Names}}' | grep -qx "$WEB_CONTAINER"; then
      log "Restarting the dashboard with the new links..."
      $COMPOSE up -d --no-build --no-deps dashboard
    fi
    log "Saved. The landing page: $(env_val .env SITE_URL)"
    exit 0
    ;;
  test-email)
    [ -n "${2:-}" ] || die "Usage: ./deploy.sh test-email you@example.com"
    docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER" || die "The API is not running: ./deploy.sh first."
    # Sends through Resend with the running API's own settings and prints Resend's answer
    docker exec "$API_CONTAINER" python -m app.mailer "$2"
    exit 0
    ;;
  seed)
    docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER" || die "The API is not running: ./deploy.sh first."
    warn "This loads DEMO accounts (lecturer ao.bello@ui.edu.ng, students CSC/2021/001..008) with the"
    warn "public password 'password123' into a PUBLIC server. It does nothing if data already exists."
    ask confirm "Type 'seed' to continue" ""
    [ "$confirm" = "seed" ] || die "Cancelled."
    docker exec "$API_CONTAINER" python -m app.seed
    exit 0
    ;;
  backup)
    docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1 || die "No $DATA_VOLUME volume yet: nothing to back up."
    mkdir -p backups
    out="backups/face-attendance-$(date +%Y%m%d-%H%M%S).tar.gz"
    log "Backing up $DATA_VOLUME to $out ..."
    # A live database is copied with SQLite's backup API (consistent while the API writes);
    # a stopped one is safe to copy as it is.
    excludes=()
    if docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER"; then
      docker exec "$API_CONTAINER" python -c \
        "import sqlite3; s=sqlite3.connect('/data/attendance.db'); d=sqlite3.connect('/data/attendance.backup.db'); s.backup(d); d.close(); s.close()"
      excludes=(--exclude=./attendance.db --exclude=./attendance.db-journal --exclude=./attendance.db-wal)
    fi
    docker run --rm -v "$DATA_VOLUME":/data:ro -v "$PWD/backups":/out alpine \
      tar czf "/out/$(basename "$out")" -C /data ${excludes[@]+"${excludes[@]}"} .
    docker exec "$API_CONTAINER" rm -f /data/attendance.backup.db >/dev/null 2>&1 || true
    chmod 600 "$out"
    log "Done: $out (a live backup holds the database as attendance.backup.db: restore it as attendance.db). It holds biometric data: keep it private."
    exit 0
    ;;
  rollback)
    for img in $IMAGES; do
      docker image inspect "$img:previous" >/dev/null 2>&1 \
        || die "No $img:previous image: nothing to roll back to."
    done
    log "Rolling back to the previous images..."
    for img in $IMAGES; do docker tag "$img:previous" "$img:latest"; done
    $COMPOSE up -d --no-build
    wait_healthy || { $COMPOSE logs --tail=50; die "Rollback started but the health check failed."; }
    $COMPOSE ps
    exit 0
    ;;
esac

# --- Parse flags ------------------------------------------------------------
PULL=0
TAIL=0
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=1 ;;
    --logs) TAIL=1 ;;
    *) warn "ignoring unknown argument: $arg" ;;
  esac
done

# --- Optionally pull the latest code ----------------------------------------
if [ "$PULL" -eq 1 ]; then
  if git rev-parse --git-dir >/dev/null 2>&1; then
    log "Pulling latest code..."
    before="$(git rev-parse HEAD)"
    git pull --ff-only
    # Bash reads a script incrementally, so a pull that rewrites THIS file mid-run would execute
    # a mix of both versions. Re-exec the pulled version, at most once.
    if [ "$(git rev-parse HEAD)" != "$before" ] && [ "${DEPLOY_REEXEC:-0}" != "1" ]; then
      log "Code changed: restarting deploy.sh so this deploy runs one version..."
      args=(); for a in "$@"; do [ "$a" = "--pull" ] || args+=("$a"); done
      DEPLOY_REEXEC=1 exec "$0" ${args[@]+"${args[@]}"}
    fi
  else
    warn "--pull requested but this isn't a git checkout; skipping."
  fi
fi

# --- First-run setup ------------------------------------------------------------
if ! env_ok; then
  interactive || die "Not set up yet and no terminal to ask on. Run ./deploy.sh setup interactively, or write .env by hand from .env.example."
  setup_env
  FIRST_RUN=1
fi

# --- Email settings (a .env from before email confirmation does not have them) ---
mail_ok || ensure_mail_env

# --- Landing page (a .env from before it existed has no SITE_URL) -----------------
[ -n "$(env_val .env SITE_URL)" ] || ensure_site_env

# --- Preflight ----------------------------------------------------------------
docker network inspect web >/dev/null 2>&1 \
  || die "Docker network 'web' does not exist. It is the network your global Caddy is on: docker network create web"

if [ "$(env_val .env FACE_LEGACY)" = "true" ] && [ "$(env_val .env WITH_DEEPFACE)" != "true" ]; then
  die "FACE_LEGACY=true needs WITH_DEEPFACE=true in .env (the slim image has no DeepFace)."
fi

# --- Build & start ----------------------------------------------------------
# Keep the running images as :previous so `./deploy.sh rollback` can restore them.
for img in $IMAGES; do
  if docker image inspect "$img:latest" >/dev/null 2>&1; then
    docker tag "$img:latest" "$img:previous"
  fi
done

log "Building images (API, and the dashboard against $(env_val .env PUBLIC_API_URL))..."
$COMPOSE build

log "Starting the stack..."
$COMPOSE up -d --remove-orphans

# --- Wait for the site to answer ----------------------------------------------
if wait_healthy; then
  $COMPOSE ps
  if [ "${FIRST_RUN:-0}" = "1" ]; then
    print_caddy
  elif [ "${SITE_NEW:-0}" = "1" ]; then
    echo
    echo "    New: the landing page. Add this to the global Caddyfile and reload Caddy (and point DNS for"
    echo "    $(site_host) at this server):"
    echo
    echo "        $(site_host) {"
    echo "            reverse_proxy $WEB_CONTAINER:3000"
    echo "        }"
    echo
  fi
  log "Site:      $(env_val .env SITE_URL)"
  log "API:       $(env_val .env PUBLIC_API_URL)/health"
  log "Dashboard: $(env_val .env DASHBOARD_URL)"
  log "Email:     confirmation codes are sent from $(env_val .env EMAIL_FROM) through Resend"
  if [ "${MAIL_NEW:-0}" = "1" ]; then
    echo "    Check that email arrives: ./deploy.sh test-email you@example.com"
  fi
  if [ "$TAIL" -eq 1 ]; then
    exec $COMPOSE logs -f
  fi
  exit 0
fi

warn "The stack did not become healthy within ~90s. Recent logs:"
$COMPOSE logs --tail=50
die "Deployment failed the health check: roll back with ./deploy.sh rollback"
