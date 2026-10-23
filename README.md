# task

Public pages for ראש שקט:
- `index.html` — the worker's "done / not done" page (from the WhatsApp link)
- `app/` — download page for the Android app. On every new version: replace `app/RoshShaket.apk`,
  update the version number in `app/index.html`, and set `app/version.json` to `{"v":"<version>"}`
  (the apps read it to show "there's a new version").
- `pc/` — ראש שקט on a computer (manager: `index.html`, worker: `w.html` + `wshim.js`)
