// Snapfill background worker: relays the keyboard shortcut to the page.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "fill-form") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: "sf-fill" }); } catch (e) { /* page has no content script, e.g. chrome:// pages */ }
});
