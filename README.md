# AIC Techno Innovation and Incubation Council

Static website for the AIC Techno Innovation and Incubation Council — West Bengal's first Atal Incubation Centre, supported by the Atal Innovation Mission, NITI Aayog, Government of India.

Live site: [aic-techno.com](https://aic-techno.com)

## Structure

- `index.html` — main site page
- `news.html` — full News & Media listing page
- `assets/` — images and logos
- `.htaccess` — Apache redirect rules (forces HTTPS on aic-techno.com)
- `firebase-cms-sync.js` — Firestore live-sync client; see below for collections it reads

## CMS Data Model (Firestore)

Content is managed through the existing admin panel / Firebase console against project
`aic-techno-cms`, and rendered live on the site by `firebase-cms-sync.js`. Two collections
back the Gallery and News features:

### `gallery` collection

One document per photo, rendered into the homepage `#gallery` grid.

| Field      | Type    | Notes                                                        |
|------------|---------|---------------------------------------------------------------|
| `imageUrl` | string  | Required. Firebase Storage download URL for the photo.        |
| `caption`  | string  | Optional. Shown on hover.                                      |
| `order`    | number  | Sort order, ascending. Defaults to 0 if omitted.               |
| `active`   | boolean | Set to `false` to hide without deleting. Defaults to visible.  |

### `newsArticles` collection

One document per press/news item. Each card links out to the external article.
Rendered as a 3-item preview on the homepage `#news` section and in full on `news.html`.

| Field      | Type    | Notes                                                          |
|------------|---------|-----------------------------------------------------------------|
| `title`    | string  | Required. Headline shown on the card.                           |
| `url`      | string  | Required. External link the card opens (`target="_blank"`).     |
| `source`   | string  | Optional. Publication name, e.g. "The Telegraph".                |
| `date`     | string  | Optional. Freeform display date, e.g. "12 Jan 2026".             |
| `imageUrl` | string  | Optional. Thumbnail image (Firebase Storage URL).                |
| `excerpt`  | string  | Optional. Short summary shown under the title.                   |
| `order`    | number  | Sort order, ascending. Defaults to 0 if omitted.                 |
| `active`   | boolean | Set to `false` to hide without deleting. Defaults to visible.    |

Both collections follow the same conventions as the existing `mentors`/`careers`/`partners`
collections in this file (`order` for manual sorting, `active` for soft-hide, Storage URLs
for images) — no new patterns for the admin panel to support.
