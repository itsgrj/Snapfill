# Contributing to Snapfill

Thanks for helping. Snapfill is small on purpose, so a short talk first saves you work.

## Report a form it gets wrong

This is the most useful thing you can send. Open an
[issue](https://github.com/itsgrj/Snapfill/issues/new/choose) with the **Form not filled
right** template: the page's address (if it is public), the field's label, what Snapfill put
there and what it should have. A screenshot helps. Never paste your real details into an issue.

## Report a bug

Open an [issue](https://github.com/itsgrj/Snapfill/issues/new/choose) with what you did, what
you expected, and what happened. Your browser and its version help.

## Suggest something

Open an issue before you write code. Snapfill turns features down as often as it adds them; a
quick yes saves a wasted pull request.

## Run it from source

1. Clone the repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose
   the `extension` folder.
3. After each change, click the reload arrow on Snapfill's card and reload the page you test on.

The forms in [`demo`](demo) are a quick place to try a change. Serve the folder with
`python3 -m http.server` so the extension runs on it.

## Where things live

| File | What it does |
|---|---|
| `extension/src/shared.js` | Recognises fields by label, holds the profile model and the Dummy generator |
| `extension/src/content.js` | Fills on the first click, learns what you type, draws the message |
| `extension/src/background.js` | Passes the Alt+Shift+F shortcut to the page |
| `extension/popup/` | The toolbar popup and the profile editor |

To teach Snapfill a new kind of field, add a rule to `RULES` in `shared.js`. Rules are checked
in order, so put specific ones (like *first name*) before general ones (like *name*).

## House rules

- No network requests, analytics or remote code. Everything stays in the browser.
- Never fill or learn passwords, card numbers, one time codes or government ID numbers.
- Nothing fills until the person clicks a field.
- Words people see are plain and short. No jargon about how things work inside.
- One change per pull request, with a plain description of what it does for the person using
  Snapfill.

By sending a pull request you agree that your work is released under the [MIT License](LICENSE),
like the rest of Snapfill, and that you follow the [code of conduct](CODE_OF_CONDUCT.md).
