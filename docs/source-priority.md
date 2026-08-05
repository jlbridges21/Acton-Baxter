# Source priority

Preferred facts are selected deterministically in `src/lib/research/select-preferred-fact.ts`.

**RentCast is the intended long-term licensed provider.** ATTOM remains in the priority table while its trial key is set; when `ATTOM_API_KEY` is unset, ATTOM rows simply do not contribute claims.

| Field                  | Priority                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| APN                    | County GIS → City GIS → ATTOM (if configured)                                |
| Parcel geometry        | County GIS → City GIS                                                        |
| Zoning                 | City zoning GIS → County zoning GIS → manual official link                   |
| Lot size               | Official parcel GIS → ATTOM (if configured) → RentCast                       |
| Living area            | ATTOM (if configured) → official assessor if available → RentCast            |
| Beds / baths           | ATTOM (if configured) → RentCast → official assessor                         |
| Year built             | Official assessor/county → ATTOM (if configured) → RentCast                  |
| Foundation type        | ATTOM only when configured (assessor-derived; else site inspection)          |
| Estimated market value | ATTOM AVM only when configured (not claimed from RentCast today)             |
| Building count         | ATTOM only when configured                                                   |
| Tract number           | ATTOM only when configured (else look up via assessor / recorder)            |
| Assessment             | Official assessor → ATTOM (if configured) → RentCast                         |
| Governing jurisdiction | Official jurisdiction/county → city GIS → provider locality → postal         |
| Flood zone             | FEMA NFHL Flood Hazard Zones (automated ArcGIS PIP) → FEMA MSC link          |
| Fire hazard severity   | CAL FIRE FHSZ SRA (Apr 2024) → LRA recommended (Mar 2025) → OSFM viewer      |
| WUI classification     | CAL FIRE WUI25 screen layer (with mandatory caveat) → CAL FIRE / CNRA viewer |

**WUI honesty:** WUI is a screen-level relative-risk indicator (housing density × fire threat), not a definitive parcel designation. Reports always include: _screen-level indicator — verify parcel-specific WUI status with the local jurisdiction_.

All source values are retained as claims. Preferred values never silently erase alternate claims. With a single licensed provider, cross-provider conflicts simply do not appear.
