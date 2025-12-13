# 2026 Taiwan Trip (Gift Reveal Site)

This site is designed for a QR-code reveal.

## Pages
- `index.html` — the **gift gate** (first-visit “open the present” prompt)
- `trip.html` — the full itinerary

## How it works
- When Melissa scans the QR code, she lands on `index.html`.
- Tapping **I opened it** sets a flag in the phone browser (localStorage) and opens `trip.html`.
- If she tries to open `trip.html` directly before that, it sends her back to the gate.

## GitHub Pages
Put these files in your repo root (keep the `assets/` folder).
