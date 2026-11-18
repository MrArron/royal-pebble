# Royal Pebble — getting ready for the Pebble appstore

What has to be true before Royal Pebble goes on the Pebble appstore, what is
done, and what the owner still decides. The listing text itself is in
[`STORE_LISTING.md`](STORE_LISTING.md). Started 2026-11-18 at 1.6.26.

Until now the app was private (`PROJECT_BRIEF.md`, Status). Publishing doesn't
change the sailing plan: nothing here touches the watch code, and the release
itself is meant to come after the December test cruise (decision D8).

## 1. Checklist

| # | Item | Status |
|---|---|---|
| 1 | Free-forever pledge in the README, listing and privacy policy (§2) | Done in this PR |
| 2 | Not-affiliated disclaimer in the README and the listing | README had it; listing done |
| 3 | Privacy policy (`PRIVACY.md`) | Done in this PR |
| 4 | Third-party licenses (`THIRD_PARTY_NOTICES.md`) | Done; three licenses to confirm (§4) |
| 5 | Listing text: name, category, short and long description, release notes | Draft (`STORE_LISTING.md`) |
| 6 | Icons 80×80 and 144×144, banner 720×320 | Drafts in `store/art/` (D2) |
| 7 | Screenshots, 5 per watch, demo data only | To do on the owner's PC (`STORE_LISTING.md` §5) |
| 8 | Repo scan for personal information (§5) | Files clean after this PR; history needs the owner (D4, D5) |
| 9 | In-app notices: settings page Help > About, Android Settings > About (§4) | Next PR (watch-served JS, needs a version bump and an emulator check) |
| 10 | Watch launcher icon (a menu icon resource in `package.json`) | Next PR; check the size the Time 2 and Round 2 launchers use in the current SDK docs first |
| 11 | `companionApp` entry in `package.json` (D6) | Owner decides |
| 12 | Developer account on the appstore's developer dashboard, then submit | Owner, after the sailing (D8) |

## 2. Free forever: why it's spelled out

Royal Caribbean is known to tolerate community tools such as
CheckRoyalCaribbeanPrice, and reportedly stepped in only when a similar
project tried to make money. So Royal Pebble says plainly, everywhere a user
or Royal would look (README, appstore listing, privacy policy, and soon the
settings page's About):

- It is free and open source (MIT).
- It will never charge money, sell a premium version or "pro" features, show
  ads, or put anything behind a paywall.
- It is a hobby project, not a business, and has no server or accounts.
- It is unofficial and not affiliated with Royal Caribbean.

Recommended along with it (D9): no donation or sponsor links, since even
those can read as making money from Royal's data. The MIT License lets
others fork the code; the pledge covers this project, not forks.

It also helps to stay gentle with Royal's servers, as the project already
does (`CLAUDE.md`, Working rules): downloads only when the user taps, no
polling from the watch app, and the Android app's background checks are off
by default, pause on board and run on an interval measured in hours.

## 3. Disclosures

What the app does and how it gets its data, in plain words, for the listing
and the About screens:

- **Schedule and itinerary:** the phone downloads public data for the chosen
  sailing from royalcaribbean.com and Royal's API (`aws-prd.api.rccl.com`),
  the same pages the Royal website uses. Unofficial endpoints: they can
  change or stop working at any time.
- **With a Royal login:** one sign-in, straight to Royal; the settings page
  never saves the password. Adds the stateroom, muster, arrival time and
  booked excursions.
- **Price checks (Android app only, off unless set up):** the app runs
  jdeath's `CheckRoyalCaribbeanPrice.py` unchanged with your own Royal login.
  It signs in to Royal's site as you, reads what you paid and today's price
  for your booking and add-ons, and tells you when a price drops so you can
  rebook through Royal yourself. It never buys, changes or cancels anything.
  The app keeps the script current from this project's verified GitHub
  release (`PRICE_SCRIPT_UPDATES.md`). The watch app on the appstore does none of
  this.
- **Times that matter:** Royal Pebble's all-aboard time is Royal's gangway
  time as downloaded, adjustable by the user. The listing tells people to
  check official announcements for anything critical.
- **Ship map:** the venue table and Ship GPS were measured from Royal's
  public deck plans. The app ships positions and names (facts), not Royal's
  images. If Royal ever objects, the map data can be removed and the app still
  works (schedule, alerts, directory by deck). The rendered deck images that
  were once committed (`Claude outputs/walkway-review-decks.zip`, removed in
  September 2026) remain in git history (D4).
- **Name and trademarks:** "Royal Pebble" uses "Royal" descriptively; the icon
  avoids Royal's crown-and-anchor and colors, and the listing says
  "unofficial" in its first lines (D1).

## 4. Licenses and attributions

`THIRD_PARTY_NOTICES.md` lists every library, data source and tool with its
license. The `.pbw` bundles no third-party library; the Android APK bundles
several (Apache-2.0, MIT, BSD, PSF).

Still to do:

- Confirm three licenses against the projects' own files: the Pebble SDK
  (Apache-2.0 expected), Chaquopy (MIT expected) and apprise (BSD-2-Clause
  expected). This session couldn't open those repositories.
- Settings page: add Help > **About** with the version, the not-affiliated
  line, the free-forever pledge, the jdeath MIT notice, the Hinnant credit, a
  link to `PRIVACY.md` and the GitHub URL. Offline, so links are shown as
  text. This is watch-served JS, so it bumps `1.6.Y` and needs an emulator
  look at the settings page.
- Android app: Settings > About should show the same plus the Apache-2.0
  license text and each library's notice (the APK is distributed on GitHub
  releases, so Apache-2.0 §4 applies).

