# PCFL Network — Pure College Football League

ESPN-style college football portal for the PCFL, an FBPro98 simulation league.
**Live site: https://pcfl2k.github.io/PCFL-Football/**

Every score, ranking, standing, stat line, roster, story and broadcast on the site is
generated automatically from raw FBPro98 weekly exports — the commissioner uploads once
and everything updates.

## How a week gets published

```
FBPro98 weekly export folder
        │
        ▼
tools\Publish-PCFLWeek.ps1     (validate → copy to drops/ → parse → commit → push)
        │
        ▼
GitHub Actions (weekly-update.yml)
  • refreshes the PCFL Network YouTube feed
  • re-parses every drop into JSON  (scripts/parse-fbpro.mjs)
  • commits /data and deploys to GitHub Pages
        │
        ▼
https://pcfl2k.github.io/PCFL-Football/   — week selector, scores, stories,
rankings, standings, stats hub, team pages, game centers, awards, media
```

### Commissioner quick start

```powershell
cd PCFL-Football
.\tools\Publish-PCFLWeek.ps1            # opens a folder picker
# or fully explicit:
.\tools\Publish-PCFLWeek.ps1 -Folder "C:\exports\reports-wk3" -Season 2028 -Week 3
```

Required files in the export folder: `gamestats.html`, `standings.html`,
`schedule.html`, `season.html`. Optional: `rosters.html`, `teamstats.html`.

To fix a past week (e.g. after a re-sim), just re-export and publish the same
week number again — the drop is overwritten and the whole site regenerates.

## Repository layout

```
index.html            single-page app shell (hash-routed, zero build step)
css/site.css          design system (broadcast/ESPN theme)
js/app.js             router, state, week engine, all views
data/                 generated JSON  — never edit by hand
  manifest.json       seasons + weeks available
  teams.json          team metadata (colors, divisions, aliases)
  videos.json         PCFL Network YouTube feed cache (auto-mapped to games)
  2028/week<N>.json   games, box scores, standings, power poll, leaders, stories
  2028/schedule.json  full 15-week schedule incl. playoff rounds
  2028/rosters.json   full rosters with FBPro98 ratings (OVR computed)
drops/                raw FBPro98 exports, archived per season/week
scripts/parse-fbpro.mjs   the parser/story engine (Node 18+, no dependencies)
tools/Publish-PCFLWeek.ps1  one-click commissioner publisher
.github/workflows/weekly-update.yml   CI: parse + deploy to Pages
assets/logos          team logos (light + dark variants, stored locally)
assets/brand          PCFL logo assets
```

## Environments: staging → production

| Environment | Branch | URL |
|---|---|---|
| **Production** | `main` | https://pcfl2k.github.io/PCFL-Football/ |
| **Staging** | `staging` | https://pcfl2k.github.io/PCFL-Football/staging/ |

Both are built and deployed together by the same workflow. The staging build shows a
gold **STAGING** ribbon so it can never be confused with production.

Iterating on the site (design/code changes — not weekly data drops):

```powershell
git checkout staging
# ...make changes...
git commit -am "describe the change"
git push origin staging          # deploys to /staging/ only
# verify at https://pcfl2k.github.io/PCFL-Football/staging/
git checkout main
git merge staging
git push origin main             # promotes to production
```

Weekly data drops via `Publish-PCFLWeek.ps1` go straight to `main` (production),
since they are league results, not site changes.

## Local development

```powershell
node scripts/parse-fbpro.mjs     # regenerate data from drops/
npx http-server . -p 8080        # any static server works
```

## Video integration

Game replays are matched automatically from the PCFL Network YouTube channel
(`UCCopjecFoHzlVp99e-3W2yA`). Title videos `<YY>W<WW><AWAY>@<HOME>` —
e.g. `28W03TEX@UCLA` — and they appear on the matching game center and in the
Media hub on the next deploy. A trailing digit (`...@UCLA2`) marks a re-broadcast
and takes precedence.

## Notes

- Week 1's exports predate the Notre Dame–UCLA re-sim (week 1 shows ND 45–28;
  week 2's cumulative data reflects UCLA 56–21). Re-export week 1 from FBPro98
  and republish it to reconcile.
- The story engine is deterministic (no API keys needed). An OpenAI-powered
  rewrite pass can be added in `parse-fbpro.mjs` → `buildStory()` later.
