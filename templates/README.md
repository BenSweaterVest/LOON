# LOON Example Schemas

This folder contains example schemas for different use cases. Copy these to your `data/` folder and customize as needed.

---

## Available Examples

### Food Truck (`food-truck/`)

A schema for food truck operators to update their status and location.

**Fields:** name, status, location, hours, specials, menu link, phone

**Use case:** Food truck tracker, pop-up shop directory, mobile vendor network

---

### Blog Post (`blog-post/`)

A schema for creating blog posts or articles.

**Fields:** title, author, excerpt, body, tags, status

**Use case:** Personal blog, team updates, news site, announcements

---

### Landing Page (`landing-page/`)

A schema for a homepage or campaign landing page.

**Fields:** headline, subheadline, hero image, calls to action, highlights, sections

**Use case:** Campaigns, program signups, organizational homepages

---

### Documentation Page (`documentation-page/`)

A schema for structured documentation or notes.

**Fields:** title, summary, body, references, version, status

**Use case:** Internal docs, guides, reference pages

---

### Event (`event/`)

A schema for event organizers to manage event information.

**Fields:** name, date, time, location, description, status, registration link, free (checkbox), contact email

**Use case:** Meetup pages, conference sessions, community events, recurring meetings

---

### Business Hours (`business-hours/`)

A schema for businesses to display their status and operating hours.

**Fields:** name, status, weekday hours, Saturday hours, Sunday hours, notice, phone, address, website

**Use case:** Small business status page, store hours display, service availability

---

### Team Profile (`team-profile/`)

A schema for team members to manage their own profile information.

**Fields:** name, title, department, bio, email, phone, photo URL, LinkedIn, availability toggle

**Use case:** Company team directory, organization staff page, board member listings

---

### Job Posting (`job-posting/`)

A schema for HR or hiring managers to post job listings.

**Fields:** title, department, location, type, salary range, description, requirements, benefits, apply link, contact, status, remote toggle

**Use case:** Careers page, job board, recruitment listings

---

### Contact Page (`contact-page/`)

A schema for managing organization contact information.

**Fields:** organization name, tagline, address, phones, emails, hours, website, map link, additional info

**Use case:** Contact us page, location info, office directory

---

### Menu & Pricing (`menu-pricing/`)

A schema for displaying services, products, or menu items with prices.

**Fields:** business name, category, items list, specials, notes, effective date, currency

**Use case:** Restaurant menus, salon services, repair shop pricing, any service-based business

---

### Menu Page (`menu-page/`)

A schema for a quick, sectioned menu.

**Fields:** title, summary, hours, sections, notes

**Use case:** Cafes, weekly menus, daily offerings

---

### Announcement (`announcement/`)

A schema for posting time-sensitive notices and alerts.

**Fields:** title, urgency level, effective/expiry dates, summary, body, action link, contact, pinned toggle

**Use case:** Office closures, emergency notices, policy updates, news items

---

### FAQ (`faq/`)

A schema for frequently asked questions.

**Fields:** question, answer, category, related link, search keywords, display order, published toggle

**Use case:** Help center, support documentation, knowledge base

---

### Portfolio (`portfolio/`)

A schema for showcasing projects and work samples.

**Fields:** title, client, date, category, summary, description, image URL, project URL, tags, featured toggle, testimonial

**Use case:** Designer portfolios, agency work, contractor projects, case studies

---

### Product/Service (`product-service/`)

A schema for showcasing a product or service offering.

**Fields:** name, tagline, description, price, features, image, CTA button, availability, category, featured toggle

**Use case:** Product pages, service offerings, SaaS features, consulting packages

---

### Testimonial (`testimonial/`)

A schema for customer testimonials and reviews.

**Fields:** quote, author name, title, company, photo, rating, product reviewed, date, source, featured/approved toggles

**Use case:** Customer reviews, case study quotes, social proof sections

---

### Task List (`todo-page/`)

A schema for tracking tasks and ownership.

**Fields:** title, owner, due date, status, tasks, notes

**Use case:** Project checklists, weekly priorities, operations tracking

---

