# Integrations, Security and Migration Notes

## Baxter
- Implement new tool in existing Baxter codebase with existing admin authorization and infrastructure, and no unrelated changes.
- Baxter admins land on Configurator Admin; public URL is separate and requires no Baxter login.
- Staging/public route in Baxter initially; **do not change** live `design.actonadu.com` until ownership/DNS cutover is authorized.
- Provide DNS/alias/SSL/checklist for later cutover; preserve deep links and GHL embeds.

## GoHighLevel (keep existing contracts)
- Get in Touch / Free Quote widget: `https://api.leadconnectorhq.com/widget/form/p1swLQWD4mVI7APiGzFp`
- `We'll need your location` pricing gate widget: `https://api.leadconnectorhq.com/widget/form/pV3Gf1zaZHLuCTipKGKZ`
- Existing script: `https://link.msgsndr.com/js/form_embed.js`
- Existing pricing form is embedded with a `STICKY_SIDEBAR` configuration in supplied source. Preserve current visual modal experience while keeping functional form destination/consent behavior. Investigate how completion is communicated and validate region before revealing price.
- Keep form IDs, destination, GHL integration and existing webhooks intact; do not create new GHL webhook URLs or replace form workflows unless expressly directed.
- Existing selection values and CRM custom field mappings are **unknown**; investigate carefully and report any inability to preserve them. Test submissions with approved test records, not uncontrolled live leads.

## Can I Build
- User has provider access and API credentials separately; credentials are not in this package.
- Existing property-check trigger brings up address/contact modal and launches a Can I Build `leadconverter.canibuild.com` widget; sample widget accepts `token`, `series`, `model`, `exterior`, `interior`, `appliances`, `bathroom`, `upgrades` query parameters, but observed results can still include multiple designs. Treat parameters as observed URL behavior, not proof that design filtering works.
- Uploaded `canibuild_custom_api.pdf`, Version 1.0, is an HTTPS XML **property listing publish/unpublish API** with `X-Canibuild-Token` and JSON processing results. It is NOT documentation proving property suitability search, model filtering, or widget control. Its schema contains unresolved placeholders in earlier sections. Do not implement a property search against the listing publication endpoint.
- Integrate existing widget launch as closely as possible if feasible, investigate actual widget/Lead Converter docs and partner settings, and consider a small provider adapter so further capability can be added later. Explicitly mark Can I Build integration **optional for v1** and document needed provider API info if unresolved.

## Existing frontend / source
- Current public: `https://design.actonadu.com/`
- Current admin reference: `https://design.actonadu.com/admin/` (current backend source/database not available)
- Sample Signature selection: `https://design.actonadu.com/?series=signature&model=cypress-s748-b1&viewMode=elevation`
- Historic prices from screenshots are not authoritative; prefer simple editable zero defaults as unverified drafts.
- Reproduce UI and existing deep-link behavior through inspection/screenshots. Avoid copy-pasting unknown legacy code if unavailable.

## Operational safeguards
- **Never** put the shared admin login/password from conversation in generated documents or code. If browser access to legacy admin is truly needed, request/consume credentials securely outside committed files; recommend password rotation.
- Store tokens/secrets only server-side; validate form and region inputs; use authorization and version checks for publishing; no accidental public access to draft data.
- Provide import report, missing assets checklist, unidentified model IDs/aliases, regional price review report, migration changes, and rollback plan.
