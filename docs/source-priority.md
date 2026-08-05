# Source priority

Preferred facts are selected deterministically in `src/lib/research/select-preferred-fact.ts`.

| Field                  | Priority                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| APN                    | County GIS → City GIS → ATTOM → RentCast                               |
| Parcel geometry        | County GIS → City GIS                                                  |
| Zoning                 | City zoning GIS → County zoning GIS → manual official link             |
| Lot size               | Official parcel GIS → ATTOM → RentCast                                 |
| Living area            | ATTOM → official assessor if available → RentCast                      |
| Beds / baths           | ATTOM → RentCast → official assessor                                   |
| Year built             | Official assessor/county → ATTOM → RentCast                            |
| Foundation type        | ATTOM (assessor-derived; verify on site)                               |
| Estimated market value | ATTOM AVM → RentCast value endpoint only if explicit                   |
| Assessment             | Official assessor → ATTOM → RentCast                                   |
| Governing jurisdiction | Official jurisdiction/county → city GIS → ATTOM locality → postal city |

All source values are retained as claims. Preferred values never silently erase alternate claims.