### Class/Workshop (`class-workshop/`)

A schema for educational offerings.

**Fields:** title, instructor, description, level, schedule, dates, duration, location, capacity, spots available, price, requirements, registration link, status

**Use case:** Yoga studios, gyms, tutoring, cooking classes, workshops, continuing education

---

### Service Status (`service-status/`)

A schema for system status and uptime pages.

**Fields:** service name, status, message, incident details, start time, expected resolution, last checked, uptime %, scheduled maintenance, support contact

**Use case:** SaaS status pages, IT service status, infrastructure monitoring

---

### Property Listing (`property-listing/`)

A schema for real estate and rental listings.

**Fields:** title, property type, listing type, price, address, bedrooms, bathrooms, sqft, lot size, year built, description, features, photos, virtual tour, contact info, available date

**Use case:** Real estate listings, rental properties, vacation rentals, commercial space

---

## How to Use

1. **Copy the example folder to `data/`:**
   ```
   cp -r examples/event data/my-event
   ```

2. **Add the password env var in Cloudflare:**
   ```
   USER_MY-EVENT_PASSWORD = your-secure-password
   ```

3. **Customize the schema** if needed (edit `schema.json`)

4. **Redeploy** or wait for auto-deploy

5. **User logs in** at `/admin.html` with Page ID: `my-event`

---

## Creating Your Own Schema

A schema file (`schema.json`) defines what fields appear in the editor:

```json
{
  "title": "Page Title",
  "description": "Optional description shown on login",
  "fields": [
    {
      "key": "fieldName",
      "label": "Display Label",
      "type": "text",
      "placeholder": "Optional placeholder",
      "required": true,
      "description": "Help text shown below the field"
    }
  ]
}
```

---

## Supported Field Types

| Type | HTML Element | Description | Options |
|------|--------------|-------------|---------|
| `text` | `<input type="text">` | Single-line text | `placeholder` |
| `textarea` | `<textarea>` | Multi-line text | `placeholder`, `rows` |
| `select` | `<select>` | Dropdown menu | `options` (array) |
| `email` | `<input type="email">` | Email address | `placeholder` |
| `url` | `<input type="url">` | URL/link | `placeholder` |
| `number` | `<input type="number">` | Numeric value | `placeholder` |
| `tel` | `<input type="tel">` | Phone number | `placeholder` |
| `date` | `<input type="date">` | Date picker | - |
| `time` | `<input type="time">` | Time picker | - |
| `datetime` | `<input type="datetime-local">` | Date and time | - |
| `checkbox` | `<input type="checkbox">` | Boolean toggle | `description` |
| `hidden` | (not displayed) | Metadata storage | `default` |

---

## Field Options

All field types support these options:

| Option | Type | Description |
|--------|------|-------------|
| `key` | string | Field identifier (used in JSON) |
| `label` | string | Display label |
| `type` | string | One of the types above |
| `placeholder` | string | Placeholder text (where applicable) |
| `required` | boolean | Mark field as required |
| `description` | string | Help text below the field |

Type-specific options:

| Type | Option | Description |
|------|--------|-------------|
| `select` | `options` | Array of choices |
| `textarea` | `rows` | Number of visible rows (default: 5) |
| `hidden` | `default` | Default value if not set |

---

## Example Field Definitions

**Select dropdown:**
```json
{
  "key": "status",
  "label": "Status",
  "type": "select",
  "required": true,
  "options": ["Active", "Inactive", "Pending"]
}
```

**Multi-line text:**
```json
{
  "key": "description",
  "label": "Description",
  "type": "textarea",
  "rows": 6,
  "placeholder": "Enter a detailed description..."
}
```

**Date field:**
```json
{
  "key": "event_date",
  "label": "Event Date",
  "type": "date",
  "required": true
}
```

**Checkbox toggle:**
```json
{
  "key": "published",
  "label": "Published",
  "type": "checkbox",
  "description": "Make this content visible on the public site"
}
```

**Phone number:**
```json
{
  "key": "phone",
  "label": "Contact Phone",
  "type": "tel",
  "placeholder": "(555) 123-4567"
}
```
