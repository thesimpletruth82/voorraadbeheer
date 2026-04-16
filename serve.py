import http.server
import os

# Match the URL rewrites defined in vercel.json so local dev behaves identically.
REWRITES = {
    '/locations': '/pages/setup-locations.html',
    '/skus':      '/pages/setup-skus.html',
    '/opening':   '/pages/opening.html',
    '/closing':   '/pages/closing.html',
    '/overview':  '/pages/overview.html',
    '/sales':     '/pages/sales.html',
    '/movement':  '/pages/movement.html',
    '/variance':  '/pages/variance.html',
    '/login':     '/pages/login.html',
    '/signup':    '/pages/signup.html',
    '/users':     '/pages/users.html',
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Strip query string for rewrite matching
        path = self.path.split('?', 1)[0]
        if path in REWRITES:
            qs = self.path[len(path):]
            self.path = REWRITES[path] + qs
        return super().do_GET()


os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.test(HandlerClass=Handler, port=5500, bind="")
