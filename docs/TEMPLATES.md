# Templates and fields

Every page has a **schema**: a list of fields. Templates are ready-made schemas with sample content. Editors can change any page's fields with **Fields** in the editor; templates only set the starting point.

## Field types

| Type | Editor control | Stored as | Options |
|---|---|---|---|
| `text` | Single line | string (max 500) | `placeholder`, `maxLength` |
| `textarea` | Multi-line | string (max 10,000), rendered as Markdown | `rows`, `maxLength` |
| `markdown` | Multi-line with formatting toolbar, image and block insert, document import | string (max 100,000) | `rows`, `maxLength` |
| `number` | Number input | number | `min`, `max`, `step` |
| `url` | Link input | string: `https://`, `/path`, `#anchor`, `mailto:` or `tel:` | |
| `email` | Email input | string | |
| `tel` | Phone input | string | |
| `date` | Date picker | `YYYY-MM-DD` | |
| `time` | Time picker | `HH:MM` | |
| `datetime` | Date and time picker | `YYYY-MM-DDTHH:MM` (local time, shown as entered) | |
| `select` | Drop-down | one of `options` | `options` (required) |
| `checkbox` | Checkbox | boolean | |
| `image` | Library picker, upload, or URL, plus alt text | `{ src, alt }` | |
| `list` | Rows of short text | array of strings | |
| `repeater` | Repeating group of sub-fields, reorderable | array of objects | `fields` (required, no nested repeaters), `itemLabel` |

Every field has `key` (lowercase letters, digits and underscores, starting with a letter), `label`, and optionally `required` (enforced when publishing) and `description` (help text under the field).

## How fields become a page

The renderer picks a layout from the schema, so most templates need no custom code:

| Field | Rendered as |
|---|---|
| First of `headline`, `title`, `name`, `question` (or a `*name` text field) | Page heading (`h1`) and browser title |
| First of `subheadline`, `tagline`, `summary`, `excerpt`, `subtitle`, `message` | Lede paragraph and meta description |
| A choice named `status`, `availability`, `urgency` or `level` | Coloured badge. Values like Open, Closed, Sold Out, Degraded and Outage get matching colours |
| First image | Full-width hero image and link-preview image |
| `x_label` + `x_url` pairs | Buttons (the first is primary) |
| Long text named `body`, `content`, `description` or `answer` | Main text, with a table of contents when it has three or more `##` headings |
| Other long text | Section with the field label as heading |
| Short values (text, numbers, dates, links, email, phone, choices, yes/no) | Details panel |
| `list` | Tag-style list |
| `repeater` | Cards. A sub-field with `price`, `cost` or `fee` in its key appears on the right; a `question` + `answer` pair becomes collapsible FAQ entries |

Empty fields are skipped.

## Writing a template

1. Create `templates/<name>/template.json`:

```json
{
  "title": "Volunteer Shifts",
  "description": "Upcoming shifts people can sign up for.",
  "schema": {
    "fields": [
      { "key": "title", "label": "Title", "type": "text", "required": true },
      { "key": "summary", "label": "Summary", "type": "textarea", "rows": 2 },
      { "key": "signup_label", "label": "Sign-up button text", "type": "text" },
      { "key": "signup_url", "label": "Sign-up link", "type": "url" },
      {
        "key": "shifts", "label": "Shifts", "type": "repeater", "itemLabel": "Shift",
        "fields": [
          { "key": "name", "label": "Shift", "type": "text", "required": true },
          { "key": "date", "label": "Date", "type": "date" },
          { "key": "notes", "label": "Notes", "type": "textarea" }
        ]
      }
    ]
  },
  "sample": {
    "title": "Volunteer with us",
    "summary": "Pick a shift that suits you.",
    "signup_label": "Sign up",
    "signup_url": "https://forms.example.org/volunteer",
    "shifts": [{ "name": "Saturday market", "date": "2026-06-06", "notes": "8am to noon" }]
  }
}
```

2. Add it to `templates/index.js`:

```js
import volunteerShifts from './volunteer-shifts/template.json' with { type: 'json' };
// ...
export const TEMPLATES = {
    // ...
    'volunteer-shifts': volunteerShifts,
};
```

3. Run `npm run check`, which validates every template and its sample.

The `template` name is stored on each page and added to the page's HTML as a class (`page-volunteer-shifts`), so you can style a template specifically in `public/assets/site.css`.
