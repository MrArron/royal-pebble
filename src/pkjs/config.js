// The settings page, built on the phone and opened as a data: URL so it works
// with no internet (docs/DESIGN.md, "Phone settings"). Screens: Cruise, Days, Filters,
// Events and Me.
//
// The page returns its result through `return_to` (the emulator tooling adds
// it) or the phone app's pebblejs://close# URL:
//   {action: 'save' | 'download' | 'test', me, theme, reminderLead,
//    days: {date: {offset, buffer, allAboard, edit} | null}, showFeatured, hiddenCats,
//    stars: {starKey: true | false} (changes only), starTimes: {starKey: ms} (when
//    each was made), personal: [{title, venue, date, time, minutes}],
//    download: {ship: {code, name}, sailDate}, bundle, ships,
//    venues: {ship, overrides} (all venue edits for that ship, only when changed)}

var venues = require('./venues');

var CSS = [
  ':root{--primary:#006A6A;--on-primary:#FFFFFF;--primary-container:#9CF1F0;--on-primary-container:#002020;',
  '--secondary-container:#CCE8E7;--on-secondary-container:#051F1F;--warning-container:#FFDDB5;--on-warning-container:#2A1700;',
  '--surface:#F4FBFA;--surface-low:#EFF5F4;--surface-container:#E9EFEE;--surface-high:#E3E9E9;',
  '--on-surface:#161D1D;--on-surface-variant:#3F4948;--outline:#6F7979;--error:#BA1A1A;',
  '--tertiary-container:#D3E4FF;--on-tertiary-container:#001C38}',
  '*{box-sizing:border-box}',
  'html,body{margin:0;background:var(--surface);color:var(--on-surface);',
  'font-family:"Roboto Flex",Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.4;',
  '-webkit-text-size-adjust:100%}',
  'header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface)}',
  'header h1{flex:1;margin:0;font-size:22px;font-weight:500}',
  'main{padding:4px 16px 112px;max-width:560px;margin:0 auto}',
  '.screen{display:none}.screen.active{display:block}',
  '.card{background:var(--surface-container);border-radius:28px;padding:20px;margin:0 0 12px}',
  '.card.hero{background:var(--primary-container);color:var(--on-primary-container)}',
  '.card.warn{background:var(--warning-container);color:var(--on-warning-container)}',
  '.card h2{margin:0 0 4px;font-size:18px;font-weight:600}',
  '.card p{margin:4px 0}',
  '.muted{color:var(--on-surface-variant);font-size:14px}',
  '.hero .muted{color:var(--on-primary-container);opacity:.8}',
  '.rows{margin-top:12px}',
  '.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid rgba(0,0,0,.08)}',
  '.row span:last-child{font-weight:600;text-align:right}',
  '.moved{color:var(--on-warning-container);background:var(--warning-container);border-radius:6px;padding:0 6px;white-space:nowrap;',
  'font-weight:600}',
  '.chg{padding:8px 0;border-top:1px solid rgba(0,0,0,.08)}.chg b{display:block}.chg span{font-size:14px}',
  '.chip{display:inline-block;padding:2px 10px;border-radius:8px;background:var(--warning-container);',
  'color:var(--on-warning-container);font-size:14px;font-weight:600}',
  'label{display:block;margin:14px 0 6px;font-size:14px;font-weight:600;color:var(--on-surface-variant)}',
  'input,select,textarea{width:100%;font:inherit;color:var(--on-surface);background:var(--surface);',
  'border:1px solid var(--outline);border-radius:12px;padding:12px 14px;min-height:48px}',
  'input:focus,select:focus,textarea:focus{outline:2px solid var(--primary);outline-offset:-1px;border-color:var(--primary)}',
  'textarea{min-height:120px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}',
  '.help{margin:6px 2px 0;font-size:13px;color:var(--on-surface-variant)}',
  '.help.error{color:var(--error);font-weight:600}.help.ok{color:var(--primary);font-weight:600}',
  'button{font:inherit;cursor:pointer;border:0}',
  '.pill{min-height:48px;padding:0 24px;border-radius:999px;font-weight:600;font-size:16px}',
  '.pill.filled{background:var(--primary);color:var(--on-primary)}',
  '.pill.tonal{background:var(--secondary-container);color:var(--on-secondary-container)}',
  '.pill:disabled{opacity:.38;cursor:default}',
  '.pill.wide{width:100%;margin-top:16px}',
  '.seg{display:flex;gap:2px;margin-top:4px}',
  '.seg button{flex:1;min-height:48px;border-radius:8px;background:var(--surface-high);color:var(--on-surface);font-weight:600}',
  '.seg button:first-child{border-radius:999px 8px 8px 999px}.seg button:last-child{border-radius:8px 999px 999px 8px}',
  '.seg button[aria-pressed=true]{background:var(--primary);color:var(--on-primary)}',
  'details summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center}',
  'details summary::-webkit-details-marker{display:none}',
  'details summary:after{content:"";width:10px;height:10px;border-right:2px solid;border-bottom:2px solid;',
  'transform:rotate(45deg);margin:0 6px 4px}',
  'details[open] summary:after{transform:rotate(-135deg);margin-bottom:-4px}',
  'nav{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:8px;',
  'padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--surface-low)}',
  'nav button{flex:0 1 160px;display:flex;flex-direction:column;align-items:center;gap:4px;background:none;',
  'color:var(--on-surface-variant);font-size:13px;font-weight:600;padding:0}',
  'nav .ind{display:flex;align-items:center;justify-content:center;width:64px;height:32px;border-radius:999px}',
  'nav button.active{color:var(--on-surface)}nav button.active .ind{background:var(--secondary-container)}',
  'nav svg{width:24px;height:24px;fill:currentColor}',
  '.day{background:var(--surface-low);border-radius:20px;margin:0 0 8px}',
  '.day.open{background:var(--surface-container);border-radius:28px;box-shadow:inset 0 0 0 2px var(--primary)}',
  '.day-head{display:flex;width:100%;align-items:center;gap:12px;padding:14px 20px;background:none;color:inherit;',
  'text-align:left;min-height:64px}',
  '.day-head .t{flex:1;min-width:0}.day-head b{display:block;font-size:16px;font-weight:600}',
  '.day.open .day-head b{font-size:20px;font-weight:700}',
  '.day-head svg{width:20px;height:20px;flex:none;fill:var(--on-surface-variant);transition:transform .2s}',
  '.day.open .day-head svg{transform:rotate(90deg)}',
  '.day-body{padding:0 20px 20px}.day-body>label:first-child{margin-top:0}',
  '.stepper{display:flex;align-items:center;gap:12px}',
  '.stepper button{width:48px;height:48px;flex:none;border-radius:24px;border:1px solid var(--outline);',
  'background:transparent;font-size:24px;color:var(--on-surface)}',
  '.stepper output{flex:1;text-align:center;font-size:20px;font-weight:700}',
  '.result{background:var(--primary);color:var(--on-primary);border-radius:16px;padding:12px 16px;margin-top:16px}',
  '.result small{display:block;font-size:13px;font-weight:600;letter-spacing:.4px;opacity:.9}',
  '.result strong{display:block;font-size:20px}.result span{display:block;font-size:14px;opacity:.9}',
  '.times{display:flex;gap:12px}.times>div{flex:1;min-width:0}',
  '.edit{margin-top:16px;padding-top:4px;border-top:1px solid rgba(0,0,0,.08)}',
  '.textbtn{background:none;color:var(--primary);font-weight:600;min-height:48px;padding:0}',
  '.switch-row{display:flex;align-items:center;gap:16px}.switch-row .t{flex:1;min-width:0}',
  '.switch-row b{display:block;font-size:16px;font-weight:600}',
  '.switch{flex:none;position:relative;width:52px;height:32px;border-radius:16px;padding:0;',
  'background:var(--surface-high);box-shadow:inset 0 0 0 2px var(--outline)}',
  '.switch:after{content:"";position:absolute;left:8px;top:8px;width:16px;height:16px;border-radius:8px;',
  'background:var(--outline);transition:all .15s}',
  '.switch[aria-checked=true]{background:var(--primary);box-shadow:none}',
  '.switch[aria-checked=true]:after{left:24px;top:4px;width:24px;height:24px;border-radius:12px;background:var(--on-primary)}',
  '.cats{background:var(--surface-low);border-radius:28px;padding:6px 0;margin:0 0 12px}',
  '.cat{margin:0 6px;border-radius:24px}.cat.open{background:var(--surface-high)}',
  '.cat .switch-row{padding:8px 14px}',
  '.cat-name{display:block;width:100%;background:none;color:inherit;text-align:left;padding:4px 0;min-height:44px}',
  '.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 14px 14px}',
  '.fchip{min-height:36px;padding:0 12px;border-radius:10px;font-size:14px;font-weight:500;',
  'background:transparent;color:var(--on-surface-variant);box-shadow:inset 0 0 0 1px var(--outline)}',
  '.fchip[aria-pressed=true]{background:var(--secondary-container);color:var(--on-secondary-container);',
  'font-weight:600;box-shadow:none}',
  '.fchip:disabled{opacity:.38}',
  '.search{display:flex;align-items:center;gap:10px;height:52px;border-radius:26px;background:var(--surface-high);',
  'padding:0 18px;margin:0}',
  '.search svg{width:20px;height:20px;flex:none;fill:none;stroke:var(--on-surface-variant);stroke-width:2;',
  'stroke-linecap:round}',
  '.search input{border:0;background:transparent;padding:0;min-height:0;height:48px;flex:1}',
  '.search input:focus{outline:none}',
  '.daychips{display:flex;gap:8px;overflow-x:auto;margin:0 -16px;padding:10px 16px 12px}',
  '.daychips .fchip{flex:none}',
  '.mine{background:var(--tertiary-container);color:var(--on-tertiary-container);border-radius:28px;',
  'padding:14px 20px;margin:0 0 12px}',
  '.mine .muted{color:#33475F}',
  '.mine-head{display:flex;justify-content:space-between;align-items:center;min-height:36px}',
  '.mine-head small{font-size:13px;font-weight:700;letter-spacing:.4px}',
  '.addbtn{min-height:36px;padding:0 14px;border-radius:18px;background:#4B607C;color:#FFFFFF;font-weight:700;font-size:14px}',
  '.ev-list{background:var(--surface-low);border-radius:28px;padding:6px 0;margin:0 0 12px}',
  '.ev{display:flex;gap:14px;align-items:center;padding:6px 8px 6px 20px}',
  '.ev .tm{width:56px;flex:none;font-weight:600;color:var(--on-surface-variant)}',
  '.ev .t{flex:1;min-width:0}.ev b{display:block;font-weight:600}',
  '.mine .ev{width:100%;padding:8px 0;background:none;color:inherit;text-align:left;min-height:48px}',
  '.mine .ev .tm{color:inherit;font-weight:700}',
  '.star{width:48px;height:48px;flex:none;border-radius:24px;background:transparent;',
  'color:var(--on-surface-variant);display:flex;align-items:center;justify-content:center}',
  '.star svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round}',
  '.star[aria-pressed=true]{border-radius:16px;background:var(--warning-container);color:#8B5000}',
  '.star[aria-pressed=true] svg{fill:currentColor}',
  '.form-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px}',
  'code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}',
  '[hidden]{display:none!important}',
  '.ttl{flex:1;min-width:0}.ttl small{display:block;font-size:12px;font-weight:600;color:var(--on-surface-variant)}',
  '.ttl small:empty{display:none}',
  '.iconbtn{width:48px;height:48px;flex:none;border-radius:24px;background:none;color:var(--on-surface);display:flex;',
  'align-items:center;justify-content:center;margin:0 -8px 0 -12px}',
  '.iconbtn svg,.vicon svg,.fab svg,.pill svg,.vrow>svg,.badge svg{fill:none;stroke:currentColor;stroke-width:2;',
  'stroke-linecap:round;stroke-linejoin:round}',
  '.iconbtn svg,.vicon svg{width:24px;height:24px}',
  '.vhead{display:flex;align-items:center;gap:14px}.vhead h2{margin:0}',
  '.vicon{width:48px;height:48px;flex:none;border-radius:24px;background:var(--primary-container);',
  'color:var(--on-primary-container);display:flex;align-items:center;justify-content:center}',
  '.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0 4px}',
  '.stat{border-radius:16px;padding:10px 12px;background:var(--surface-high)}',
  '.stat b{display:block;font-size:22px;font-weight:600;line-height:1.2}',
  '.stat span{font-size:12px;color:var(--on-surface-variant)}',
  '.stat.out{background:none;box-shadow:inset 0 0 0 1px var(--outline)}',
  '.stat.warn{background:var(--warning-container);color:var(--on-warning-container)}.stat.warn span{color:inherit}',
  '.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}',
  '.textbtn.pad{padding:0 16px}',
  '.vtools{display:flex;flex-direction:column;gap:10px;margin:0 0 16px}',
  '.vchips{display:flex;gap:8px;flex-wrap:wrap}',
  '.groupby{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--on-surface-variant)}',
  '.seg.small{margin:0;gap:2px}.seg.small button{flex:none;min-height:36px;padding:0 16px;font-size:14px}',
  '.seg.small button:first-child{border-radius:18px 6px 6px 18px}',
  '.seg.small button:last-child{border-radius:6px 18px 18px 6px}',
  '#vList{padding-bottom:72px}',
  '.vgroup{margin:0 0 16px}.vgh{display:flex;justify-content:space-between;align-items:baseline;padding:0 8px 6px}',
  '.vgh h3{margin:0;font-size:14px;font-weight:600;color:var(--primary)}',
  '.vgh span{font-size:12px;color:var(--on-surface-variant)}',
  '.vbox{background:var(--surface-low);border-radius:20px;overflow:hidden}',
  '.vrow{display:flex;width:100%;align-items:center;gap:12px;min-height:60px;padding:8px 12px 8px 16px;',
  'background:none;color:inherit;text-align:left;border-top:1px solid var(--surface-high)}',
  '.vrow:first-child{border-top:0}.vrow .t{flex:1;min-width:0}.vrow b{display:block;font-weight:500}',
  '.vrow .muted{font-size:13px}.vrow>svg{width:20px;height:20px;flex:none;color:var(--outline)}',
  '.badge{flex:none;height:26px;padding:0 10px;border-radius:13px;font-size:12px;font-weight:600;display:flex;',
  'align-items:center;gap:4px}.badge svg{width:14px;height:14px;stroke-width:2.4}',
  '.badge.check{box-shadow:inset 0 0 0 1px var(--outline);color:var(--on-surface-variant)}',
  '.badge.edited{background:var(--warning-container);color:var(--on-warning-container)}',
  '.badge.add{background:var(--surface-high);color:var(--on-surface-variant)}',
  '.empty{padding:32px 16px;text-align:center;color:var(--on-surface-variant);font-size:14px}',
  '.fab{position:fixed;z-index:3;right:16px;bottom:calc(96px + env(safe-area-inset-bottom));height:56px;',
  'padding:0 20px;border-radius:18px;background:var(--primary-container);color:var(--on-primary-container);',
  'font-weight:600;font-size:15px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 6px rgba(0,0,0,.18)}',
  '.fab svg{width:22px;height:22px}',
  '.card.fcard{background:var(--surface-low);padding:18px 20px}',
  '.fhead{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}',
  '.fhead b{font-size:16px;font-weight:600}.fhead span{font-size:12px;color:var(--on-surface-variant)}',
  '.vstep{margin-bottom:8px}.vstep button{border:0;background:var(--secondary-container);',
  'color:var(--on-secondary-container)}',
  '.vstep input{flex:1;width:0;height:56px;text-align:center;font-size:24px;font-weight:600;background:transparent}',
  '.vstep input.edited{background:var(--warning-container);color:var(--on-warning-container);',
  'border-color:var(--warning-container)}',
  '.vstep .xbtn{width:40px;background:none;color:var(--on-surface-variant);font-size:26px}',
  '.seg button.edited[aria-pressed=true],.fchip.edited[aria-pressed=true]{background:var(--warning-container);',
  'color:var(--on-warning-container)}',
  '.achips{display:flex;flex-wrap:wrap;gap:8px}.achips .fchip{min-height:40px;padding:0 14px;font-weight:600}',
  '.fstat{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 0;min-height:40px}',
  'p.fstat{min-height:0;font-size:12px;color:var(--on-surface-variant)}',
  '.fstat .textbtn{flex:none;white-space:nowrap;padding:0 4px}',
  '.schip{min-height:28px;padding:4px 10px;border-radius:14px;font-size:12px;font-weight:600;line-height:1.3}',
  '.schip.edited{background:var(--warning-container);color:var(--on-warning-container)}',
  '.schip.check{box-shadow:inset 0 0 0 1px var(--outline);color:var(--on-surface-variant)}',
  '.wprev{background:#161D1D;color:#FFFFFF;border-radius:28px;padding:16px 20px;margin:0 0 12px}',
  '.wprev small{display:block;font-size:12px;font-weight:600;color:#9CF1F0;letter-spacing:.5px;margin-bottom:4px}',
  '.wprev b,.wprev span{display:block;font-family:"Roboto Condensed","Arial Narrow",sans-serif;font-weight:700}',
  '.wprev b{font-size:18px}.wprev span{font-size:15px;color:#AAAAAA}',
  '.wprev svg{width:6px;height:11px;margin-right:3px;fill:none;stroke:currentColor;stroke-width:3.2;',
  'stroke-linecap:round;stroke-linejoin:round}',
  '.wprev .note{font-family:inherit;font-weight:400;font-size:13px}',
  '.editbar{display:none;position:fixed;left:0;right:0;bottom:0;align-items:center;justify-content:space-between;',
  'gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--surface-container)}',
  'body.editing nav{display:none}body.editing .editbar{display:flex}',
  '.pill.big{min-height:56px;padding:0 22px;border-radius:28px;display:flex;align-items:center;gap:8px}',
  '.pill.big svg{width:20px;height:20px;stroke-width:2.4}',
  '.vlink{background:none;padding:0;font:inherit;color:var(--primary);font-weight:600;text-align:left}'
].join('');

var BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';

var BODY = [
  '<header><button class="iconbtn" id="back" aria-label="Back" hidden>' + BACK_SVG + '</button>',
  '<div class="ttl"><small id="subtitle"></small><h1 id="title">Cruise</h1></div>',
  '<button class="pill filled" id="save">Save</button></header>',
  '<main>',
  '<section class="screen active" id="cruise">',
  '<div id="status"></div>',
  '<div class="card"><h2>Download your sailing</h2>',
  '<p class="muted">Download before you sail, while you have internet. Royal usually publishes the ',
  'activity schedule about two weeks before sailing; download again then. Once your sailing and its ',
  'schedule are downloaded, Royal Pebble works at sea with no internet.</p>',
  '<label for="ship">Ship</label><select id="ship"></select>',
  '<label for="sailing">Sailing</label><select id="sailing"></select>',
  '<input id="sailDate" type="date" style="display:none" aria-label="Sail date">',
  '<p class="help" id="sailHelp"></p>',
  '<button class="pill filled wide" id="download">Download</button>',
  '<p class="help">The page closes and your phone downloads in the background. ',
  'Your watch updates when it is done.</p></div>',
  '<div id="venueCard"></div>',
  '<details class="card" id="backup"><summary><h2>Backup: paste cruise data</h2></summary>',
  '<p class="muted">If Download doesn\'t work, run <code>sync.bat</code> from <code>tools/cruise-sync</code> ',
  'on a Windows PC, get the text it copies to your phone, paste it here and tap Save.</p>',
  '<textarea id="paste" placeholder="{&quot;format&quot;:&quot;cruise-watch&quot;, ...}" spellcheck="false" ',
  'autocapitalize="off" autocomplete="off"></textarea><p class="help" id="pasteHelp"></p></details>',
  '</section>',
  '<section class="screen" id="days"><div id="dayList"></div></section>',
  '<section class="screen" id="filters">',
  '<div class="card switch-row"><span class="t"><b>Royal\'s featured events</b>',
  '<span class="muted">Show on the watch\'s home when nothing starred is next</span></span>',
  '<button class="switch" role="switch" id="featured" aria-label="Royal\'s featured events"></button></div>',
  '<div id="catList"></div>',
  '<p class="help">Hidden categories stay off the watch\'s lists. Events you star always show.</p>',
  '</section>',
  '<section class="screen" id="events">',
  '<label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/>',
  '<path d="M20 20l-4.5-4.5"/></svg><input type="search" id="evSearch" placeholder="Search events or venues" ',
  'aria-label="Search events or venues" autocomplete="off"></label>',
  '<div class="daychips" id="evDays"></div><div id="evMine"></div><div id="evList"></div>',
  '</section>',
  '<section class="screen" id="me">',
  '<div class="card"><h2>Stateroom</h2>',
  '<label for="stateroom">Stateroom number</label><input id="stateroom" maxlength="10" inputmode="numeric">',
  '<label for="deck">Deck</label><input id="deck" maxlength="14" placeholder="Deck 9">',
  '<label for="stairs">Nearest stairs</label><input id="stairs" maxlength="22" placeholder="Forward stairs"></div>',
  '<div class="card"><h2>Safety</h2>',
  '<label for="muster">Muster station</label><input id="muster" maxlength="30" placeholder="B4 - Royal Promenade"></div>',
  '<div class="card"><h2>Watch</h2>',
  '<label>Theme</label><div class="seg" id="theme"><button data-v="light">Light</button>',
  '<button data-v="dark">Dark</button></div>',
  '<label>Remind me before starred events</label><div class="seg" id="lead"><button data-v="5">5 min</button>',
  '<button data-v="15">15 min</button><button data-v="30">30 min</button></div>',
  '<p class="help">Reminders arrive in a later update; this sets how early they come.</p>',
  '<label for="clockNote">Ship clock note</label><input id="clockNote" maxlength="38" ',
  'placeholder="Ship stays on Eastern time">',
  '<p class="help">Shown on the watch\'s My info screen.</p>',
  '<label>Alerts</label><button class="pill tonal wide" id="testAlerts" style="margin-top:4px">Test alerts</button>',
  '<p class="help">Saves and closes this page. About 2 minutes later your watch shows a test reminder, ',
  'then a test all-aboard alert a minute after that. Close the app on the watch first to check that ',
  'alerts open it by themselves.</p><p class="help" id="watchStorage"></p></div>',
  '</section>',
  '<section class="screen" id="venues"><div class="vtools">',
  '<label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/>',
  '<path d="M20 20l-4.5-4.5"/></svg><input type="search" id="vSearch" placeholder="Search venues" ',
  'aria-label="Search venues" autocomplete="off"></label>',
  '<div class="vchips" id="vChips"></div>',
  '<div class="groupby" role="group" aria-label="Group by"><span>Group by</span><div class="seg small" id="vGroup">',
  '<button data-v="area">Area</button><button data-v="deck">Deck</button></div></div></div>',
  '<div id="vList"></div></section>',
  '<section class="screen" id="venueEdit"><div id="vEdit"></div></section>',
  '</main>',
  '<button class="fab" id="vFab" hidden></button>',
  '<div class="editbar"><button class="textbtn pad" id="vResetAll">Reset all to built-in</button>',
  '<button class="pill filled big" id="vNext"></button></div>',
  '<nav><button class="active" data-screen="cruise"><span class="ind"><svg viewBox="0 0 24 24"><path d="M20 21c-1.4 0-2.8-.5-4-1.3',
  '-2.4 1.7-5.6 1.7-8 0-1.2.8-2.6 1.3-4 1.3H2v2h2c1.4 0 2.7-.3 4-1 2.5 1.3 5.5 1.3 8 0 1.3.7 2.6 1 4 1h2v-2h-2zM3.9 19H4',
  'c1.6 0 3-.9 4-2 1 1.1 2.4 2 4 2s3-.9 4-2c1 1.1 2.4 2 4 2h.1l1.9-6.7c.1-.3.1-.5-.1-.8-.1-.2-.4-.4-.6-.4L20 10.6V6c0-1.1',
  '-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.6l-1.3.4c-.3.1-.5.2-.6.5-.1.2-.2.5-.1.8L3.9 19zM6 6h12v4l-6-2-6 2V6z"/></svg>',
  '</span>Cruise</button>',
  '<button data-screen="days"><span class="ind"><svg viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9',
  '-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM7 12h5v5H7z"/></svg></span>Days</button>',
  '<button data-screen="filters"><span class="ind"><svg viewBox="0 0 24 24"><path d="M3 5h18v2H3zm3 6h12v2H6zm4 6h4v2h-4z"/>',
  '</svg></span>Filters</button>',
  '<button data-screen="events"><span class="ind"><svg viewBox="0 0 24 24"><path d="M12 17.3 18.2 21l-1.6-7L22 9.2',
  'l-7.2-.6L12 2 9.2 8.6 2 9.2 7.5 14l-1.7 7z"/></svg></span>Events</button>',
  '<button data-screen="me"><span class="ind"><svg viewBox="0 0 24 24"><path d="M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8',
  '-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg></span>Me</button></nav>'
].join('');

