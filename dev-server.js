"use strict";
// Tiny static server for local testing. `npm run dev` -> http://localhost:5000
const http = require("http");
const fs = require("fs");
const path = require("path");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const root = path.join(__dirname, "public");

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const file = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    fs.createReadStream(file).pipe(res);
  })
  .listen(Number(process.env.PORT) || 5000, function () {
    console.log("Orbit Lab on http://localhost:" + this.address().port);
  });
