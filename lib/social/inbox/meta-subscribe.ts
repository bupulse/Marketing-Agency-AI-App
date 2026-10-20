import "server-only";
import { graphPost, GRAPH_VERSION } from "../graph";
import { loadCredentials } from "../connections";

// Direct route only: asks Meta to send this account's comments and DMs to BuPulse's webhook (app/api/meta/webhook).
// A Page subscribes with its Page token; an Instagram Login account with its own token. Best effort: the caller shows
// a plain message when it fails (usually a permission Meta has not granted yet).
export async function subscribeToWebhooks(connectionId: string, network: "instagram" | "facebook"): Promise<void> {
  const { accessToken, externalAccountId } = await loadCredentials(connectionId);
  if (network === "instagram" && accessToken.startsWith("IG")) {
    await graphPost(network, `https://graph.instagram.com/${GRAPH_VERSION}/me/subscribed_apps`, { subscribed_fields: "comments,messages,messaging_postbacks", access_token: accessToken });
    return;
  }
  // A Facebook Page, or an Instagram account reached through its Page (the token is the Page's: "me" is the Page).
  const target = network === "facebook" ? externalAccountId : "me";
  await graphPost(network, `https://graph.facebook.com/${GRAPH_VERSION}/${target}/subscribed_apps`, { subscribed_fields: "feed,messages,messaging_postbacks", access_token: accessToken });
}
