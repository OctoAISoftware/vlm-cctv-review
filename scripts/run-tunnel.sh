#!/usr/bin/env bash
# Public tunnel for the qwen35 review app.
#
# Tunnel evolution log:
#   1. Tried cloudflared quick tunnel — works but the trycloudflare.com
#      QUIC connection from this host kept failing
#      ("failed to accept QUIC stream: Application error 0x0"). Switching
#      to --protocol http2 made the quick tunnel endpoint reject the
#      request entirely.
#   2. Tried localtunnel — works, supports a stable subdomain, but shows
#      a scary "tunnel password" interstitial that asks visitors to
#      type the host's public IP. Looks like phishing. Rejected.
#   3. Tried ngrok — Octave already owns the single free-tier slot on
#      this host's ngrok account. Adding a second tunnel via free
#      ngrok requires a separate account.
#   4. Settled on bore.pub — open source Rust binary, no signup, no
#      interstitial. Cost: HTTP only (no auto-HTTPS), random remote
#      port, ugly URL like  http://bore.pub:NNNNN .
#
# Run via PM2:  pm2 start scripts/run-tunnel.sh --name qwen35-tunnel
# The chosen URL ends up in PM2's stdout AND in /tmp/qwen35-tunnel-url.txt
# for easy `cat`-and-share.

set -euo pipefail

PORT="${PORT:-3030}"
BORE_BIN="${HOME}/.local/bin/bore"

if [ ! -x "$BORE_BIN" ]; then
  echo "[tunnel] $BORE_BIN missing — install bore-cli first" >&2
  exit 1
fi

# bore prints "listening at bore.pub:NNNNN" once connected. We tee the
# log via a background watcher to /tmp/qwen35-tunnel-url.txt for easy
# external sharing.
(
  while true; do
    sleep 2
    URL=$(grep -oE 'bore\.pub:[0-9]+' /tmp/qwen35-bore.log 2>/dev/null | head -1)
    if [ -n "$URL" ]; then
      echo "http://$URL" > /tmp/qwen35-tunnel-url.txt
      break
    fi
  done
) &

# bore writes its own logs to stderr; pipe everything to PM2 stdout
# AND keep a copy at /tmp/qwen35-bore.log for the watcher above.
exec "$BORE_BIN" local "$PORT" --to bore.pub 2>&1 | tee /tmp/qwen35-bore.log
