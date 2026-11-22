/* Bar Tab — tracks drinks & spend for a night out.
 * All data lives in this browser's localStorage (on your phone only).
 *
 * URL entry points (used by the iOS Shortcut):
 *   ?log=1&merchant=<name>&amount=<amount>   → "what did you get?" screen
 *   ?recap=1                                  → last night's recap
 */
(() => {
  'use strict';

  const STORE_KEY = 'bartab.v1';
  const NIGHT_CUTOFF_HOURS = 12; // a "night" runs noon → noon, so 2am counts as last night

  const DRINKS = [
    { id: 'beer',     name: 'Beer',     emo: '🍺' },
    { id: 'wine',     name: 'Wine',     emo: '🍷' },
    { id: 'cocktail', name: 'Cocktail', emo: '🍸' },
    { id: 'shot',     name: 'Shot',     emo: '🥃' },
    { id: 'mixer',    name: 'Spirit & mixer', emo: '🥤' },
    { id: 'cider',    name: 'Cider',    emo: '🍏' },
    { id: 'bubbly',   name: 'Bubbly',   emo: '🥂' },
    { id: 'soft',     name: 'Soft drink', emo: '🧃', alcoholic: false },
    { id: 'other',    name: 'Other',    emo: '❓' },
  ];
  const drinkById = Object.fromEntries(DRINKS.map(d => [d.id, d]));

  const DEFAULT_SETTINGS = {
    currency: guessCurrency(),
    drinkLimit: 5,
    spendLimit: 100,
    waterEveryMin: 20,
    bankUrl: '',
  };

  // ---------- storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return { entries: [], recentTaps: [], ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) } };
      }
    } catch (e) { /* fall through */ }
    return { entries: [], recentTaps: [], settings: { ...DEFAULT_SETTINGS } };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('⚠️ Could not save — is Private Browsing on?'); }
  }
  let state = load();

  // ---------- helpers ----------
  function guessCurrency() {
    const lang = (navigator.language || 'en-US').toUpperCase();
    const map = { GB: 'GBP', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
      CA: 'CAD', AU: 'AUD', NZ: 'NZD', IN: 'INR', SG: 'SGD', AE: 'AED', US: 'USD' };
    const region = lang.split('-')[1];
    return map[region] || 'USD';
  }
  function money(n) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency }).format(n || 0);
    } catch (e) { return (n || 0).toFixed(2); }
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /** Parses whatever Shortcuts hands us: "$12.50", "12,50 €", "1,234.56", "£8". */
  function parseAmount(raw) {
    if (raw == null) return 0;
    let s = String(raw).replace(/[^\d.,-]/g, '');
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      const dec = lastDot > lastComma ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (lastComma > -1) {
      // "12,50" → decimal comma; "1,234" → thousands separator
      s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : 0;
  }

  function nightKey(ts) {
    const d = new Date(ts - NIGHT_CUTOFF_HOURS * 3600e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function nightLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function timeOf(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function summarize(key) {
    const list = state.entries.filter(e => nightKey(e.ts) === key).sort((a, b) => a.ts - b.ts);
    const drinks = list.filter(e => e.type === 'drink');
    const mine = drinks.filter(e => e.forWhom === 'me');
    const myAlcoholic = mine.filter(e => drinkById[e.drink]?.alcoholic !== false);
    const friends = drinks.filter(e => e.forWhom === 'friend');
    const water = list.filter(e => e.type === 'water');
    const sum = arr => arr.reduce((t, e) => t + (e.cost || 0), 0);
    const byDrink = {};
    for (const e of myAlcoholic) byDrink[e.drink] = (byDrink[e.drink] || 0) + 1;
    const bars = [...new Set(drinks.map(e => e.merchant).filter(Boolean))];
    const lastDrink = myAlcoholic.at(-1);
    const lastWater = water.at(-1);
    return {
      key, list, drinks, mine, myAlcoholic, friends, water, bars, byDrink,
      myCount: myAlcoholic.length,
      spentMine: sum(mine),
      spentFriends: sum(friends),
      spentTotal: sum(drinks),
      first: list[0]?.ts, last: list.at(-1)?.ts,
      lastDrinkTs: lastDrink?.ts, lastWaterTs: lastWater?.ts,
    };
  }

  function limitStatus(s) {
    const { drinkLimit, spendLimit } = state.settings;
    const dPct = drinkLimit > 0 ? s.myCount / drinkLimit : 0;
    const sPct = spendLimit > 0 ? s.spentTotal / spendLimit : 0;
    const pct = Math.max(dPct, sPct);
    return { dPct, sPct, pct, over: pct >= 1, near: pct >= 0.8 && pct < 1 };
  }

  function needsWater(s) {
    if (!s.lastDrinkTs) return false;
    const since = Math.max(s.lastDrinkTs, s.lastWaterTs || 0);
    // nudge if you've had a drink since your last water and it's been a while, or 2+ drinks without water
    const drinksSinceWater = s.myAlcoholic.filter(e => e.ts > (s.lastWaterTs || 0)).length;
    const minutes = (Date.now() - since) / 60000;
    return drinksSinceWater >= 2 || (drinksSinceWater >= 1 && minutes >= state.settings.waterEveryMin);
  }

  // ---------- UI plumbing ----------
  const $app = document.getElementById('app');
  const $overlay = document.getElementById('overlay');
  const $toast = document.getElementById('toast');
  let toastTimer;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $toast.hidden = true; }, 2200);
  }

  function setNav(view) {
    document.querySelectorAll('.top nav button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
  }

  function go(view, params) {
    const url = new URL(location.href);
    url.search = '';
    if (view !== 'home') url.searchParams.set(view, params?.night || '1');
    history.replaceState(null, '', url);
    route();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-go]');
    if (t) { e.preventDefault(); go(t.dataset.go, t.dataset.night ? { night: t.dataset.night } : undefined); }
  });

  // ---------- views ----------
  function viewHome() {
    setNav('home');
    const key = nightKey(Date.now());
    const s = summarize(key);
    const L = limitStatus(s);
    const { drinkLimit, spendLimit } = state.settings;
    const meterCls = p => (p >= 1 ? 'bad' : p >= 0.8 ? 'warn' : '');
    const water = needsWater(s);

    $app.innerHTML = `
      <h1>Tonight</h1>
      <p class="muted small">${esc(nightLabel(key))}${s.bars.length ? ' · ' + s.bars.map(esc).join(', ') : ''}</p>

      ${water ? `<div class="banner water">💧 Time for a glass of water.</div>` : ''}
      ${L.near ? `<div class="banner warn">⚠️ You're close to your limit for tonight.</div>` : ''}

      <div class="stats">
        <div class="stat"><div class="num">${s.myCount}</div><div class="lbl">my drinks</div></div>
        <div class="stat"><div class="num">${money(s.spentTotal)}</div><div class="lbl">spent</div></div>
        <div class="stat"><div class="num">${s.water.length}</div><div class="lbl">waters</div></div>
      </div>

      <div class="card">
        <div class="meter-row"><span>Drinks</span><span>${s.myCount} / ${drinkLimit}</span></div>
        <div class="meter ${meterCls(L.dPct)}"><div style="width:${Math.min(100, L.dPct * 100)}%"></div></div>
        <div class="meter-row" style="margin-top:10px"><span>Spend</span><span>${money(s.spentTotal)} / ${money(spendLimit)}</span></div>
        <div class="meter ${meterCls(L.sPct)}"><div style="width:${Math.min(100, L.sPct * 100)}%"></div></div>
      </div>

      <button class="btn water" id="addWater">💧 I drank water</button>
      <button class="btn" id="addManual">＋ Add a drink (cash / not tapped)</button>

      ${s.list.length ? `<h2>Tonight's log</h2><div class="card">${timelineHtml(s.list, true)}</div>` : `
        <div class="card muted small">Nothing logged yet tonight. When you tap your card at a bar with Apple Pay,
        your Shortcut opens this page and asks what you ordered.
        Not set up yet? <a href="#" data-go="settings" style="color:var(--accent)">See setup</a>.</div>`}
    `;

    document.getElementById('addWater').onclick = () => {
      state.entries.push({ id: uid(), ts: Date.now(), type: 'water' });
      save(); toast('💧 Nice. Water logged.'); viewHome();
    };
    document.getElementById('addManual').onclick = () => viewLog({ merchant: '', amount: 0, manual: true });
    bindTimelineDeletes(viewHome);

    const sig = `${key}|${s.drinks.length}`;
    if (L.over && state.limitDismissed !== sig) showLimitOverlay(s, sig);
  }

  function timelineHtml(list, deletable) {
    return `<ul class="timeline">${list.map(e => {
      if (e.type === 'water') {
        return `<li><span class="t">${timeOf(e.ts)}</span><span class="what">💧 Water</span>
          ${deletable ? `<button class="x" data-del="${e.id}" aria-label="Delete">×</button>` : ''}</li>`;
      }
      const d = drinkById[e.drink] || drinkById.other;
      return `<li><span class="t">${timeOf(e.ts)}</span>
        <span class="what">${d.emo} ${esc(d.name)}${e.forWhom === 'friend' ? ' <span class="muted small">· for a friend</span>' : ''}
        ${e.merchant ? `<br><span class="muted small">${esc(e.merchant)}</span>` : ''}</span>
        <span class="amt">${e.cost ? money(e.cost) : ''}</span>
        ${deletable ? `<button class="x" data-del="${e.id}" aria-label="Delete">×</button>` : ''}</li>`;
    }).join('')}</ul>`;
  }
  function bindTimelineDeletes(rerender) {
    $app.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => {
        if (!confirm('Delete this entry?')) return;
        state.entries = state.entries.filter(e => e.id !== b.dataset.del);
        save(); rerender();
      };
    });
  }

  /** "What did you get?" — one card tap can be a whole round. */
  function viewLog({ merchant, amount, manual }) {
    setNav('');
    const tapKey = `${merchant}|${amount}`;
    const dupe = !manual && state.recentTaps.find(t => t.key === tapKey && Date.now() - t.ts < 3 * 60e3);
    const items = []; // { drink, forWhom }
    let total = amount;

    function render() {
      const each = items.length ? total / items.length : 0;
      $app.innerHTML = `
        <h1>${manual ? 'Add a drink' : 'What did you get?'}</h1>
        ${manual ? '' : `<p class="muted">${esc(merchant || 'Card tap')} · <strong style="color:var(--text)">${money(amount)}</strong></p>`}
        ${dupe ? `<div class="banner warn">You already logged this tap a minute ago. Only save again if it was a new round.</div>` : ''}

        ${manual ? `
          <label class="field"><span>Where?</span><input id="mMerchant" placeholder="Bar name (optional)" value="${esc(merchant)}"></label>
          <label class="field"><span>Total cost</span><input id="mAmount" inputmode="decimal" placeholder="0.00" value="${total || ''}"></label>
        ` : ''}

        <h2>Tap each drink in the round</h2>
        <div class="drink-grid">
          ${DRINKS.map(d => `<button data-drink="${d.id}"><span class="emo">${d.emo}</span>${esc(d.name)}</button>`).join('')}
        </div>

        ${items.length ? `
          <h2>This round</h2>
          <div class="card"><ul class="items">
            ${items.map((it, i) => {
              const d = drinkById[it.drink];
              return `<li>
                <span class="name">${d.emo} ${esc(d.name)}</span>
                ${total ? `<span class="cost">${money(each)}</span>` : ''}
                <div class="seg" role="group">
                  <button data-who="me" data-i="${i}" class="${it.forWhom === 'me' ? 'on' : ''}">Me</button>
                  <button data-who="friend" data-i="${i}" class="${it.forWhom === 'friend' ? 'on' : ''}">Friend</button>
                </div>
                <button class="x" data-rm="${i}" aria-label="Remove">×</button>
              </li>`;
            }).join('')}
          </ul></div>` : ''}

        <button class="btn primary" id="saveRound" ${items.length ? '' : 'disabled'}>
          Save ${items.length ? `${items.length} drink${items.length > 1 ? 's' : ''}` : ''}
        </button>
        ${manual
          ? `<button class="btn ghost" data-go="home">Cancel</button>`
          : `<button class="btn ghost" id="notDrinks">Not drinks — ignore this tap</button>`}
      `;

      $app.querySelectorAll('[data-drink]').forEach(b => b.onclick = () => {
        // first drink defaults to me; later ones in the same round default to friend
        items.push({ drink: b.dataset.drink, forWhom: items.length === 0 ? 'me' : 'friend' });
        syncManual(); render();
      });
      $app.querySelectorAll('[data-who]').forEach(b => b.onclick = () => {
        items[+b.dataset.i].forWhom = b.dataset.who; syncManual(); render();
      });
      $app.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
        items.splice(+b.dataset.rm, 1); syncManual(); render();
      });
      if (manual) {
        document.getElementById('mAmount').oninput = e => { total = parseAmount(e.target.value); };
        document.getElementById('mMerchant').oninput = e => { merchant = e.target.value; };
      }
      document.getElementById('saveRound').onclick = saveRound;
      const nd = document.getElementById('notDrinks');
      if (nd) nd.onclick = () => go('home');
    }

    function syncManual() {
      if (!manual) return;
      merchant = document.getElementById('mMerchant').value;
      total = parseAmount(document.getElementById('mAmount').value);
    }

    function saveRound() {
      syncManual();
      const ts = Date.now();
      const each = items.length ? total / items.length : 0;
      for (const it of items) {
        state.entries.push({ id: uid(), ts, type: 'drink', drink: it.drink, forWhom: it.forWhom, cost: each, merchant: merchant || '' });
      }
      if (!manual) {
        state.recentTaps = [...state.recentTaps.filter(t => Date.now() - t.ts < 3600e3), { key: tapKey, ts }];
      }
      save();
      const mine = items.filter(i => i.forWhom === 'me' && drinkById[i.drink].alcoholic !== false).length;
      toast(mine ? `🍻 Logged. Remember some water!` : '🍻 Round logged.');
      go('home');
    }

    render();
  }

  function showLimitOverlay(s, sig) {
    const dismiss = () => { state.limitDismissed = sig; save(); $overlay.hidden = true; };
    const { bankUrl, drinkLimit, spendLimit } = state.settings;
    const reason = s.myCount >= drinkLimit && drinkLimit > 0
      ? `${s.myCount} drinks tonight. Your limit is ${drinkLimit}.`
      : `${money(s.spentTotal)} spent tonight. Your limit is ${money(spendLimit)}.`;
    $overlay.innerHTML = `<div class="inner">
      <div class="big">🛑</div>
      <h1>That's your limit</h1>
      <p class="muted">${esc(reason)}</p>
      <p class="muted small" style="margin-top:14px">Past-you asked present-you to stop here. Lock your card so future-you doesn't have to argue about it.</p>
      ${bankUrl
        ? `<a class="btn danger" href="${esc(bankUrl)}">🔒 Open my bank to lock my card</a>`
        : `<button class="btn danger" data-go="settings">🔒 Set up the "lock card" button</button>`}
      <button class="btn water" id="ovWater">💧 Get a water</button>
      <button class="btn ghost" id="ovDismiss">Dismiss for now</button>
    </div>`;
    $overlay.hidden = false;
    $overlay.querySelector('#ovDismiss').onclick = dismiss;
    $overlay.querySelector('#ovWater').onclick = () => {
      state.entries.push({ id: uid(), ts: Date.now(), type: 'water' });
      dismiss(); toast('💧 Water logged.'); route();
    };
    const sg = $overlay.querySelector('[data-go]');
    if (sg) sg.addEventListener('click', dismiss);
  }

  function viewRecap(requestedKey) {
    setNav('recap');
    const nights = [...new Set(state.entries.map(e => nightKey(e.ts)))].sort().reverse();
    if (!nights.length) {
      $app.innerHTML = `<h1>Recap</h1><div class="card muted">No nights logged yet.</div>`;
      return;
    }
    const key = nights.includes(requestedKey) ? requestedKey : nights[0];
    const s = summarize(key);
    const isTonight = key === nightKey(Date.now()) && new Date().getHours() >= NIGHT_CUTOFF_HOURS;
    const hrs = s.first && s.last ? Math.max(0, (s.last - s.first) / 3600e3) : 0;
    const waterRatio = s.myCount ? s.water.length / s.myCount : 0;
    const L = limitStatus(s);

    const verdict = (() => {
      if (!s.myCount) return '🌙 A dry night. Your liver says thanks.';
      if (L.over) return '😬 You hit your limit. Easy day today — water, food, rest.';
      if (waterRatio >= 0.5) return '👏 Nicely paced — you kept up with water.';
      return '💧 Not much water last night. Hydrate this morning.';
    })();

    const breakdown = Object.entries(s.byDrink)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${drinkById[id]?.emo || ''} ${n} ${esc(drinkById[id]?.name || id)}`)
      .join(' · ');

    $app.innerHTML = `
      <h1>${isTonight ? 'Tonight so far' : 'Good morning ☀️'}</h1>
      <p class="muted">${esc(nightLabel(key))}${s.bars.length ? ' · ' + s.bars.map(esc).join(', ') : ''}</p>

      <div class="banner ${L.over ? 'warn' : 'water'}">${verdict}</div>

      <div class="stats">
        <div class="stat"><div class="num">${s.myCount}</div><div class="lbl">my drinks</div></div>
        <div class="stat"><div class="num">${money(s.spentTotal)}</div><div class="lbl">total spent</div></div>
        <div class="stat"><div class="num">${s.water.length}</div><div class="lbl">waters</div></div>
      </div>

      <div class="card">
        <p>${breakdown || '<span class="muted">No alcoholic drinks for you.</span>'}</p>
        <p class="muted small" style="margin-top:10px">
          ${money(s.spentMine)} on your drinks · ${money(s.spentFriends)} on ${s.friends.length} for friends
          ${hrs >= 0.25 ? ` · out for ${hrs < 1 ? Math.round(hrs * 60) + ' min' : hrs.toFixed(1) + ' hrs'}` : ''}
        </p>
      </div>

      <h2>Timeline</h2>
      <div class="card">${timelineHtml(s.list, false)}</div>

      ${nights.length > 1 ? `<h2>Past nights</h2><div class="history">
        ${nights.slice(0, 20).map(k => {
          const ns = summarize(k);
          return `<button data-go="recap" data-night="${k}" class="${k === key ? 'on' : ''}">
            <span>${esc(nightLabel(k))}</span>
            <span class="muted">${ns.myCount} 🍺 · ${money(ns.spentTotal)}</span></button>`;
        }).join('')}</div>` : ''}
    `;
  }

  function viewSettings() {
    setNav('settings');
    const st = state.settings;
    const base = location.origin + location.pathname;
    const currencies = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'NZD', 'INR', 'SGD', 'AED', 'CHF', 'JPY'];
    if (!currencies.includes(st.currency)) currencies.unshift(st.currency);

    $app.innerHTML = `
      <h1>Settings</h1>

      <div class="card">
        <label class="field"><span>Drink limit per night (your drinks only)</span>
          <input id="sDrinks" type="number" min="0" inputmode="numeric" value="${st.drinkLimit}"></label>
        <label class="field"><span>Spending limit per night (incl. rounds for friends)</span>
          <input id="sSpend" type="number" min="0" inputmode="decimal" value="${st.spendLimit}"></label>
        <label class="field"><span>Water nudge after (minutes)</span>
          <input id="sWater" type="number" min="5" inputmode="numeric" value="${st.waterEveryMin}"></label>
        <label class="field"><span>Currency</span>
          <select id="sCur">${currencies.map(c => `<option ${c === st.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field"><span>"Lock my card" link — your bank app or its card-controls web page</span>
          <input id="sBank" type="url" placeholder="https://… (your bank's card-lock page)" value="${esc(st.bankUrl)}"></label>
        <p class="muted small">Tip: most banks have a "freeze/lock card" toggle in their app. Paste your bank's website or app link here so the limit screen opens it in one tap.</p>
        <button class="btn primary" id="saveSettings">Save settings</button>
      </div>

      <h2>iPhone Shortcut setup</h2>
      <div class="card small">
        <p>One-time setup in the <strong>Shortcuts</strong> app (iOS 17+). Works when you pay with <strong>Apple Pay</strong>.</p>
        <ol class="steps">
          <li><strong>Automation</strong> tab → <strong>+</strong> → <strong>Transaction</strong>. Pick the card(s) you use on nights out. Under Categories/Merchants pick whatever matches bars, or leave it on any (you can always tap "ignore").
            Choose <strong>Run Immediately</strong> → Next → <strong>New Blank Automation</strong>.</li>
          <li>Add <strong>URL Encode</strong> → set its input to <em>Shortcut Input → Merchant</em>.</li>
          <li>Add <strong>Text</strong> with:<br>
            <code>${esc(base)}?log=1&amount=</code><em>[Shortcut Input → Amount]</em><code>&merchant=</code><em>[URL Encoded Text]</em></li>
          <li>Add <strong>Open URLs</strong> (input: the Text).</li>
          <li><em>Water reminder:</em> add <strong>Add New Reminder</strong> → "💧 Drink some water", alert at <em>Adjust Date: Current Date + 20 minutes</em>.</li>
          <li><em>Morning recap:</em> add <strong>Find Reminders</strong> where Title is "🍻 Bar Tab recap" and Is Not Completed. Add <strong>If</strong> <em>Reminders</em> <strong>does not have any value</strong> → <strong>Add New Reminder</strong> "🍻 Bar Tab recap", URL <code>${esc(base)}?recap=1</code>, alert tomorrow at 10:00am.</li>
        </ol>
        <p class="muted">Keep using this page in <strong>Safari</strong> (not "Add to Home Screen") so the Shortcut and you see the same data.</p>
        <a class="btn" href="${esc(base)}?log=1&merchant=Test%20Bar&amount=%2414.00">Try a test tap</a>
      </div>

      <h2>Data</h2>
      <div class="card small">
        <p class="muted">Everything is stored only in Safari on this phone. Clearing Safari website data erases it.</p>
        <div class="row">
          <button class="btn" id="exportData">Export</button>
          <button class="btn danger" id="wipeData">Erase all</button>
        </div>
      </div>
    `;

    document.getElementById('saveSettings').onclick = () => {
      const num = (id, d) => { const n = parseFloat(document.getElementById(id).value); return Number.isFinite(n) && n >= 0 ? n : d; };
      state.settings = {
        ...st,
        drinkLimit: num('sDrinks', st.drinkLimit),
        spendLimit: num('sSpend', st.spendLimit),
        waterEveryMin: Math.max(5, num('sWater', st.waterEveryMin)),
        currency: document.getElementById('sCur').value,
        bankUrl: document.getElementById('sBank').value.trim(),
      };
      save(); toast('Saved ✓'); viewSettings();
    };
    document.getElementById('exportData').onclick = async () => {
      const text = JSON.stringify(state, null, 2);
      try {
        if (navigator.share) await navigator.share({ title: 'Bar Tab export', text });
        else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
      } catch (e) { /* user cancelled */ }
    };
    document.getElementById('wipeData').onclick = () => {
      if (!confirm('Erase every night you have logged? This cannot be undone.')) return;
      state = { entries: [], recentTaps: [], settings: state.settings };
      save(); toast('Erased'); viewSettings();
    };
  }

  // ---------- router ----------
  function route() {
    $overlay.hidden = true;
    const q = new URLSearchParams(location.search);
    if (q.has('log')) {
      const merchant = (q.get('merchant') || '').trim();
      const amount = parseAmount(q.get('amount'));
      viewLog({ merchant, amount, manual: false });
    } else if (q.has('recap')) {
      viewRecap(q.get('recap'));
    } else if (q.has('settings')) {
      viewSettings();
    } else {
      viewHome();
    }
  }

  // refresh the water nudge when you come back to the tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !new URLSearchParams(location.search).toString()) viewHome();
  });

  route();
})();
