# MKULIMA Veterinary Intelligence — Production Roadmap
Owner/brand: Avenqor Holdings Ltd

## Current committed deliverable
- `veterinary.html`: mobile-first veterinary information page, symptom observation report generator, emergency escalation guidance, official Kenya resource links, and commercial/enterprise plan previews.
- The symptom report is a local browser-side form, not a diagnostic AI.
- The subscription plans are previews. No payment processor, user authentication, cloud database, live alert feed, or veterinary review workflow is active merely by virtue of this page.

## Next implementation milestones
1. Integrate a link to `veterinary.html` from the existing home page/navigation after inspecting the current app structure.
2. Create a reviewed disease-content schema with species, common/local names, signs, differential diagnoses, urgency, prevention, reporting steps, evidence URLs, review date, reviewer identity/credentials, and content version.
3. Add a clear disclaimer and an escalation path for suspected notifiable diseases. Never claim an outbreak without a verified official source and timestamp.
4. Build real authentication and role-based access (farmer, veterinarian, cooperative/enterprise administrator) with server-side authorization, secure sessions, data minimization, and audit logs.
5. Implement subscriptions using a supported payment provider in test mode first. Keep credentials in environment variables; never commit secrets. Include webhook signature verification, idempotency, plan entitlements, cancellations, and billing status reconciliation.
6. Add database-backed farm, herd/flock, animal, vaccination, treatment, withdrawal-period, and visit records with explicit consent, export and deletion workflows.
7. Build outbreak monitoring only from authorized official feeds or human-verified reports. Store source, timestamp, geography, confidence, and verification status; alert users only after a defined validation process.
8. Have Kenyan registered veterinary professionals review all clinical content and triage flows before public clinical use. AI must not prescribe medicines or replace veterinary assessment, laboratory testing, or official disease declarations.
9. Add automated tests for accessibility, form validation, security, mobile layout, subscription lifecycle, alert provenance, and failed network states.
10. Verify the production deployment status and test the live URL after each merge.

## Proposed content-review disciplines
Clinical veterinary medicine, epidemiology, pathology, microbiology, parasitology, poultry health, pig health, dairy and beef production, small ruminants, animal nutrition, veterinary public health, antimicrobial stewardship, laboratory diagnostics, field surveillance, and veterinary informatics. This is a proposed review structure, not a claim that a 15-person team has been hired.

## Deployment note
A Git commit does not prove a production deployment succeeded. Verify the Netlify deployment and live page separately. Do not claim payments, authentication, real-time outbreak alerts, or AI diagnosis are live until each is implemented and tested.
