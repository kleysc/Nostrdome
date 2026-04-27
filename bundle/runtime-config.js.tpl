// Runtime config for the Nostrdome SPA. install.sh produces ./runtime-
// config.js from this template; Caddy serves it at /runtime-config.js,
// and the SPA reads it BEFORE its module bundle (see index.html).
//
// Editing this file lets the operator change relay/group/community
// settings without rebuilding the SPA image. After editing, restart the
// caddy container so the no-cache header is reissued and clients pick up
// the change on next reload.
window.__NOSTRDOME_CONFIG__ = {
  liveRelayUrl: "wss://relay.${DOMAIN}",
  liveGroupId: "${GROUP_ID}",
  publicRelays: [${PUBLIC_RELAYS_JSON}]
};
