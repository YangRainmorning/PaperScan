# tools

## `browser-check.mjs`

Unit tests cover the algorithm; they cannot tell you whether the file input, the worker, the
blob URL, or the download link are wired up correctly. This script drives a real Chrome over
the DevTools Protocol and checks the whole path.

It needs no dependencies — Node's built-in `fetch` and `WebSocket` are enough — so it does not
drag Playwright into a project whose entire bundle is 34 KB.

### Usage

```bash
# 1. build and serve the app
npm run build
npm run preview &

# 2. start a Chrome with remote debugging on a throwaway profile
chrome --headless=new --remote-debugging-port=9222 \
       --user-data-dir=/tmp/ps-profile about:blank &

# 3. drive it
node tools/browser-check.mjs http://localhost:4173/ ./some-photo.jpg /tmp/report
node tools/browser-check.mjs http://localhost:4173/ ./some-photo.jpg /tmp/report --rotate 1
```

It writes `/tmp/report.png` (a screenshot of the finished page) and `/tmp/report.json`
(timings, the stats the UI is showing, the suggested download name, and every console
message and uncaught exception).

Exit code is 0 only when the page reached the result state, every requested rotation
finished, and nothing threw.

### Notes

- `--headless=new` is fine; nothing here needs a visible window.
- The port and the timeout are configurable with `CDP_ENDPOINT` and `CDP_TIMEOUT_MS`.
- On Windows, Chrome will not accept a named pipe for the debugging endpoint over some
  shells — use the TCP port as shown.
- Deleting the `--user-data-dir` between runs keeps the profile clean; leaving it in place is
  faster but the page may open with the previous run's state.
