# Royal Pebble sync tool (Windows)

A small backup tool for the Royal Pebble watch app. It downloads your sailing's
itinerary and activity schedule from Royal Caribbean and saves them as one block of
text you paste into the app's phone settings. Use it when the in-app **Download
cruise data** button doesn't work, or when you also want your stateroom and
purchased add-ons from your Royal Caribbean account.

## Install (one time)

1. **Install Python.** Download it from [python.org/downloads](https://www.python.org/downloads/)
   and run the installer, keeping the default options. Or open Terminal and run
   `winget install Python.Python.3.12`.
2. **Get this folder.** On the project's GitHub page, click **Code > Download ZIP**,
   then unzip it and open the `tools/cruise-sync` folder.
3. **Double-click `install.bat`.** It installs the two small add-ons the tool
   needs. You only do this once.

## Use

1. Double-click **`sync.bat`**.
2. Type your ship's name (for example `Harmony`), then pick your sailing from the list.
3. The tool saves a file named like `cruise-watch-HM-20261212.json` in the same
   folder and copies its contents to your clipboard.
4. Get that text to your phone however you normally move text: email it to
   yourself, or paste it into a notes app that syncs to your phone.
5. On your phone, open **Royal Pebble settings > Cruise > Backup: paste cruise data**,
   paste, and tap **Save**.

**Timing:** run the tool before you sail, while you still have internet. Royal
usually publishes the activity schedule about two weeks before sailing; before then
you'll get the itinerary only, so run the tool again once the schedule appears.
Once the full data (itinerary and schedule) is pasted in, Royal Pebble works at sea
with no internet.

### Include your booking (optional)

Double-click **`sync-with-login.bat`** instead. After picking your sailing, it asks
for your Royal Caribbean email and password. The password is typed at a hidden
prompt, is used only for this run, and is never saved. The result then also
includes your stateroom number and your purchased add-ons (packages, excursions,
dining). Treat that file as private.

To skip the password prompt, you can set the `RCCL_EMAIL` and `RCCL_PASSWORD`
environment variables, but don't store your password in any file you share.

### Command line

```
py cruise_sync.py --ship harmony --date YYYY-MM-DD
py cruise_sync.py --ship HM --date YYYY-MM-DD --login
py cruise_sync.py --help
```

## Troubleshooting

- **"Python is not installed"** — do Install step 1, then close and reopen the folder.
- **"403 Access Denied"** — run `install.bat` again; the `curl_cffi` add-on makes
  the tool look like a normal browser, which Royal's servers require for some networks.
- **"Login failed"** — check your email and password on royalcaribbean.com first.
- **Anything else stops working** — Royal may have changed their website. These
  are Royal's own unofficial, undocumented website endpoints, so they can change
  without notice.

## Data format

The output format is documented in [docs/DATA_FORMAT.md](../../docs/DATA_FORMAT.md).

## Credit

Endpoint knowledge, the web app key and the login client come from
[jdeath/CheckRoyalCaribbeanPrice](https://github.com/jdeath/CheckRoyalCaribbeanPrice)
(MIT License, Copyright (c) 2025 jdeath).
