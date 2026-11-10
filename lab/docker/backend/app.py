# Tiny backend: /ok 200, /500 500, /slow hangs 30s.
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        p = self.path.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        if p == "slow":
            time.sleep(30)
        code = 500 if p == "500" else 200
        body = b"backend error\n" if code == 500 else b"ok\n"
        self.send_response(code)
        self.send_header("content-type", "text/plain")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    do_POST = do_GET
    def log_message(self, *a): pass

ThreadingHTTPServer(("0.0.0.0", 9000), H).serve_forever()
