# Folio

**A social network where your feed is a book.**

Folio binds everything the people you follow write into a book you can read: there's an endpaper with your bookplate, a title page, a table of contents, and a new chapter for each day. Posts are set as passages, with drop caps, small-caps lead-ins and running heads. You turn the pages to scroll.

| Social media | Folio |
| --- | --- |
| Feed | **A Commonplace Book**, bound from the authors on your shelf |
| Global timeline | **The Commons**, every passage in the house |
| Profile | **A volume**: "The Collected Passages of …" |
| Follow | **Shelve** a volume (in the Library, where every author is a book spine) |
| Post | **Write a page**, bound into today's chapter |
| Like | **Dog-ear** a passage |
| Reply | **Write in the margin**. Notes appear as footnotes (\*, †, ‡) |
| Delete | **Tear out the page** |
| "New posts" badge | A red **ribbon** marks where your unread pages begin |

## Running it

Requires Node 18+. There are no dependencies to install.

```bash
cd folio
npm start          # or: node server.js
# open http://localhost:3000
```

The first run seeds a small library of authors. To look around, sign in as `guest` with the password `reader` (every seeded author uses that password), or join with your own pen name.

Data is stored in `folio/data/db.json`. Delete that file to start over. Set `PORT` or `FOLIO_DATA` to change the port or the data directory.

## Reading

- **Turn pages:** use ← / → (or PageUp/PageDown), click the page edges, swipe on touch screens, or drag the slider.
- **Contents** jumps to the table of contents. Click any chapter to turn to it.
- **Latest** jumps to the last page, where the newest passages are.
- Wide screens show a two-page spread with a 3D page turn. Phones show one page at a time.
- Folio remembers where you stopped reading in each book. When new passages arrive, a ribbon marks the first one.
- Under **Reading light** in your bookplate, choose Daylight or Lamplight (dark mode), or follow your device.

## How the binding works

Pages are laid out in the browser. Each passage is measured in an off-screen page the same size as the real ones, and the pages fill up one after another. If a passage doesn't fit on the rest of a page, it either moves to the next page or is split mid-sentence with "continued overleaf", whichever wastes less space. The layout is redone whenever the window size changes. The table of contents is filled in once every chapter's page number is known.

## Files

```
folio/
  server.js        HTTP server + JSON API (no dependencies)
  seed.js          starter authors and passages
  public/
    index.html
    styles.css     paper, type, spreads, page-turn, shelves, dark mode
    app.js         pagination engine, page turning, routing, modals
```
