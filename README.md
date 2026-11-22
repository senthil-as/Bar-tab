# 🍻 Bar Tab

Counts how much you drink and spend on a night out. It runs in Safari on your iPhone, with no App Store and nothing to pay for.

- **Tap to log:** when you pay at a bar with Apple Pay, an iOS Shortcut opens Bar Tab and asks what you ordered, and whether each drink is for you or a friend.
- **Water reminders:** a Reminders alert 20 minutes after each tap, plus a nudge in the app.
- **Morning recap:** a reminder at 10am the next day with drinks, money spent, rounds for friends and a timeline.
- **Limit:** after your drink or spending limit, a full-screen stop page with a one-tap link to lock your card in your bank's app.

All data stays in Safari on your phone (`localStorage`). Nothing is sent anywhere.

## 1. Host it (free, with GitHub Pages)

1. Repo **Settings → Pages**.
2. Source: **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After about a minute it's live at **https://senthil-as.github.io/Bar-tab/**.

Open that link in **Safari** on your iPhone. Use it in Safari, not "Add to Home Screen": iOS keeps home-screen web apps' data separate from Safari's, and the Shortcut opens Safari. Bookmark it, or add it to Favorites.

## 2. Set your limits

Tap **Settings**, then set your drink limit, spending limit and currency. Add your bank's card-lock link if you have one. Settings also has a **Try a test tap** button.

## 3. Create the Shortcut automation (iOS 17+)

In the **Shortcuts** app:

1. **Automation** tab, then **+**, then **Transaction**.
   - **Cards:** the card(s) you use on nights out.
   - **Categories / Merchants:** pick what matches bars, or leave it on any. You can tap "Not drinks — ignore" in the app.
   - Choose **Run Immediately**, then **Next**, then **New Blank Automation**.
2. Add the action **URL Encode** and set its input to *Shortcut Input → Merchant*.
3. Add **Text** containing:
   ```
   https://senthil-as.github.io/Bar-tab/?log=1&amount=[Shortcut Input → Amount]&merchant=[URL Encoded Text]
   ```
   (Insert the two bracketed values as variables. Tap the variable and pick *Amount*.)
4. Add **Open URLs** with the Text as input.
5. **Water reminder:** add **Add New Reminder**, titled `💧 Drink some water`, with the alert set to *Adjust Date → Current Date + 20 minutes*.
6. **Morning recap** (added once per night):
   - **Find Reminders** where *Title is* `🍻 Bar Tab recap` and *Is Not Completed*.
   - **If** *Reminders* **does not have any value**:
     - **Add New Reminder** titled `🍻 Bar Tab recap`, URL `https://senthil-as.github.io/Bar-tab/?recap=1`, alert **tomorrow at 10:00am**.
   - **End If**

Now when you tap your phone at a bar, Safari pops up with *"What did you get?"*.

## Limits to know about

- It only fires for **Apple Pay** taps, not the physical card.
- An iPhone web app **can't freeze your card itself**. The limit screen links you to your bank's lock toggle.
- Clearing Safari website data erases your history. Use **Settings → Export** to back it up.
- A "night" runs noon to noon, so a 1am drink counts toward the previous evening.

## Files

`index.html`, `style.css` and `app.js` are plain HTML, CSS and JS with no build step. To run it locally: `python3 -m http.server`, then open http://localhost:8000.