// Runs inside the page. `S` is the state embedded by buildPage(); `V` is
// venues.js venueLib().
function pageMain(S, V) {
  var $ = function(id) { return document.getElementById(id); };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var pastedBundle = null;
  var sailingsFor = null;
  var fetchedShips = null;  // handed back to the phone for caching

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }

  function dateObj(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function niceDate(iso) {
    var d = dateObj(iso);
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function returnUrl() {
    var m = /[?&]return_to=([^&]*)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : 'pebblejs://close#';
  }

  // ---- Navigation. The venue screens sit under Cruise: a Back arrow instead
  // of a nav change, and the edit screen swaps the nav for its own bar.
  var navButtons = document.querySelectorAll('nav button');
  function show(id, title, sub) {
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function(s) {
      s.classList.toggle('active', s.id === id);
    });
    $('title').textContent = title;
    $('subtitle').textContent = sub || '';
    $('back').hidden = id !== 'venues' && id !== 'venueEdit';
    document.body.classList.toggle('editing', id === 'venueEdit');
    $('vFab').hidden = true;  // renderVenues() shows it
    window.scrollTo(0, 0);
  }
  Array.prototype.forEach.call(navButtons, function(b) {
    b.addEventListener('click', function() {
      var id = b.getAttribute('data-screen');
      Array.prototype.forEach.call(navButtons, function(x) { x.classList.toggle('active', x === b); });
      show(id, b.textContent);
      if (id === 'events' && editing === null) {
        renderEvents();  // picks up changes made under Filters
      } else if (id === 'cruise') {
        renderVenueCard();
      }
    });
  });
  function goTo(id) {
    document.querySelector('nav [data-screen=' + id + ']').click();
  }

  // ---- Status card
  function renderStatus() {
    var st = S.status || {};
    var html = '';
    if (st.error) {
      html += '<div class="card warn"><h2>Last download failed</h2><p>' + esc(st.error) + '</p>' +
        (st.at ? '<p class="muted">' + esc(st.at) + '</p>' : '') + '</div>';
    }
    if (!S.cruise) {
      html += '<div class="card hero"><h2>No cruise data yet</h2><p>Your watch is showing a demo. ' +
        'Pick your ship and sailing below, then tap Download before you sail, while you have internet.</p></div>';
    } else {
      var c = S.cruise;
      html += '<div class="card hero"><h2>' + esc(c.shipName) + '</h2><p>Sails ' + esc(niceDate(c.sailDate)) +
        (c.nights ? ' &middot; ' + c.nights + ' nights' : '') + '</p><div class="rows">' +
        '<div class="row"><span>Itinerary</span><span>' + c.days + ' days</span></div>' +
        '<div class="row"><span>Activity schedule</span><span>' +
        (c.published ? c.events + ' events' : '<span class="chip">Not published yet</span>') + '</span></div>' +
        '<div class="row"><span>Last sync</span><span>' + esc(c.lastSync) + '</span></div></div>' +
        '<p class="muted" style="margin-top:8px">' + (c.published ?
          'All set: Royal Pebble works at sea with no internet.' :
          'Royal usually publishes it about two weeks before sailing. Download again then, before you sail; ' +
          'your stars and settings are kept. Once it is downloaded, Royal Pebble works at sea with no ' +
          'internet.') + '</p></div>';
    }
    if (S.watchFull) {
      var when = dayLabel(S.watchFull.date) + ' ' + shortClock(S.watchFull.time);
      html += '<div class="card warn"><h2>Open Royal Pebble before ' + esc(when) + '</h2><p>Your watch ' +
        'ran out of room for starred events and alerts from ' + esc(when) + ' on. Open Royal Pebble on the ' +
        'watch with this phone nearby before then, and none are missed.</p></div>';
    }
    var changes = starChangeList();
    if (changes.length) {
      html += '<div class="card warn"><h2>Changed since your last sync</h2><p>Royal changed ' +
        (changes.length === 1 ? 'a starred event' : changes.length + ' starred events') + '. Moved stars follow ' +
        'the new time, and so do their reminders.</p><div class="rows">' + changes.map(function(c) {
          return '<div class="chg"><b>' + esc(c.title) + '</b><span>' + esc(starChangeText(c)) + '</span></div>';
        }).join('') + '</div></div>';
    }
    $('status').innerHTML = html;
  }

  // Starred events the last sync moved or cancelled (index.js useBundle).
  function starChangeList() {
    return (S.starChanges && Array.isArray(S.starChanges.list)) ? S.starChanges.list : [];
  }

  function starChangeText(c) {
    var was = dayLabel(c.date) + ' ' + shortClock(c.time);
    if (c.kind === 'moved') {
      var timeChanged = c.to.date !== c.date || c.to.time !== c.time;
      var now = [timeChanged ? dayLabel(c.to.date) + ' ' + shortClock(c.to.time) : '',
                 c.to.venue !== c.venue ? c.to.venue : ''].filter(Boolean);
      var old = [timeChanged ? was : '', c.to.venue !== c.venue ? c.venue : ''].filter(Boolean);
      return 'Moved: now ' + now.join(', ') + ' (was ' + old.join(', ') + '). Still starred.';
    }
    if (c.kind === 'check') {
      return 'Was ' + was + '. Royal lists ' + (c.options || 'several') + ' new times; star the one you want ' +
        'under Events.';
    }
    return 'Cancelled (was ' + was + (c.venue ? ', ' + c.venue : '') + '). Star removed.';
  }

  // ---- Ship and sailing pickers
  function fillShips() {
    var sel = $('ship');
    var current = S.cruise ? S.cruise.shipCode : '';
    var html = '<option value="">Choose a ship</option>';
    (S.ships || []).forEach(function(s) {
      html += '<option value="' + esc(s.code) + '"' + (s.code === current ? ' selected' : '') + '>' +
        esc(s.name) + '</option>';
    });
    if (current && !(S.ships || []).some(function(s) { return s.code === current; })) {
      html += '<option value="' + esc(current) + '" selected>' + esc(S.cruise.shipName) + '</option>';
    }
    sel.innerHTML = html;
  }

  function useDateInput(message) {
    $('sailing').style.display = 'none';
    var input = $('sailDate');
    input.style.display = 'block';
    if (!input.value && S.cruise && $('ship').value === S.cruise.shipCode) {
      input.value = S.cruise.sailDate;
    }
    $('sailHelp').textContent = message;
    $('sailHelp').className = 'help';
    updateDownload();
  }

  function apiGet(path, onJson, onFail) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', S.api + path, true);
    xhr.setRequestHeader('AppKey', S.appKey);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 20000;
    xhr.onload = function() {
      if (xhr.status >= 400) {
        onFail('error ' + xhr.status);
        return;
      }
      onJson(xhr.responseText);
    };
    xhr.onerror = xhr.ontimeout = function() { onFail('no internet?'); };
    xhr.send();
  }

  // Same rules as royal.js parseShips/shipName.
  function refreshShips() {
    apiGet('/en/royal/web/v2/ships', function(text) {
      var list = [];
      try {
        list = (JSON.parse(text).payload.ships || []).filter(function(s) { return s.brand === 'R'; })
          .map(function(s) {
            var n = String(s.name || s.shipCode);
            if (n === n.toUpperCase()) {
              n = n.toLowerCase().replace(/\b[a-z]/g, function(c) { return c.toUpperCase(); })
                .replace(/ Of The /g, ' of the ');
            }
            return {code: s.shipCode, name: n};
          })
          .sort(function(a, b) { return a.name < b.name ? -1 : 1; });
      } catch (e) {
        list = [];
      }
      if (list.length) {
        fetchedShips = list;
        S.ships = list;
        var keep = $('ship').value;
        fillShips();
        if (keep) {
          $('ship').value = keep;
        }
      }
    }, function() {
      if (!(S.ships || []).length) {
        $('sailHelp').textContent = 'Couldn\'t load the ship list (no internet?). Connect and reopen settings.';
      }
    });
  }

  function loadSailings() {
    var code = $('ship').value;
    sailingsFor = code;
    var sel = $('sailing');
    sel.style.display = 'block';
    $('sailDate').style.display = 'none';
    $('sailHelp').textContent = '';
    if (!code) {
      sel.innerHTML = '<option value="">Choose a ship first</option>';
      sel.disabled = true;
      updateDownload();
      return;
    }
    sel.disabled = true;
    sel.innerHTML = '<option value="">Loading sailings...</option>';
    updateDownload();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', S.api + '/en/royal/web/v3/ships/' + encodeURIComponent(code) + '/voyages', true);
    xhr.setRequestHeader('AppKey', S.appKey);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 20000;
    xhr.onload = function() {
      if (sailingsFor !== code) {
        return;
      }
      var dates = {};
      var re = /"sailDate"\s*:\s*"(\d{8})"/g;
      var m;
      while ((m = re.exec(xhr.responseText))) {
        var iso = m[1].slice(0, 4) + '-' + m[1].slice(4, 6) + '-' + m[1].slice(6, 8);
        if (iso >= S.oldestSailDate) {
          dates[iso] = true;
        }
      }
      var list = Object.keys(dates).sort();
      if (xhr.status >= 400 || !list.length) {
        useDateInput(xhr.status >= 400 ? 'Couldn\'t load sailings (error ' + xhr.status + '). Enter the sail date:'
                                       : 'No upcoming sailings listed. Enter the sail date:');
        return;
      }
      var current = S.cruise && S.cruise.shipCode === code ? S.cruise.sailDate : '';
      var html = '<option value="">Choose a sailing</option>';
      list.forEach(function(iso) {
        html += '<option value="' + iso + '"' + (iso === current ? ' selected' : '') + '>' + niceDate(iso) + '</option>';
      });
      sel.innerHTML = html;
      sel.disabled = false;
      updateDownload();
    };
    xhr.onerror = xhr.ontimeout = function() {
      if (sailingsFor === code) {
        useDateInput('Couldn\'t load sailings (no internet?). Enter the sail date:');
      }
    };
    xhr.send();
  }

  function chosenDate() {
    return $('sailDate').style.display === 'block' ? $('sailDate').value : $('sailing').value;
  }

  function updateDownload() {
    $('download').disabled = !($('ship').value && /^\d{4}-\d{2}-\d{2}$/.test(chosenDate()));
  }

  $('ship').addEventListener('change', loadSailings);
  $('sailing').addEventListener('change', updateDownload);
  $('sailDate').addEventListener('input', updateDownload);

  // ---- Paste-in backup
  function checkPaste() {
    var text = $('paste').value.trim();
    var help = $('pasteHelp');
    pastedBundle = null;
    if (!text) {
      help.textContent = '';
      return;
    }
    var b;
    try {
      b = JSON.parse(text);
    } catch (e) {
      help.textContent = 'That isn\'t complete cruise data. Paste the whole text from the sync tool.';
      help.className = 'help error';
      return;
    }
    var ok = b && b.format === 'cruise-watch' && b.v === 1 && /^\d{4}-\d{2}-\d{2}$/.test(b.sailDate || '') &&
      Array.isArray(b.itinerary) && b.itinerary.length && b.schedule && Array.isArray(b.schedule.events);
    if (!ok) {
      help.textContent = b && b.format === 'cruise-watch' && b.v !== 1
        ? 'This data is from a newer version of the sync tool. Update Royal Pebble.'
        : 'That isn\'t Royal Pebble data.';
      help.className = 'help error';
      return;
    }
    pastedBundle = b;
    help.textContent = 'Looks good: ' + ((b.ship && b.ship.name) || 'ship') + ', sails ' + niceDate(b.sailDate) +
      ', ' + (b.schedule.events.length ? b.schedule.events.length + ' events' : 'schedule not published yet') +
      '. Tap Save to use it.';
    help.className = 'help ok';
  }
  $('paste').addEventListener('input', checkPaste);

  // ---- Past days and finished events are hidden (same rules as the watch):
  // a watch day ends at 04:00 the next morning; an event is finished at its end,
  // or 30 minutes after it starts when it has no length. Uses the phone's clock.
  var FINISHED_GRACE = 30;
  function epochDays(iso) {
    var p = iso.split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  var sailDays = S.cruise ? epochDays(S.cruise.sailDate) : 0;
  function nowCruise() {
    var d = new Date();
    return (Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) - sailDays) * 1440 +
      d.getHours() * 60 + d.getMinutes();
  }
  function dayIsPast(iso) {
    return S.cruise ? nowCruise() >= (epochDays(iso) - sailDays + 1) * 1440 + 240 : false;
  }
  // Untimed entries last until their day ends.
  function isFinished(date, time, minutes) {
    if (!S.cruise) {
      return false;
    }
    if (dayIsPast(date)) {
      return true;
    }
    var m = mins(time);
    if (m === null) {
      return false;
    }
    var start = (epochDays(date) - sailDays) * 1440 + (m < 240 ? m + 1440 : m);
    return start + (minutes > 0 ? minutes : FINISHED_GRACE) <= nowCruise();
  }

  // ---- Days: per-day ship/local offset, all-aboard buffer or exact time, and
  // itinerary edits (skipped or added ports). Same rules as slice.js buildDay.
  var itinerary = S.itinerary || [];
  var days = {};       // date -> {offset, buffer, allAboard, edit}, being edited
  var openDay = null;  // date of the expanded card
  var showEdit = {};   // date -> itinerary edit fields shown
  var TYPE_NAMES = {EMBARK: 'Embark', DEBARK: 'Debark', DOCKED: 'Docked', TENDERED: 'Tender', CRUISING: 'At sea'};
  itinerary.forEach(function(d) {
    days[d.date] = JSON.parse(JSON.stringify((S.days || {})[d.date] || {}));
    showEdit[d.date] = !!days[d.date].edit;
  });

  function mins(hhmm) {
    if (!hhmm) {
      return null;
    }
    var p = hhmm.split(':');
    return (+p[0]) * 60 + (+p[1]);
  }

  function hhmm(m) {
    m = ((m % 1440) + 1440) % 1440;
    return (m < 600 ? '0' : '') + Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60);
  }

  // "1:00 PM"; times past midnight say so.
  function clock(m) {
    var t = ((m % 1440) + 1440) % 1440;
    var h = Math.floor(t / 60);
    var s = (h % 12 === 0 ? 12 : h % 12) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60) + (h < 12 ? ' AM' : ' PM');
    return s + (m >= 1440 ? ' (next day)' : (m < 0 ? ' (day before)' : ''));
  }

  function afterMidnight(m, arrive) {
    if (m === null) {
      return null;
    }
    return m < 240 || (arrive !== null && m < arrive) ? m + 1440 : m;
  }

  function shortPort(port) {
    var name = (port || '').split(',')[0];
    var paren = name.match(/\(([^)]+)\)/);
    return (paren ? paren[1] : name).trim();
  }

  function typeName(t) {
    return TYPE_NAMES[t] || (t ? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ') : 'Port');
  }

  // Same as slice.js defaultBuffer: tender ports get 60 minutes.
  function defaultBuffer(type) {
    return /TENDER/.test(type || '') ? 60 : 30;
  }

  // Royal's day with this page's edits applied.
  function effective(d) {
    var e = days[d.date].edit || {};
    var out = {};
    ['type', 'port', 'arrive', 'depart'].forEach(function(k) {
      out[k] = e.hasOwnProperty(k) ? e[k] : d[k];
    });
    return out;
  }

  // {ship: all-aboard in ship time, depart: local, exact}, minutes from the day's
  // midnight; null where there is none.
  function allAboardOf(d) {
    var set = days[d.date];
    var it = effective(d);
    var depart = afterMidnight(mins(it.depart), mins(it.arrive));
    if (it.type === 'DEBARK' || it.type === 'CRUISING') {
      return {ship: null, depart: depart};
    }
    if (set.allAboard != null) {
      return {ship: afterMidnight(mins(set.allAboard), null), depart: depart, exact: true};
    }
    var buffer = set.buffer || defaultBuffer(it.type);
    return {ship: depart === null ? null : depart - (set.offset || 0) - buffer, depart: depart};
  }

  function offsetText(o) {
    if (!o) {
      return 'Same as ship';
    }
    var a = Math.abs(o);
    var t = a % 60 ? Math.floor(a / 60) + ':' + (a % 60 < 10 ? '0' : '') + (a % 60) + ' h' :
      (a / 60) + (a === 60 ? ' hour' : ' hours');
    return (o > 0 ? '+' : '&minus;') + t;
  }

  // Drops defaults and edits that match Royal, so "Edited" means something changed.
  function prune(d) {
    var set = days[d.date];
    if (!set.offset) {
      delete set.offset;
    }
    if (set.buffer === defaultBuffer(effective(d).type)) {
      delete set.buffer;
    }
    if (set.edit) {
      Object.keys(set.edit).forEach(function(k) {
        if (set.edit[k] === d[k]) {
          delete set.edit[k];
        }
      });
      if (!Object.keys(set.edit).length) {
        delete set.edit;
      }
    }
  }

  function isEdited(date) {
    var set = days[date];
    return Object.keys(set).some(function(k) { return k !== 'allAboard' || set.allAboard; });
  }

  function dayTitle(d) {
    var it = effective(d);
    var dt = dateObj(d.date);
    return DAYS[dt.getDay()] + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getDate() + ' &middot; ' +
      esc(it.type === 'CRUISING' ? 'At sea' : (shortPort(it.port) || 'Port'));
  }

  function daySummary(d) {
    var it = effective(d);
    var arrive = mins(it.arrive);
    var depart = afterMidnight(mins(it.depart), arrive);
    var line;
    if (it.type === 'CRUISING') {
      line = 'At sea';
    } else if (it.type === 'EMBARK') {
      line = 'Embark' + (depart !== null ? ' &middot; sails ' + clock(depart) : '');
    } else if (it.type === 'DEBARK') {
      line = 'Debark' + (arrive !== null ? ' &middot; arrives ' + clock(arrive) : '');
    } else {
      line = esc(typeName(it.type)) + (arrive !== null || depart !== null ?
        ' &middot; ' + (arrive !== null ? clock(arrive) : '?') + ' &ndash; ' +
        (depart !== null ? clock(depart) : '?') + ' local' : '');
    }
    var aa = allAboardOf(d);
    if (aa.ship !== null && openDay !== d.date) {
      line += '<br>All aboard ' + clock(aa.ship) + ' ship time';
    }
    return line;
  }

  function seg(act, options, current) {
    return '<div class="seg">' + options.map(function(o) {
      return '<button data-act="' + act + '" data-v="' + esc(o[0]) + '" aria-pressed="' + (o[0] === current) + '">' +
        o[1] + '</button>';
    }).join('') + '</div>';
  }

  function dayBody(d, i) {
    var set = days[d.date];
    var it = effective(d);
    var id = 'd' + i;
    var html = '';
    var aa = allAboardOf(d);
    var offset = set.offset || 0;

    if (it.type !== 'CRUISING') {
      html += '<label>Local time vs ship time</label><div class="stepper">' +
        '<button data-act="offset" data-v="-60" aria-label="Local time one hour earlier">&minus;</button>' +
        '<output>' + offsetText(offset) + '</output>' +
        '<button data-act="offset" data-v="60" aria-label="Local time one hour later">+</button></div>' +
        '<p class="help">' + (offset ? 'Local time is ' + offsetText(Math.abs(offset)).slice(1) +
          (offset > 0 ? ' ahead of' : ' behind') + ' ship time. ' : '') +
        'Royal lists port times in local time; the watch counts down in ship time.</p>';
    }

    if (it.type !== 'CRUISING' && it.type !== 'DEBARK') {
      html += '<label>All aboard</label>' +
        seg('aboard', [['30', '30 min'], ['45', '45 min'], ['60', '60 min'], ['exact', 'Exact']],
            aa.exact ? 'exact' : String(set.buffer || defaultBuffer(it.type)));
      if (aa.exact) {
        html += '<label for="' + id + 'aa">All-aboard time (ship time)</label>' +
          '<input type="time" id="' + id + 'aa" data-f="allAboard" value="' + esc(set.allAboard || '') + '">';
      } else {
        html += '<p class="help">Before departure. ' + (defaultBuffer(it.type) === 60 ?
          'Tender port: 60 min unless you change it.' : 'Allow more time at tender ports.') + '</p>';
      }
      if (aa.ship !== null) {
        html += '<div class="result"><small>ALL ABOARD</small><strong>' + clock(aa.ship) + ' ship' +
          (offset ? ' &middot; ' + clock(aa.ship + offset) + ' local' : ' and local') + '</strong>' +
          (aa.depart !== null ? '<span>Departs ' + clock(aa.depart) + ' local' +
            (offset ? ' &middot; ' + clock(aa.depart - offset) + ' ship' : '') + '</span>' : '') + '</div>';
      } else {
        html += '<p class="help error">' + (aa.exact ? 'Enter the all-aboard time.' :
          'No departure time, so no countdown. Add one ' + (showEdit[d.date] ? 'below' : 'under Change itinerary') +
          ', or pick Exact.') + '</p>';
      }
    }

    html += '<div class="edit">';
    if (!showEdit[d.date]) {
      html += '<button class="textbtn" data-act="showEdit">Change itinerary</button>';
    } else {
      if (d.type !== 'EMBARK' && d.type !== 'DEBARK') {
        var types = [['DOCKED', 'Docked'], ['TENDERED', 'Tender'], ['CRUISING', 'At sea']];
        if (!TYPE_NAMES[d.type]) {
          types.unshift([d.type, typeName(d.type)]);
        }
        html += '<label>Day</label>' + seg('type', types, it.type) +
          '<p class="help">Skipped port: pick At sea. Added port: pick Docked or Tender and fill in the times.</p>';
      }
      if (it.type !== 'CRUISING') {
        html += '<label for="' + id + 'port">Port</label><input id="' + id + 'port" data-f="port" maxlength="60" ' +
          'value="' + esc(it.port) + '"><div class="times">';
        if (it.type !== 'EMBARK') {
          html += '<div><label for="' + id + 'arr">Arrives (local)</label><input type="time" id="' + id +
            'arr" data-f="arrive" value="' + esc(it.arrive || '') + '"></div>';
        }
        if (it.type !== 'DEBARK') {
          html += '<div><label for="' + id + 'dep">Departs (local)</label><input type="time" id="' + id +
            'dep" data-f="depart" value="' + esc(it.depart || '') + '"></div>';
        }
        html += '</div>';
      }
      if (set.edit) {
        var dep = afterMidnight(mins(d.depart), mins(d.arrive));
        html += '<p class="help">Royal\'s itinerary: ' + esc(typeName(d.type)) +
          (d.type !== 'CRUISING' ? ', ' + esc(shortPort(d.port)) : '') +
          (d.arrive ? ', arrives ' + clock(mins(d.arrive)) : '') + (dep !== null ? ', departs ' + clock(dep) : '') +
          '. Your changes stay when you download again.</p>';
      }
    }
    if (isEdited(d.date)) {
      html += '<button class="textbtn" data-act="reset">Undo all changes to this day</button>';
    }
    return html + '</div>';
  }

  function renderDays() {
    if (!itinerary.length) {
      $('dayList').innerHTML = '<div class="card hero"><h2>No cruise data yet</h2><p>Download your sailing on ' +
        'the Cruise screen, then set each day\'s all-aboard time and ship clock here.</p></div>';
      return;
    }
    var past = itinerary.filter(function(d) { return dayIsPast(d.date); }).length;
    if (past === itinerary.length) {
      $('dayList').innerHTML = '<div class="card"><h2>Your cruise has ended</h2><p class="muted">Past days are ' +
        'hidden. Welcome home!</p></div>';
      return;
    }
    $('dayList').innerHTML = (past ? '<p class="help" style="margin:0 2px 8px">' + past + ' past day' +
      (past === 1 ? ' is' : 's are') + ' hidden.</p>' : '') + itinerary.map(function(d, i) {
      if (dayIsPast(d.date)) {
        return '';
      }
      var open = openDay === d.date;
      return '<div class="day' + (open ? ' open' : '') + '" data-date="' + esc(d.date) + '">' +
        '<button class="day-head" data-act="toggle" aria-expanded="' + open + '"><span class="t"><b>' + dayTitle(d) +
        '</b><span class="muted">' + daySummary(d) + '</span></span>' +
        (isEdited(d.date) ? '<span class="chip">Edited</span>' : '') +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z"/></svg>' +
        '</button>' + (open ? '<div class="day-body">' + dayBody(d, i) + '</div>' : '') + '</div>';
    }).join('');
  }

  function dayOf(el) {
    var card = el.closest('.day');
    var date = card && card.getAttribute('data-date');
    for (var i = 0; i < itinerary.length; i++) {
      if (itinerary[i].date === date) {
        return itinerary[i];
      }
    }
    return null;
  }

  function setEdit(d, field, value) {
    var set = days[d.date];
    set.edit = set.edit || {};
    set.edit[field] = value;
  }

  $('dayList').addEventListener('click', function(ev) {
    var btn = ev.target.closest('[data-act]');
    var d = btn && dayOf(btn);
    if (!d) {
      return;
    }
    var set = days[d.date];
    var v = btn.getAttribute('data-v');
    switch (btn.getAttribute('data-act')) {
      case 'toggle':
        openDay = openDay === d.date ? null : d.date;
        break;
      case 'offset':
        set.offset = Math.max(-720, Math.min(720, (set.offset || 0) + (+v)));
        break;
      case 'aboard':
        if (v === 'exact') {
          if (set.allAboard == null) {
            var aa = allAboardOf(d);
            set.allAboard = aa.ship !== null ? hhmm(aa.ship) : '';
          }
        } else {
          delete set.allAboard;
          set.buffer = +v;
        }
        break;
      case 'type':
        setEdit(d, 'type', v);
        if (v === 'CRUISING') {
          ['port', 'arrive', 'depart'].forEach(function(k) { delete set.edit[k]; });
          delete set.allAboard;
        } else if (d.type === 'CRUISING' && !set.edit.hasOwnProperty('port')) {
          set.edit.port = '';  // Royal's "Cruising" isn't a port name
        }
        break;
      case 'showEdit':
        showEdit[d.date] = true;
        break;
      case 'reset':
        days[d.date] = {};
        showEdit[d.date] = false;
        break;
    }
    prune(d);
    renderDays();
  });

  $('dayList').addEventListener('change', function(ev) {
    var f = ev.target.getAttribute('data-f');
    var d = f && dayOf(ev.target);
    if (!d) {
      return;
    }
    var value = ev.target.value.trim();
    if (f === 'allAboard') {
      days[d.date].allAboard = value;
    } else {
      setEdit(d, f, f === 'port' ? value : (value || null));
    }
    prune(d);
    renderDays();
  });

  // ---- Filters: Royal's featured events on/off, and categories to hide. Hidden
  // entries are "Category" or "Category / Subcategory", as slice.js reads them.
  var categories = S.categories || [];
  var hidden = (S.hiddenCats || ['Shop']).slice();
  var openCat = null;

  $('featured').setAttribute('aria-checked', String(S.showFeatured !== false));
  $('featured').addEventListener('click', function() {
    $('featured').setAttribute('aria-checked', String(!featuredOn()));
  });
  function featuredOn() {
    return $('featured').getAttribute('aria-checked') === 'true';
  }

  function subKey(cat, sub) {
    return cat + ' / ' + sub;
  }

  function without(key) {
    hidden = hidden.filter(function(h) { return h !== key; });
  }

  function subShown(c, sub) {
    return hidden.indexOf(c.name) === -1 && hidden.indexOf(subKey(c.name, sub)) === -1;
  }

  function catSummary(c) {
    if (hidden.indexOf(c.name) !== -1) {
      return 'Hidden' + (c.name === 'Shop' ? ' &middot; mostly promotions' : '') + ' &middot; ' + c.n + ' events';
    }
    var shown = c.subs.filter(function(s) { return subShown(c, s.name); });
    var n = shown.reduce(function(t, s) { return t + s.n; }, 0);
    return (c.subs.length > 1 ? shown.length + ' of ' + c.subs.length + ' subcategories &middot; ' : '') +
      n + (n === 1 ? ' event' : ' events');
  }

  function renderCats() {
    if (!categories.length) {
      $('catList').innerHTML = '<div class="card"><h2>Categories</h2><p class="muted">' +
        (S.cruise ? 'They appear here once Royal publishes the activity schedule, about two weeks before ' +
          'sailing. Shop is hidden until then.' : 'Download your sailing on the Cruise screen first.') + '</p></div>';
      return;
    }
    $('catList').innerHTML = '<div class="cats">' + categories.map(function(c, i) {
      var on = hidden.indexOf(c.name) === -1;
      var open = openCat === c.name && on && c.subs.length > 1;
      var html = '<div class="cat' + (open ? ' open' : '') + '" data-i="' + i + '"><div class="switch-row">' +
        '<span class="t"><button class="cat-name" data-act="open" aria-expanded="' + open + '"><b>' + esc(c.name) +
        '</b><span class="muted">' + catSummary(c) + '</span></button></span>' +
        '<button class="switch" role="switch" data-act="cat" aria-checked="' + on + '" aria-label="' + esc(c.name) +
        '"></button></div>';
      if (open) {
        html += '<div class="chips">' + c.subs.map(function(s, j) {
          var shown = subShown(c, s.name);
          return '<button class="fchip" data-act="sub" data-j="' + j + '" aria-pressed="' + shown + '">' +
            (shown ? '&check; ' : '') + esc(s.name || 'Other') + '</button>';
        }).join('') + '</div>';
      }
      return html + '</div>';
    }).join('') + '</div>';
  }

  $('catList').addEventListener('click', function(ev) {
    var btn = ev.target.closest('[data-act]');
    var row = btn && btn.closest('.cat');
    if (!row) {
      return;
    }
    var c = categories[+row.getAttribute('data-i')];
    var act = btn.getAttribute('data-act');
    if (act === 'open') {
      openCat = openCat === c.name ? null : c.name;
    } else if (act === 'cat') {
      var on = hidden.indexOf(c.name) === -1;
      // Either way the subcategory choices start over.
      c.subs.forEach(function(s) { without(subKey(c.name, s.name)); });
      if (on) {
        hidden.push(c.name);
      } else {
        without(c.name);
      }
    } else if (act === 'sub') {
      var key = subKey(c.name, c.subs[+btn.getAttribute('data-j')].name);
      if (hidden.indexOf(key) === -1) {
        hidden.push(key);
      } else {
        without(key);
      }
      // All subcategories hidden: hide the category instead.
      if (c.subs.every(function(s) { return !subShown(c, s.name); })) {
        c.subs.forEach(function(s) { without(subKey(c.name, s.name)); });
        hidden.push(c.name);
      }
    }
    renderCats();
  });

  // ---- Events: browse the schedule, star events, and add personal entries.
  // Stars are keyed like slice.js starKey; only changes made here go back to
  // the phone, so stars set on the watch meanwhile aren't overwritten.
  var sched = S.schedule || null;
  var savedStars = S.stars || {};
  var starChanges = {};  // key -> true/false
  var starTimes = {};    // key -> when it was changed (ms), so the latest change wins
  var personal = (S.personal || []).slice();
  var editing = null;    // index in personal, -1 for a new entry, null when closed
  var allEvents = [];
  var evDates = [];
  var evDay = null;      // a date, or 'starred'
  var STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 ' +
    '1-6.1-4.4-4.3 6.1-.9z"/></svg>';

  function starKey(title, date, time, venue) {
    return [title, date, time || '', venue || ''].join('|');
  }

  // Minutes for sorting within a day; before 04:00 is after midnight, untimed first.
  function dayMinutes(time) {
    var m = mins(time);
    return m === null ? -1 : (m < 240 ? m + 1440 : m);
  }

  // "5:30p", as on the watch.
  function shortClock(time) {
    var m = mins(time);
    if (m === null) {
      return 'All day';
    }
    var h = Math.floor(m / 60);
    return (h % 12 === 0 ? 12 : h % 12) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60) + (h < 12 ? 'a' : 'p');
  }

  function dayLabel(iso) {
    var d = dateObj(iso);
    return DAYS[d.getDay()] + ' ' + d.getDate();
  }

  if (sched && sched.events) {
    var fi = {};
    (sched.fields || []).forEach(function(name, i) { fi[name] = i; });
    allEvents = sched.events.map(function(row) {
      var e = {
        title: row[fi.title], venue: (sched.venues || [])[row[fi.venue]] || '',
        cat: (sched.cats || [])[row[fi.cat]] || [], date: row[fi.date], time: row[fi.time],
        minutes: row[fi.minutes] || 0, featured: !!row[fi.featured], reservation: !!row[fi.reservation]
      };
      e.key = starKey(e.title, e.date, e.time, e.venue);
      e.search = (e.title + ' ' + e.venue).toLowerCase();
      return e;
    }).sort(function(a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : dayMinutes(a.time) - dayMinutes(b.time) ||
        (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
    });
  }
  evDates = itinerary.map(function(d) { return d.date; });
  if (!evDates.length) {
    allEvents.forEach(function(e) {
      if (evDates.indexOf(e.date) === -1) {
        evDates.push(e.date);
      }
    });
  }
  var cruiseOver = evDates.length > 0 && evDates.every(dayIsPast);
  evDates = evDates.filter(function(d) { return !dayIsPast(d); });
  (function pickToday() {
    var now = new Date(Date.now() - 4 * 3600 * 1000);  // watch days start at 04:00
    var iso = now.getFullYear() + '-' + (now.getMonth() < 9 ? '0' : '') + (now.getMonth() + 1) + '-' +
      (now.getDate() < 10 ? '0' : '') + now.getDate();
    evDay = evDates.indexOf(iso) !== -1 ? iso : evDates[0] || null;
  })();

  // Stars the last sync moved to a new time or venue, by their new key.
  var movedTo = {};
  starChangeList().forEach(function(c) {
    if (c.kind === 'moved') {
      movedTo[starKey(c.title, c.to.date, c.to.time, c.to.venue)] = c;
    }
  });

  function isStarred(key) {
    return starChanges.hasOwnProperty(key) ? starChanges[key] : !!savedStars[key];
  }

  function hiddenOnWatch(e) {
    return hidden.indexOf(e.cat[0]) !== -1 || hidden.indexOf(e.cat[0] + ' / ' + (e.cat[1] || '')) !== -1;
  }

  function lengthText(e) {
    if (!e.minutes) {
      return '';
    }
    if (e.minutes >= 120 && e.time) {
      var end = (dayMinutes(e.time) + e.minutes) % 1440;
      return 'until ' + shortClock(hhmm(end));
    }
    return e.minutes + ' min';
  }

  function eventRow(e, withDate) {
    var on = isStarred(e.key);
    var bits = [];
    if (withDate) {
      bits.push(esc(dayLabel(e.date)));
    }
    if (e.venue) {
      bits.push(VS ? '<button class="vlink" data-act="venue" data-venue="' + esc(e.venue) + '">' + esc(e.venue) +
        '</button>' : esc(e.venue));
    }
    if (lengthText(e)) {
      bits.push(lengthText(e));
    }
    if (e.reservation) {
      bits.push('Reservation');
    }
    if (movedTo[e.key]) {
      var c = movedTo[e.key];
      bits.push('<span class="moved">Moved, was ' + (c.to.time !== c.time || c.to.date !== c.date ?
        esc(shortClock(c.time)) : esc(c.venue)) + '</span>');
    }
    return '<div class="ev"><span class="tm">' + shortClock(e.time) + '</span><span class="t"><b>' + esc(e.title) +
      '</b><span class="muted">' + bits.join(' &middot; ') + '</span></span>' +
      '<button class="star" data-act="star" data-key="' + esc(e.key) + '" aria-pressed="' + on + '" aria-label="' +
      (on ? 'Unstar ' : 'Star ') + esc(e.title) + '">' + STAR_SVG + '</button></div>';
  }

  function renderEvDays() {
    $('evDays').innerHTML = (evDates.length ? [['starred', '&starf; Starred']] : []).concat(evDates.map(function(d) {
      return [d, esc(dayLabel(d))];
    })).map(function(c) {
      return '<button class="fchip" data-day="' + c[0] + '" aria-pressed="' + (evDay === c[0]) + '">' + c[1] +
        '</button>';
    }).join('');
  }

  function entryForm() {
    var p = editing >= 0 ? personal[editing] : {title: '', venue: '', date: evDay !== 'starred' && evDay || evDates[0],
                                                time: '', minutes: 0};
    var lengths = [[0, 'Not set'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'],
                   [180, '3 hours']];
    if (p.minutes && !lengths.some(function(l) { return l[0] === p.minutes; })) {
      lengths.push([p.minutes, p.minutes + ' min']);
    }
    return '<label for="peTitle">What</label><input id="peTitle" maxlength="63" placeholder="Dinner" value="' +
      esc(p.title) + '">' +
      '<label for="peVenue">Where</label><input id="peVenue" maxlength="31" placeholder="Main Dining Room" value="' +
      esc(p.venue) + '"><div class="times"><div><label for="peDate">Day</label><select id="peDate">' +
      evDates.map(function(d) {
        return '<option value="' + d + '"' + (d === p.date ? ' selected' : '') + '>' + esc(dayLabel(d)) + '</option>';
      }).join('') + '</select></div><div><label for="peTime">Time</label><input type="time" id="peTime" value="' +
      esc(p.time || '') + '"></div></div>' +
      '<label for="peLen">Length</label><select id="peLen">' + lengths.map(function(l) {
        return '<option value="' + l[0] + '"' + (l[0] === (p.minutes || 0) ? ' selected' : '') + '>' + l[1] + '</option>';
      }).join('') + '</select>' +
      '<p class="help">A time before 4:00 AM counts as that night, after midnight. With a time, you get a reminder ' +
      'like starred events.</p><p class="help error" id="peErr"></p>' +
      '<div class="form-actions"><button class="pill filled" data-act="peSave">' + (editing >= 0 ? 'Update' : 'Add') +
      '</button><button class="pill tonal" data-act="peCancel">Cancel</button>' +
      (editing >= 0 ? '<button class="textbtn" data-act="peDelete">Delete entry</button>' : '') + '</div>';
  }

  function renderMine() {
    if (!evDates.length) {
      $('evMine').innerHTML = '';
      return;
    }
    var html = '<div class="mine"><div class="mine-head"><small>MY ENTRIES</small>' +
      (editing === null ? '<button class="addbtn" data-act="peAdd">+ Add</button>' : '') + '</div>';
    if (editing !== null) {
      html += entryForm();
    } else {
      var list = personal.map(function(p, i) { return {p: p, i: i}; }).filter(function(x) {
        return (evDay === 'starred' || x.p.date === evDay) && !isFinished(x.p.date, x.p.time, x.p.minutes);
      }).sort(function(a, b) {
        return a.p.date < b.p.date ? -1 : a.p.date > b.p.date ? 1 : dayMinutes(a.p.time) - dayMinutes(b.p.time);
      });
      html += list.length ? list.map(function(x) {
        return '<button class="ev" data-act="peEdit" data-i="' + x.i + '"><span class="tm">' + shortClock(x.p.time) +
          '</span><span class="t"><b>' + esc(x.p.title) + '</b><span class="muted">' +
          [evDay === 'starred' ? esc(dayLabel(x.p.date)) : '', esc(x.p.venue),
           x.p.minutes ? x.p.minutes + ' min' : ''].filter(Boolean).join(' &middot; ') + '</span></span></button>';
      }).join('') : '<p class="muted">Dinner reservations, shows you booked, meet-ups. They show on the watch ' +
        'with a reminder.</p>';
    }
    $('evMine').innerHTML = html + '</div>';
  }

  function renderEvList() {
    var q = $('evSearch').value.trim().toLowerCase();
    var html = '';
    if (cruiseOver) {
      html = '<div class="card"><h2>Your cruise has ended</h2><p class="muted">Past days are hidden.</p></div>';
    } else if (!evDates.length) {
      html = '<div class="card hero"><h2>No cruise data yet</h2><p>Download your sailing on the Cruise screen to ' +
        'browse and star events.</p></div>';
    } else if (!allEvents.length) {
      html = '<div class="card"><h2>Schedule not published yet</h2><p class="muted">Royal usually publishes it ' +
        'about two weeks before sailing. Download again then. You can add your own entries now.</p></div>';
    } else {
      var list;
      var hiddenCount = 0;
      var finishedCount = 0;
      var upcoming = allEvents.filter(function(e) {
        if (e.finished === undefined) {
          e.finished = isFinished(e.date, e.time, e.minutes);
        }
        if (e.finished && e.date === evDay && !q) {
          finishedCount++;
        }
        return !e.finished;
      });
      if (q) {
        // A venue's name also finds events listed under its other names.
        var qVenue = VS ? V.lookup(vTable, q) : null;
        list = upcoming.filter(function(e) {
          return e.search.indexOf(q) !== -1 || (qVenue !== null && vCanon[e.venue] === qVenue);
        });
      } else if (evDay === 'starred') {
        list = upcoming.filter(function(e) { return isStarred(e.key); });
      } else {
        list = upcoming.filter(function(e) {
          if (e.date !== evDay) {
            return false;
          }
          if (hiddenOnWatch(e) && !isStarred(e.key)) {
            hiddenCount++;
            return false;
          }
          return true;
        });
      }
      var shown = list.slice(0, 150);
      html = shown.length ? '<div class="ev-list">' + shown.map(function(e) {
        return eventRow(e, !!q || evDay === 'starred');
      }).join('') + '</div>' : '<div class="card"><p class="muted">' + (q ? 'No events match.' :
        evDay === 'starred' ? 'Nothing starred coming up. Tap the star next to an event, here or on the watch ' +
          '(hold Select).' : 'No events this day.') + '</p></div>';
      if (list.length > shown.length) {
        html += '<p class="help">Showing the first ' + shown.length + ' of ' + list.length + '. Search to narrow it down.</p>';
      }
      if (hiddenCount) {
        html += '<p class="help">' + hiddenCount + ' more in categories hidden under Filters.</p>';
      }
      var lost = starChangeList().filter(function(c) { return c.kind !== 'moved'; });
      if (evDay === 'starred' && !q && lost.length) {
        html = '<div class="card warn"><h2>Changed since your last sync</h2>' + lost.map(function(c) {
          return '<div class="chg"><b>' + esc(c.title) + '</b><span>' + esc(starChangeText(c)) + '</span></div>';
        }).join('') + '</div>' + html;
      }
      if (finishedCount) {
        html = '<p class="help" style="margin:0 2px 8px">' + finishedCount + ' finished event' +
          (finishedCount === 1 ? ' is' : 's are') + ' hidden.</p>' + html;
      }
    }
    $('evList').innerHTML = html;
  }

  function renderEvents() {
    renderEvDays();
    renderMine();
    renderEvList();
  }

  $('evSearch').addEventListener('input', renderEvList);

  $('evDays').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-day]');
    if (b) {
      evDay = b.getAttribute('data-day');
      $('evSearch').value = '';
      renderEvents();
    }
  });

  $('evList').addEventListener('click', function(ev) {
    var vb = ev.target.closest('[data-act=venue]');
    if (vb) {
      openVenue(vCanon[vb.getAttribute('data-venue')] || vb.getAttribute('data-venue'), 'events', null);
      return;
    }
    var b = ev.target.closest('[data-act=star]');
    if (!b) {
      return;
    }
    var key = b.getAttribute('data-key');
    var on = !isStarred(key);
    if (on === !!savedStars[key]) {
      delete starChanges[key];
      delete starTimes[key];
    } else {
      starChanges[key] = on;
      starTimes[key] = Date.now();
    }
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', (on ? 'Unstar ' : 'Star ') + b.closest('.ev').querySelector('b').textContent);
  });

  $('evMine').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) {
      return;
    }
    switch (b.getAttribute('data-act')) {
      case 'peAdd':
        editing = -1;
        break;
      case 'peEdit':
        editing = +b.getAttribute('data-i');
        break;
      case 'peCancel':
        editing = null;
        break;
      case 'peDelete':
        personal.splice(editing, 1);
        editing = null;
        break;
      case 'peSave':
        var p = {title: $('peTitle').value.trim(), venue: $('peVenue').value.trim(), date: $('peDate').value,
                 time: $('peTime').value || null, minutes: +$('peLen').value || 0};
        if (!p.title) {
          $('peErr').textContent = 'Give it a name.';
          $('peTitle').focus();
          return;
        }
        if (editing >= 0) {
          personal[editing] = p;
        } else {
          personal.push(p);
        }
        editing = null;
        break;
      default:
        return;
    }
    renderMine();
    if (editing !== null) {
      $('peTitle').focus();
    }
  });

  // ---- Cruise > Ship venues: the built-in venue table with the owner's edits
  // (docs/DESIGN_V1_1.md section 1). V holds the rules shared with the phone
  // (venues.js venueLib); edits for this ship go back whole in the result.
  var VS = S.venues || null;
  var vTable = VS ? VS.table : {venues: {}, aliases: {}};
  var vOver = VS ? JSON.parse(JSON.stringify(VS.overrides || {})) : {};
  var vChanged = false;
  var vFilter = 'all';     // all | check | edited
  var vGroup = 'area';     // area | deck
  var vCur = null;         // name of the venue being edited
  var vQueue = null;       // review mode: the venues to check, fixed when it starts
  var vFrom = 'venues';    // where Back goes from the edit screen: venues | events
  var vCanon = {};         // schedule venue name -> table name (or itself)
  var schedVenues = (sched && sched.venues) || [];
  schedVenues.forEach(function(n) { vCanon[n] = V.lookup(vTable, n) || n; });
  var PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z"/>' +
    '<circle cx="12" cy="9" r="2.5"/></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  var CHEVRON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  var BADGES = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 ' +
      '2c-1 .6-1.5 1.2-1.5 2.5M12 17h.01"/></svg>Check',
    edited: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>Edited',
    add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add'
  };
  var ARROWS = {
    '1': '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M6 18.5v-17M1.5 6.5L6 1.5l4.5 5"/></svg>',
    '-1': '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M6 1.5v17M1.5 13.5L6 18.5l4.5-5"/></svg>'
  };

  function vList() {
    return V.entries(vTable, vOver, schedVenues);
  }

  function vEntry(name) {
    var list = vList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) {
        return list[i];
      }
    }
    return V.resolve(name, vTable.venues[name] || null, vOver[name]);
  }

  function cabin() {
    return V.cabinDeck($('deck').value);
  }

  function renderVenueCard() {
    if (!VS) {
      $('venueCard').innerHTML = '';
      return;
    }
    var c = V.counts(vList());
    var html = '<div class="card"><div class="vhead"><span class="vicon">' + PIN_SVG + '</span><div><h2>Ship venues</h2>' +
      '<p class="muted">Deck, fore/mid/aft and area for each venue</p></div></div>';
    if (!c.venues) {
      html += '<p class="muted" style="margin-top:12px">Venues show up here once Royal publishes the activity ' +
        'schedule.</p>';
    } else {
      html += '<div class="stats"><div class="stat"><b>' + c.venues + '</b><span>venues</span></div>' +
        '<div class="stat out"><b>' + c.toCheck + '</b><span>to check</span></div>' +
        '<div class="stat warn"><b>' + c.edited + '</b><span>edited by you</span></div></div><div class="actions">' +
        (c.toCheck ? '<button class="pill filled" data-act="review">Review ' + c.toCheck + '</button>' : '') +
        '<button class="textbtn pad" data-act="all">All venues</button></div>';
    }
    $('venueCard').innerHTML = html + '</div>';
  }

  $('venueCard').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-act]');
    if (b && b.getAttribute('data-act') === 'review') {
      startReview();
    } else if (b) {
      openList();
    }
  });

  function openList() {
    show('venues', 'Ship venues');
    renderVenues();
  }

  function startReview() {
    var queue = V.reviewQueue(vList());
    if (queue.length) {
      openVenue(queue[0], 'venues', queue);
    }
  }

  function badge(v) {
    var kind = v.blank ? 'add' : v.toCheck ? 'check' : v.isEdited ? 'edited' : '';
    return kind ? '<span class="badge ' + kind + '">' + BADGES[kind] + '</span>' : '';
  }

  function vRow(target, name, sub, extra) {
    return '<button class="vrow" data-venue="' + esc(target) + '"><span class="t"><b>' + esc(name) + '</b>' +
      '<span class="muted">' + esc(sub) + '</span></span>' + extra + CHEVRON_SVG + '</button>';
  }

  function renderVenues() {
    var list = vList();
    var c = V.counts(list);
    var q = V.norm($('vSearch').value);
    $('vChips').innerHTML = [['all', 'All'], ['check', 'To check &middot; ' + c.toCheck],
                             ['edited', 'Edited &middot; ' + c.edited]].map(function(f) {
      return '<button class="fchip" data-f="' + f[0] + '" aria-pressed="' + (vFilter === f[0]) + '">' + f[1] + '</button>';
    }).join('');
    Array.prototype.forEach.call($('vGroup').querySelectorAll('button'), function(b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === vGroup));
    });
    var aliases = Object.keys(vTable.aliases);
    function matches(v) {
      return !q || V.norm(v.name).indexOf(q) !== -1 || aliases.some(function(a) {
        return vTable.aliases[a] === v.name && V.norm(a).indexOf(q) !== -1;
      });
    }
    var shown = list.filter(function(v) {
      return (vFilter === 'all' || (vFilter === 'check' ? v.toCheck : v.isEdited)) && matches(v);
    });
    var html = V.groups(shown, vGroup).map(function(g) {
      return '<div class="vgroup"><div class="vgh"><h3>' + esc(g.title) + '</h3><span>' + g.rows.length +
        (g.rows.length === 1 ? ' venue' : ' venues') + '</span></div><div class="vbox">' + g.rows.map(function(v) {
          // Other names Royal uses for a venue sit under it and open it.
          return vRow(v.name, v.name, V.subLine(v, vGroup), badge(v)) + (vFilter !== 'all' ? '' :
            aliases.filter(function(a) { return vTable.aliases[a] === v.name; }).map(function(a) {
              return vRow(v.name, a, 'Same as ' + v.name, '');
            }).join(''));
        }).join('') + '</div></div>';
    }).join('');
    $('vList').innerHTML = html || '<p class="empty">' + (q ? 'No venues match. Venues that aren\'t in the table yet ' +
      'show up under "To check" once an event uses them.' : vFilter === 'check' ? 'Nothing to check. Every venue ' +
      'is confirmed or edited.' : 'You haven\'t edited any venues.') + '</p>';
    $('vFab').hidden = !c.toCheck;
    $('vFab').innerHTML = CHECK_SVG + 'Review ' + c.toCheck;
  }

  $('vSearch').addEventListener('input', renderVenues);
  $('vChips').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-f]');
    if (b) {
      vFilter = b.getAttribute('data-f');
      renderVenues();
    }
  });
  $('vGroup').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-v]');
    if (b) {
      vGroup = b.getAttribute('data-v');
      renderVenues();
    }
  });
  $('vList').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-venue]');
    if (b) {
      openVenue(b.getAttribute('data-venue'), 'venues', null);
    }
  });
  $('vFab').addEventListener('click', startReview);

  // ---- Edit one venue
  function openVenue(name, from, queue) {
    vCur = name;
    vFrom = from;
    vQueue = queue;
    show('venueEdit', name);
    renderVenueEdit();
  }

  function builtInText(v, f) {
    var b = v.builtIn;
    var value = f === 'deck' ? (b.decks.length ? V.deckList(b.decks) : 'none') : b[f];
    return value || 'none';
  }

  function fieldStatus(v, f) {
    if (v.edited[f]) {
      return v.builtIn ? '<div class="fstat"><span class="schip edited">Edited &middot; built-in ' +
        esc(builtInText(v, f)) + '</span><button class="textbtn" data-act="reset" data-f="' + f + '">Reset</button></div>' :
        '<p class="fstat">Added by you</p>';
    }
    if (v.check[f]) {
      return '<div class="fstat"><span class="schip check">Check &middot; not confirmed on deck plans</span>' +
        '<button class="textbtn" data-act="ok" data-f="' + f + '">Looks right</button></div>';
    }
    return '<p class="fstat">' + (!v.builtIn ? 'Not in the table yet' :
      'Built-in value' + (v.confirmed[f] ? ' &middot; you confirmed it' : '')) + '</p>';
  }

  function renderVenueEdit() {
    var v = vEntry(vCur);
    var ashore = v.neighborhood === V.ASHORE;
    var html = '';
    if (!ashore) {
      var decks = v.decks.length ? v.decks : [null];
      html += '<div class="card fcard"><div class="fhead"><b>Deck</b><span>The deck you walk in on</span></div>' +
        decks.map(function(d, i) {
          return '<div class="stepper vstep"><button data-act="step" data-i="' + i + '" data-v="-1" ' +
            'aria-label="Deck down">&minus;</button><input type="number" inputmode="numeric" min="1" max="18" ' +
            'data-i="' + i + '" value="' + (d === null ? '' : d) + '" aria-label="' +
            (decks.length > 1 ? 'Entrance ' + (i + 1) + ' deck' : 'Deck') + '"' + (v.edited.deck ? ' class="edited"' : '') +
            '><button data-act="step" data-i="' + i + '" data-v="1" aria-label="Deck up">+</button>' +
            (decks.length > 1 ? '<button class="xbtn" data-act="remove" data-i="' + i + '" aria-label="Remove this ' +
              'entrance">&times;</button>' : '') + '</div>';
        }).join('') +
        (v.decks.length && v.decks.length < 6 ? '<button class="textbtn" data-act="add">+ Add entrance</button>' : '') +
        fieldStatus(v, 'deck') + '</div>';
      html += '<div class="card fcard"><div class="fhead"><b>Position</b>' +
        (v.position ? '' : '<span>None: runs the length of the ship</span>') + '</div><div class="seg">' +
        V.POSITIONS.map(function(p) {
          return '<button data-act="pos" data-v="' + p + '" aria-pressed="' + (v.position === p) + '"' +
            (v.edited.position ? ' class="edited"' : '') + '>' + p + '</button>';
        }).join('') + '</div>' + fieldStatus(v, 'position') + '</div>';
    }
    html += '<div class="card fcard"><div class="fhead"><b>Neighborhood</b></div><div class="achips">' +
      V.AREAS.concat([V.ASHORE]).map(function(a) {
        return '<button class="fchip' + (v.edited.neighborhood ? ' edited' : '') + '" data-act="area" data-v="' + esc(a) +
          '" aria-pressed="' + (v.neighborhood === a) + '">' + esc(a) + '</button>';
      }).join('') + '</div>' + fieldStatus(v, 'neighborhood') + '</div>';

    var cab = cabin();
    var w = V.watchLines(v, cab);
    html += '<div class="wprev" aria-label="Watch preview"><small>ON YOUR PEBBLE TIME 2</small>';
    if (!w.loc) {
      html += '<span class="note">Add a deck to show where it is.</span>';
    } else {
      html += '<b>' + esc(w.loc) + '</b>';
      if (w.rel) {
        html += '<span>' + (ARROWS[String(w.rel.dir)] || '') + esc(w.rel.text) + '</span>';
      } else if (!ashore && cab === null) {
        html += '<span class="note">Enter your deck under Me to see how far it is from your cabin.</span>';
      }
    }
    html += '</div>';
    if (allEvents.some(function(e) { return vCanon[e.venue] === v.name; })) {
      html += '<button class="textbtn pad" data-act="events">Show events at this venue</button>';
    }
    $('vEdit').innerHTML = html;

    var pos = vQueue ? vQueue.indexOf(vCur) : -1;
    $('subtitle').textContent = pos !== -1 ? (pos + 1) + ' of ' + vQueue.length + ' to check' : '';
    $('vResetAll').textContent = v.builtIn ? 'Reset all to built-in' : 'Clear details';
    $('vResetAll').disabled = !vOver[vCur];
    $('vNext').innerHTML = (pos !== -1 && pos + 1 < vQueue.length ? 'Next' : 'Done') + CHEVRON_SVG;
  }

  // The venue's edits, created on first change.
  function editOver() {
    vChanged = true;
    vOver[vCur] = vOver[vCur] || {};
    return vOver[vCur];
  }

  function setDecks(decks) {
    V.setField(editOver(), vEntry(vCur).builtIn, 'deck', decks.filter(function(d) { return d !== null; }));
  }

  function clampDeck(d) {
    return Math.max(1, Math.min(18, d));
  }

  function venueEdited() {
    if (vOver[vCur] && !Object.keys(vOver[vCur]).length) {
      delete vOver[vCur];
    }
    renderVenueEdit();
  }

  $('vEdit').addEventListener('click', function(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) {
      return;
    }
    var v = vEntry(vCur);
    var decks = v.decks.length ? v.decks.slice() : [null];
    var i = +b.getAttribute('data-i');
    var value = b.getAttribute('data-v');
    switch (b.getAttribute('data-act')) {
      case 'step':
        decks[i] = decks[i] === null ? (cabin() || 5) : clampDeck(decks[i] + (+value));
        setDecks(decks);
        break;
      case 'add':
        var next = decks[decks.length - 1] + 1;
        while (decks.indexOf(next) !== -1 || next > 18) {
          next = next > 18 ? 1 : next + 1;
        }
        decks.push(next);
        setDecks(decks);
        break;
      case 'remove':
        decks.splice(i, 1);
        setDecks(decks);
        break;
      case 'pos':
        V.setField(editOver(), v.builtIn, 'position', v.position === value ? null : value);
        break;
      case 'area':
        V.setField(editOver(), v.builtIn, 'neighborhood', v.neighborhood === value ? null : value);
        break;
      case 'reset':
        V.resetField(editOver(), v.builtIn, b.getAttribute('data-f'));
        break;
      case 'ok':
        V.confirm(editOver(), b.getAttribute('data-f'));
        break;
      case 'events':
        goTo('events');
        $('evSearch').value = v.name;
        renderEvList();
        return;
      default:
        return;
    }
    venueEdited();
  });

  $('vEdit').addEventListener('change', function(ev) {
    var input = ev.target.closest('input[data-i]');
    if (!input) {
      return;
    }
    var v = vEntry(vCur);
    var decks = v.decks.length ? v.decks.slice() : [null];
    var n = parseInt(input.value, 10);
    decks[+input.getAttribute('data-i')] = isNaN(n) ? null : clampDeck(n);
    setDecks(decks);
    venueEdited();
  });

  $('vResetAll').addEventListener('click', function() {
    vChanged = true;
    delete vOver[vCur];
    renderVenueEdit();
  });

  function leaveVenue() {
    if (vFrom === 'events') {
      goTo('events');
    } else {
      openList();
    }
  }

  $('vNext').addEventListener('click', function() {
    var pos = vQueue ? vQueue.indexOf(vCur) : -1;
    if (pos !== -1 && pos + 1 < vQueue.length) {
      openVenue(vQueue[pos + 1], vFrom, vQueue);
    } else {
      leaveVenue();
    }
  });

  $('back').addEventListener('click', function() {
    if ($('venueEdit').classList.contains('active')) {
      leaveVenue();
    } else {
      goTo('cruise');
    }
  });

  // ---- Me
  var me = S.me || {};
  ['stateroom', 'deck', 'stairs', 'muster', 'clockNote'].forEach(function(id) {
    $(id).value = me[id] || '';
  });

  function segment(id, value) {
    var buttons = $(id).querySelectorAll('button');
    function set(v) {
      Array.prototype.forEach.call(buttons, function(b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(v)));
      });
    }
    Array.prototype.forEach.call(buttons, function(b) {
      b.addEventListener('click', function() { set(b.getAttribute('data-v')); });
    });
    set(value);
    return function() {
      var on = $(id).querySelector('button[aria-pressed=true]');
      return on ? on.getAttribute('data-v') : String(value);
    };
  }
  var getTheme = segment('theme', S.theme || 'light');
  var getLead = segment('lead', S.reminderLead || 15);

  // ---- Save / Download
  function result(action) {
    var r = {
      action: action,
      theme: getTheme(),
      reminderLead: parseInt(getLead(), 10),
      me: {}
    };
    ['stateroom', 'deck', 'stairs', 'muster', 'clockNote'].forEach(function(id) {
      r.me[id] = $(id).value.trim();
    });
    if (fetchedShips) {
      r.ships = fetchedShips;
    }
    r.showFeatured = featuredOn();
    r.hiddenCats = hidden.slice();
    if (Object.keys(starChanges).length) {
      r.stars = starChanges;
      r.starTimes = starTimes;
    }
    if (evDates.length) {
      r.personal = personal;
    }
    if (VS && vChanged) {
      r.venues = {ship: VS.ship, overrides: vOver};
    }
    if (itinerary.length) {
      r.days = {};
      itinerary.forEach(function(d) {
        var set = JSON.parse(JSON.stringify(days[d.date]));
        if (!set.allAboard) {
          delete set.allAboard;
        }
        r.days[d.date] = Object.keys(set).length ? set : null;
      });
    }
    if (action === 'download') {
      var code = $('ship').value;
      var opt = $('ship').options[$('ship').selectedIndex];
      r.download = {ship: {code: code, name: opt ? opt.textContent : code}, sailDate: chosenDate()};
    } else if (pastedBundle) {
      r.bundle = pastedBundle;
    }
    return r;
  }

  function close(action) {
    if (editing !== null) {
      if (!$('events').classList.contains('active')) {
        document.querySelector('nav [data-screen=events]').click();
      }
      $('peErr').textContent = 'Tap ' + (editing >= 0 ? 'Update' : 'Add') + ' or Cancel for this entry first.';
      $('peErr').scrollIntoView({block: 'center'});
      return;
    }
    if (action === 'save' && $('paste').value.trim() && !pastedBundle) {
      $('backup').open = true;
      $('pasteHelp').scrollIntoView({block: 'center'});
      return;
    }
    document.location = returnUrl() + encodeURIComponent(JSON.stringify(result(action)));
  }
  $('save').addEventListener('click', function() { close('save'); });
  $('download').addEventListener('click', function() { close('download'); });
  $('testAlerts').addEventListener('click', function() { close('test'); });
  if (S.watchStorage) {
    $('watchStorage').textContent = 'Watch storage: the saved schedule uses ' + kb(S.watchStorage.bytes) +
      ' of ' + kb(S.watchStorage.max) + '.';
  }
  function kb(bytes) {
    return bytes < 10240 ? (Math.round(bytes / 102.4) / 10) + ' kB' : Math.round(bytes / 1024) + ' kB';
  }

  renderStatus();
  renderVenueCard();
  renderDays();
  renderCats();
  renderEvents();
  fillShips();
  loadSailings();
  if (S.shipsStale) {
    refreshShips();
  }
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

// state: {ships, cruise, status, itinerary, days, categories, hiddenCats, showFeatured, schedule, stars,
//         personal, venues, me, theme, reminderLead, api, appKey}
function buildPage(state, now) {
  now = now || new Date();
  // List sailings from two weeks ago on, so a sailing in progress still shows.
  var oldest = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  state.oldestSailDate = oldest.getFullYear() + '-' + pad2(oldest.getMonth() + 1) + '-' + pad2(oldest.getDate());
  // Escape '<' and the JS line separators U+2028/U+2029 so the state can't end the
  // script tag or break the script.
  var json = JSON.stringify(state).replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>Royal Pebble</title><style>' + CSS + '</style></head><body>' + BODY +
    '<script>(' + pageMain.toString() + ')(' + json + ', (' + venues.venueLib.toString() + ')());</script>' +
    '</body></html>';
}

function pageUrl(state, now) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(buildPage(state, now));
}

module.exports = {buildPage: buildPage, pageUrl: pageUrl};
