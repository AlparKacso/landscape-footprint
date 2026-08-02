#!/bin/bash
# Double-click this in Finder to run the footprint.
#
# The prototype has no build step, but it does need to be served: browsers
# block both ES modules and fetch on a file:// origin, so opening index.html
# directly gives you a blank page. This starts a static server and opens it.

cd "$(dirname "$0")" || exit 1

# Starts at 8010 rather than 8000 so this can run alongside an earlier build
# without either of them having to be shut down first.
PORT=8010
while lsof -i ":$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt 8030 ]; then
    echo "Could not find a free port between 8010 and 8030."
    read -r -p "Press return to close."
    exit 1
  fi
done

echo "Landscape Footprint  ->  http://localhost:$PORT"
echo "Handbook             ->  http://localhost:$PORT/handbook.html"
echo
echo "Close this window or press Ctrl-C to stop the server."
echo

python3 tools/serve.py "$PORT" . >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

sleep 1
open "http://localhost:$PORT"
wait $SERVER
