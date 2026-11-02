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

## Startup Portal

Registered startups sign in at `startup-login.html` (`/startup-login`) and land on
`startup-dashboard.html` (`/startup`): a timeline of their own meetings plus general events,
and "Updates from AIC Techno" notifications. "Sign up" sends new founders to the homepage
`#apply` section.

AIC staff manage everything from the **Startup Portal** tab of `booking-dashboard.html`
(`/dashboard#portal`), code in `portal-admin.js`. Registering a startup creates its Firebase
Auth login and emails it a password-setup link (Firebase's password-reset email), so there
is no self sign-up: only startups registered there, with access on, can use the portal.

### `startups` collection — doc id = lowercase login email

| Field         | Type      | Notes                                                    |
|---------------|-----------|----------------------------------------------------------|
| `name`        | string    | Startup name.                                            |
| `founderName` | string    | Used for the "Welcome, …" greeting.                      |
| `email`       | string    | Same as the doc id.                                       |
| `phone`       | string    | Optional.                                                |
| `stage`       | string    | Pre-incubation / Incubation / Acceleration / Alumni.     |
| `active`      | boolean   | `false` blocks portal access.                            |
| `invitedAt`   | timestamp | Last time the password-setup email was sent.             |

### `meetings` collection — private to one startup

| Field          | Type      | Notes                                                   |
|----------------|-----------|---------------------------------------------------------|
| `startupEmail` | string    | Doc id of the startup this meeting belongs to.           |
| `startupName`  | string    | Copied in for display.                                  |
| `title`        | string    |                                                         |
| `startAt`      | timestamp |                                                         |
| `durationMins` | number    |                                                         |
| `mode`         | string    | `In person` or `Online`.                                |
| `location`     | string    |                                                         |
| `meetingLink`  | string    | http(s) only.                                           |
| `host`         | string    | AIC team member / mentor.                               |
| `agenda`       | string    | Shown to the startup.                                   |
| `status`       | string    | `scheduled`, `completed` or `cancelled`.                |

### `portalEvents` collection — shown to every registered startup

`title`, `startAt`, `endAt` (optional), `location`, `link`, `linkLabel`, `description`,
`active` (`false` hides it), `createdAt`.

### `portalNotifications` collection — shown to every registered startup

`title`, `body`, `link`, `linkLabel`, `pinned`, `active`, `createdAt` (shown as the post time).

### Firebase setup

1. **Authentication → Sign-in method:** enable Email/Password.
2. **Authentication → Settings → Authorized domains:** add `aic-techno.com` (and the Vercel
   domain) so password emails link back to the login page.
3. **Authentication → Templates → Password reset:** reword it as an invite, e.g. subject
   "Set up your AIC Techno Startup Portal password".
4. **Authentication → Users:** add an account for each staff member, and list their emails
   in `isAdmin()` below.
5. **Firestore → Rules:** add these (merge with the existing rules for the public CMS
   collections):

```
function isAdmin() {
  return request.auth != null
    && request.auth.token.email in ['admin@aic-techno.com'];   // AIC staff emails
}
function isStartup() {
  return request.auth != null
    && request.auth.token.email_verified == true
    && exists(/databases/$(database)/documents/startups/$(request.auth.token.email))
    && get(/databases/$(database)/documents/startups/$(request.auth.token.email)).data.active != false;
}

match /startups/{email} {
  allow read: if isAdmin() || (request.auth != null && request.auth.token.email == email);
  allow write: if isAdmin();
}
match /meetings/{id} {
  allow read: if isAdmin() || (isStartup() && resource.data.startupEmail == request.auth.token.email);
  allow write: if isAdmin();
}
match /portalEvents/{id} {
  allow read: if isAdmin() || isStartup();
  allow write: if isAdmin();
}
match /portalNotifications/{id} {
  allow read: if isAdmin() || isStartup();
  allow write: if isAdmin();
}
match /contactSubmissions/{id} {
  allow create: if request.resource.data.keys().hasOnly(
      ['name','phone','email','startup','stage','idea','source','campaign','page','status','createdAt'])
    && request.resource.data.name is string && request.resource.data.name.size() <= 100
    && request.resource.data.idea is string && request.resource.data.idea.size() <= 2000
    && request.resource.data.status == 'new'
    && request.resource.data.createdAt == request.time;
  allow read: if isAdmin();
  allow update: if isAdmin()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'updatedAt']);
  allow delete: if false;
}
```

Startups are matched by verified email, so a stray self-created Firebase account can't read
anything, and the portal asks a startup to verify its email if Firebase hasn't marked it
verified yet.
