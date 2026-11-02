# 로컬 확인용 정적 서버. python -m http.server와 같지만 캐시를 끈다
# (수정한 파일이 브라우저에 예전 버전으로 남아 보이는 걸 막는다. 배포 서버도 no-cache다).
# 사용: python tools/dev_server.py 8830
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8830
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(NoCacheHandler, directory=ROOT)
with http.server.ThreadingHTTPServer(("", PORT), handler) as httpd:
    print(f"http://localhost:{PORT}/")
    httpd.serve_forever()
