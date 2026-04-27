# nostrdome-relay TOML config template.
# install.sh substitutes ${...} placeholders against .env and writes the
# result to ./relay.toml, mounted read-only in the relay container.

[relay]
addr           = ":7777"
name           = "${COMMUNITY_NAME} relay"
description    = "Nostrdome NIP-29 relay for ${COMMUNITY_NAME}"
pubkey         = "${OWNER_PUBKEY_HEX}"
contact_email  = "${ACME_EMAIL}"
software_url   = "https://github.com/nostrdome-platform/relay"
version        = "0.1.0"

[storage]
# Inside the container the data dir lives on the relay_data volume so
# backups can grab the whole tree.
path = "/var/lib/nostrdome"

[ratelimit]
per_minute = ${RELAY_PER_MINUTE}
per_hour   = ${RELAY_PER_HOUR}
burst_size = 5

[logging]
# Switch to "debug" while bringing up a new install; flip back to "info"
# once the relay has settled.
level  = "info"
format = "json"
