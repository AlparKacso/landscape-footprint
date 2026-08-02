#!/usr/bin/env python3
"""Static server that refuses to let the browser cache anything.

`python3 -m http.server` sends no Cache-Control header at all, so browsers fall
back to heuristic caching and may serve a stale app.js or rulepack.json after
an edit. During a live demo that is a trap: you change a weight, refresh, and
nothing moves — not because the change is wrong but because the browser never
fetched it. Every response here is marked no-store so edit-then-refresh always
shows the edit.

    python3 tools/serve.py [port] [directory]
"""

import functools
import http.server
import socketserver
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(socketserver.TCPServer):
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(NoCacheHandler, directory=directory)

    with Server(("", port), handler) as httpd:
        print(f"Landscape Footprint  ->  http://localhost:{port}")
        print(f"Handbook             ->  http://localhost:{port}/handbook.html")
        print("\nNo-cache mode: edit a file, refresh, and you see the edit.")
        print("Ctrl-C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
