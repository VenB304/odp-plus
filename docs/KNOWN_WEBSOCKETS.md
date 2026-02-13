# Known WebSocket Domains

This document lists the known WebSocket server domains used by Just Dance Now and compatible sites.

## Just Dance Now (justdancenow.com)

The extension dynamically detects any subdomain matching `*-prod-drs.justdancenow.com`.

Known region prefixes:

| Domain | Region |
|--------|--------|
| `ire-prod-drs.justdancenow.com` | Ireland |
| `sap-prod-drs.justdancenow.com` | Brazil |
| `sin-prod-drs.justdancenow.com` | Singapore |
| `vir-prod-drs.justdancenow.com` | United States |

> If new servers are added, the extension will still work — it just shows the raw prefix as the region name.

## Just Dance Now Plus (justdancenowplus.ru)

Unlike justdancenow.com, this site uses a single WebSocket domain without regional prefixes:

```
wss://drs.justdancenowplus.ru/screen
```

### API Servers

| Hostname | Location |
|----------|----------|
| `drs.justdancenowplus.ru` | Russia (Moscow) |
| (Brazil endpoint) | Brazil |

### CDN Servers (HLS Video)

| Hostname | Location |
|----------|----------|
| `hls-us.justdancenowplus.ru` | United States |
| `hls-ru.justdancenowplus.ru` | Russia (St. Petersburg) |

The API server assigns a CDN based on client IP. ODP+ can override this assignment — see [TECHNICAL.md](TECHNICAL.md#jdnp-cdn-override) for details.

> justdancenowplus.ru is a third-party service.
> Server availability may change — check their [Discord](https://discord.gg/Suzt9h4Eck) for current status.
> Server locations sourced from [justdancenowplus.ru/dynamic-map](https://justdancenowplus.ru/dynamic-map/).

---