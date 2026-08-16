# Bókun FAQ widget

Duda custom widget for the FAQ pulled from Bókun's `Field101` custom field.

## Content panel inputs

Create these in Widget Builder → Widget Properties → Content panel. Names must match exactly — they are the handlebars variables.

| Name | Input type | Default | Notes |
|---|---|---|---|
| `heading` | Text | `Frequently Asked Questions` | Rendered as the section `h2`. Leave blank to omit. |
| `faqHtml` | Rich Text | — | **Bind to the collection's `faq` field.** This is the important one. |
| `faqSchema` | Text | — | Bind to the collection's `faqSchema` field. |
| `bokunId` | Text | — | Only for static pages. Leave empty on the dynamic template. |
| `endpoint` | Text | `https://bokun-api.vercel.app/api/collection` | Only used by the `bokunId` fallback. |
| `singleOpen` | Toggle | off | On = one panel open at a time. |

## Two ways it gets content

**Bound (use this on the tour template).** `faqHtml` is connected to the collection field, so Duda renders the Q&A into the published HTML at build time. Crawlers see the full text without running JavaScript, which is what the SEO brief requires.

**Fetched (fallback).** If `faqHtml` is empty and `bokunId` is set, the widget calls `?id=<bokunId>` on the endpoint and injects the result. Convenient for dropping one product's FAQ on a static page — but the content is then JS-injected and **not** in the served HTML, so don't use this route on pages that need to rank.

## Setup

1. Paste `html.hbs` inside the wrapper div in Code → Html.
2. Paste `widget.js` into Code → Javascript, replacing the empty `initWidget`.
3. Paste `styles.scss` into Code → Css/Scss and `mobile.scss` into Code → Mobile.Scss.
4. Add the content inputs above.
5. Save, Republish, then Test in Editor.
6. On the tour template, bind `faqHtml` → `faq` and `faqSchema` → `faqSchema`.
7. Set the section to show only when `faqCount` is greater than 0.

## Behaviour

Answers render expanded until the script runs, so a failed script degrades to a readable Q&A list rather than an empty block. Panels animate open via `max-height`, and each toggle is a real `button` with `aria-expanded` / `aria-controls` wired up.

Markup contract from the endpoint:

```html
<div class="faq-list">
  <div class="faq-item">
    <h3 class="faq-question">Question?</h3>
    <div class="faq-answer"><p>Answer</p></div>
  </div>
</div>
```
