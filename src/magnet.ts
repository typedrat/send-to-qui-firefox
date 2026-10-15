import * as v from "valibot";
import { MagnetReplySchema, type Message } from "./schemas.ts";
import { themeExtensionPage } from "./theme.ts";

// Firefox opens this page in place of the page the magnet link was clicked on, so once the
// link is handled, step back to that page rather than leaving the user here.

const status = document.getElementById("status")!;
const uri = new URLSearchParams(location.search).get("uri");

// Sending the link refreshes the cached theme, so the page doesn't fetch it separately.
themeExtensionPage(null);

async function leave() {
  if (history.length > 1) {
    history.back();
    return;
  }
  const tab = await browser.tabs.getCurrent();
  if (tab?.id !== undefined) await browser.tabs.remove(tab.id);
}

if (!uri?.toLowerCase().startsWith("magnet:")) {
  status.textContent = "This page only handles magnet links.";
  status.className = "status error";
} else {
  const reply = v.parse(
    MagnetReplySchema,
    await browser.runtime.sendMessage({ type: "send-link", url: uri } satisfies Message),
  );
  if (reply.result === "ask") {
    // Replacing this entry means the picker's own "back" returns to the original page.
    location.replace(`picker.html?id=${reply.pickerId}&tab=1`);
  } else {
    const sent = reply.result === "sent";
    status.textContent = sent ? "Sent to qui." : "Couldn't send to qui — see the notification for details.";
    status.className = `status ${sent ? "ok" : "error"}`;
    if (sent) setTimeout(leave, 1000);
  }
}
