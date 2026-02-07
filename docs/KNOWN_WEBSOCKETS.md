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

Unlike justdancenow.com, this site uses a single domain without regional prefixes:

```
wss://drs.justdancenowplus.ru/screen
```

| Server | Status |
|--------|--------|
| Russia | Active |
| Brazil | Unknown |

> justdancenowplus.ru is a third-party service. 
> Server availability may change — check their Discord for current status.

---