## 5. Personal information scan (2026-11-18)

Scanned every tracked file on `main`, all 305 commits on all 11 branches and
4 tags (diffs and commit metadata), and the titles and bodies of all 132
issues and pull requests. Searched for: email addresses, phone numbers, real
names, cabin and booking numbers, Crown & Anchor numbers, tokens and
passwords, Windows user paths, family references, dates of travel, and binary
files (images, zips, keystores).

### Clean

- No passwords, tokens, session cookies or API secrets. The keystore
  `android/ci-debug.jks` is a CI debug key (`CN=RoyalPriceCheck CI Debug`,
  password `android`), meant to be public. Real signing keys come from CI
  secrets.
- Cabin numbers in tests and fixtures are made up (the voice corpus says so;
  the demo cruise uses a made-up stateroom). No booking, Crown & Anchor or
  reservation numbers.
- Test guests are "Alex Sample", "Sam Sample", "Pat Other";
  `made.up.guest@example.com`.
- No Windows user paths or OneDrive paths in any commit.
- Issue and PR text: no emails, cabin numbers or family references.
- The Royal `AppKey` and login client are Royal's public web-app values (from
  the MIT project), fine to keep (`CLAUDE.md`, Secrets).

### Fixed in this PR

- `android/tests/test_runner.py` used the owner's first name as a guest name
  in test rows; now "Alex".
- `PROJECT_BRIEF.md` said "No app store release planned"; now points here.

### Needs the owner (history and accounts; a PR can't fix these)

| What | Where | Exposure | Recommended |
|---|---|---|---|
| The owner's personal Gmail address as commit author/committer | 14 commits from September 2026 (`git log --all --author=gmail`) | Anyone can read it from the commits or a commit's `.patch` on GitHub | D4. At least: set the commit email to the GitHub noreply address and turn on GitHub's "Block command line pushes that expose my email" |
| A line saying the owner and his fiancé use the app | Old versions of `PROJECT_BRIEF.md` (commits `ab5f3c7`, `c6266e5`), gone from current files | Minor; family detail | Covered by a history rewrite, if done |
| The owner's surname initial | `LICENSE` copyright line ("Arron L.") | Minor; the owner chose it | D3 |
| The December 2026 sailing (ship and date) | Docs refer to "the owner's sailing" on Harmony and its timeline (`PLAN.md`, the brief); tests and examples use `2026-12-12` and HM | Shows when the owner is away from home, until the trip is over | D5 |
| Royal's rendered deck-plan images (about 12 MB zip) | Commit `d88fa1a`, removed in `ba4c8fb` | Royal's material, not personal; only in history | Covered by a history rewrite, if done |

How to rewrite history if the owner chooses to (D4): on the PC, in a fresh
mirror clone, run `git filter-repo` with a mailmap that maps the Gmail
address to `37947803+MrArron@users.noreply.github.com`, plus
`--path 'Claude outputs/' --invert-paths` and a `--replace-text` rule for the
fiancé line; then force-push every branch and tag. Costs: every commit hash
changes, open branches and clones must be re-made, links to old commits break,
and GitHub keeps the old commits reachable through closed pull requests
(`refs/pull/*`) until GitHub Support purges them. Because of that last point,
the cheaper choice is to accept the email as already public and stop it
appearing in new commits.

## 6. Decisions for the owner

| # | Question | Recommended |
|---|---|---|
| D1 | Keep the name "Royal Pebble"? | Keep. It's short, fits the watch list and is already known. The listing's first line says "unofficial". |
| D2 | Use the draft icon and banner (`store/art/`)? | Use them for an unlisted first release; replace later if you'd like something nicer. |
| D3 | Copyright line in `LICENSE`: "Arron L." or the GitHub handle "MrArron"? | "MrArron", if you'd rather keep your name off the store and repo. |
| D4 | Rewrite git history to remove the Gmail address and old files? | No rewrite; switch to the noreply address and block pushes that expose your email. |
| D5 | Replace the December sailing date in docs and tests? | Leave it; it's over before any store release, and changing test dates churns many files. |
| D6 | `companionApp` in `package.json`: keep both Android packages, drop the link test app, or drop the entry? | Drop the link test package in the next watch-app PR; don't declare a companion in the listing. |
| D7 | First release Unlisted (link only) or Listed? | Unlisted for a few testers, then Listed. A public app can't be made private again. |
| D8 | When to submit? | After the sailing: port/starboard checked on board, Round 2 on real hardware, and the freeze over. |
| D9 | Donation or sponsor links? | None, to keep the free-forever line simple. |
| D10 | Support contact on the listing | GitHub issues only, or a new address just for the app, not your personal email. |
