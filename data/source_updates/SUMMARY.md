# Public source refresh — 15 October 2026

The immutable crawl remains unchanged (218 raw file hashes verified). Refetched 15 public HTML pages, applied the updated canonical trade courses overview, and ran local RapidOCR on both pages of the legacy Education Agent Performance Review Form. Both rendered pages were visually checked; original OCR lines/boxes/confidence and spacing corrections are retained separately. The source itself says “conversation rate”; this apparent source typo is preserved.

Added four searchable documents: Change of Details instruction, Policies & Forms directory, Agent Review Form, and Education Agent Performance Review Form. Updated the existing course overview. Result: 115 documents, 2,156 chunks; 24 course identities, 44 intake records, and 96 fee candidates preserved. Seven chunks required new local BGE-M3 vectors.

| Reviewed page | Disposition |
|---|---|
| agent-review-form | Exclude HTML: unresolved shortcode; linked legacy PDF added separately |
| application-leave-form | Exclude: title only |
| change-of-details-form | Include: complete every 6 months or when a change occurs |
| complaint-grievance-or-appeal-form | Exclude: no distinct readable form content |
| course-transfer-request-form | Exclude: title only |
| credit-transfer-form | Exclude: title only |
| critical-incident-report-form | Exclude: title only; separately linked current PDF remains 404 |
| deferral-suspension-or-cancellation-request-form | Exclude: title only |
| discontinuation-deferring-of-studies-form | Exclude: title only |
| education-agent-information-update-form | Exclude: title only |
| education-agent-performance-review-form | Exclude HTML: unresolved shortcode; OCRed legacy PDF added separately |
| hazard-incident-report-form-2 | Exclude: unresolved shortcode |
| hazard-incident-report-form | Exclude: no distinct readable form content |
| policies-forms | Include: nine named legacy PDF links with version warning |

Legacy directory links are useful for locating files, but do not override newer policy sources. Forms are blank templates, not student/agent records; no submission workflow or approval status was invented. Broken shortcodes cannot reveal private backend form definitions through public HTML. Remaining missing assets and generic enquiry widgets were not replaced with fabricated form fields. This work does not OCR every decorative photo/banner on the website.

Reproduction: `requirements-ocr.txt` → `scripts/refresh_reviewed_sources.py` → `scripts/prepare_knowledge.py` → `scripts/verify_processed.py` and `scripts/verify_source_updates.py` → `npm run ingest` → restart app. Original crawl is required for rebuilding; the included processed snapshot is sufficient for ordinary demo ingestion.
