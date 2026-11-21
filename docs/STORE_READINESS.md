# Royal Pebble — getting ready for the Pebble appstore

What has to be true before Royal Pebble goes on the Pebble appstore, what is
done, and what the owner still decides. The listing text itself is in
[`STORE_LISTING.md`](STORE_LISTING.md). Started 2026-11-18 at 1.6.26.

Until now the app was private (`PROJECT_BRIEF.md`, Status). Publishing doesn't
change the sailing plan: the only app change is the permission declaration in
`package.json` (§7, 1.6.28), which changes nothing until the app is built with
SDK 4.44, and the release itself comes after the December test cruise (D8).

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
| 11 | `companionApp` entry in `package.json` (D6) | Explained in D6; owner to confirm dropping the link test package |
| 13 | Permissions: declare them so the app isn't a legacy app (§7) | Declared in 1.6.28; build with SDK 4.44 and test on the emulator before release |
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

## 6. Decisions (answered by the owner 2026-11-21)

| # | Question | Decision |
|---|---|---|
| D1 | Keep the name "Royal Pebble"? | Open: the owner asked for alternatives (§8). |
| D2 | Use the draft icon and banner (`store/art/`)? | Open: icon concepts in `store/concepts/` (a ship whose hull is a Pebble Time 2, and the Android app's ship-on-wave icon with a watch) are with the owner. The owner likes C; refinements C1 (the original icon on the screen) and C2 (smoother waves), then C3 (C2 with the ship bow-on) and C3b (C3 with a hull as wide as the superstructure and a little shorter; the owner set C4 aside) are in `store/concepts/`. |
| D3 | Copyright line in `LICENSE` | Keep "Arron L.". |
| D4 | Rewrite git history? | No rewrite. Switch commits to the GitHub noreply address and turn on "Block command line pushes that expose my email". |
| D5 | Replace the December sailing date in docs and tests? | Leave it. |
| D6 | `companionApp` packages in `package.json` | Recommended: drop `io.github.mrarron.royalpebble.linktest` and keep the Royal Pebble Android app. Under the 2.0.0 permissions, the Pebble app asks the user about each companion package listed, so a store user would be asked about a test app they don't have. Don't fill in the store's companion fields (they want a Google Play listing). Waiting on the owner's yes. |
| D7 | First release Unlisted or Listed? | Unlisted for a few testers, then Listed. |
| D8 | When to submit? | After the sailing (the owner may revisit). |
| D9 | Donation or sponsor links? | None. |
| D10 | Support contact | GitHub issues, or replies on the Pebble store. No personal email. |

## 7. Permissions (Pebble app 2.0.0)

Pebble app 2.0.0 (autumn 2026) turned on app permissions for everyone. Source:
the Pebble Plugins Preview guide
(developer.repebble.com/guides/plugins/preview/, read 2026-11-21), plus its
Microphone and Dictation guides.

- A `.pbw` built with **SDK 4.44 or later and pebble-tool 5.1.0 or later** is
  marked `manifestVersion: 2` (the default since SDK 4.44) and uses
  permissions. Anything older is a **legacy app**: it keeps the old blanket
  access (internet, location, timeline pins) and the Pebble app shows its
  permissions as legacy. Every build so far used SDK 4.33.1, which is why
  Royal Pebble shows as legacy today.
- A permissions app gets only what it declares in `usesPermissions` in the
  `pebble` block of `package.json`. Required ones are asked at install; a
  blocked request fails. So moving to SDK 4.44 **without** the declaration
  would break every download.
- Declared in 1.6.28: `Internet` for `rccl.com` and `royalcaribbean.com`,
  required, with a reason. Each domain covers its subdomains, so this covers
  `aws-prd.api.rccl.com` (the API used by `src/pkjs/royal.js` and the
  settings page) and `www.royalcaribbean.com` (the login). These are the only
  hosts the watch app's JS contacts.
- Not needed: **dictation** (`DictationSession`) has no permission in the
  guides; `WatchMicrophone` is only for raw audio (`mic_*` APIs), which Royal
  Pebble doesn't use. Wakeups, AppMessage and the settings page (opened with
  `Pebble.openURL`) have no permission either. No location, notifications,
  timeline or health.
- Companion apps built on PebbleKit 2 need no declaration; the Pebble app asks
  about each package in `companionApp` on its own (hence D6).
  `LegacyPebbleKit` is only for PebbleKit Classic companions.

To check before release (on the owner's PC, after upgrading the SDK to 4.44
and pebble-tool to 5.1.0):

1. `pebble build`, then confirm `appinfo.json` inside the `.pbw` has
   `"manifestVersion": 2` and the `usesPermissions` entry.
2. Install on the emulator and on the phone: the install should ask once for
   Internet access to Royal Caribbean, and the app page should list it (no
   "legacy" label).
3. Open the settings page and run a Download, with and without login. The
   settings page is a local `data:` URL that calls Royal's API itself; the
   guide says a settings page may only load or connect to declared domains,
   and says nothing about `data:` pages, so this is the step most likely to
   surprise.
4. Voice (Hold Select) still works.
5. Run `tools/watch_size.py` as usual; a newer SDK can change the binary size.

Until then nothing should change: SDK 4.33.1 predates permissions and is
expected to ignore `usesPermissions`, so 1.6.28 should build and behave like
1.6.27 on the current setup (confirm with one build; not yet tried). Upgrading the SDK before
the sailing is not recommended (it is a new toolchain right before the
freeze).

## 8. Name ideas (D1)

Short enough for the watch's app list, clear about cruising, and free of
Royal Caribbean's own names (avoid "Cruise Compass", "Navigator", "Crown",
"Anchor" and ship names; "Royal" alone is a common word). "Pebble" in a name
is the watch maker's trademark too; other appstore apps use it, but a name
without it is the safer choice.

| Name | Why |
|---|---|
| **Shipmate** | Friendly, says "companion on board", no brand words |
| **All Aboard** | The app's signature screen; instantly cruise |
| **Cruise Pebble** | Keeps the current feel, drops "Royal" |
| Sea Day | Short, cruise slang, calm |
| Gangway | Cruise word tied to the all-aboard countdown |
| Deck Buddy | Playful; hints at the deck-by-deck directory |
| Wristwake | Wrist + a ship's wake (matches the icon art) |
| Lido | The pool deck; short and memorable, but less obvious |
| Royal Pebble | The current name; known, but leans on "Royal" |
