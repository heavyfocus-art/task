# task

Public pages for ראש שקט:
- `index.html` — the worker's "done / not done" page (from the WhatsApp link)
- `app/` — download page for the Android app. On every new version: replace `app/RoshShaket.apk`,
  update the version number in `app/index.html`, and set `app/version.json` to `{"v":"<version>"}`
  (the apps read it to show "there's a new version").
- `pc/` — ראש שקט on a computer (manager: `index.html`, worker: `w.html` + `wshim.js`)
- `web/` — ראש שקט on roshshaket.com (version 29): sign in with a username and password, everything is kept in the
  Supabase database. `index.html` is the screen for the system manager and the managers, `r.html` is the worker's
  "done / not done" page from the WhatsApp link, `db.js` is the small database client both use.
  Published by Cloudflare Pages from this repo (build output directory: `web`). The database scripts are in the
  private repo `rosh-shaket`, folder `supabase/`.

