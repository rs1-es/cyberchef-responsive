"use strict";
/*
 * Injects the responsive layer into CyberChef HTML files. Idempotent: running it twice is harmless.
 *
 * Usage: node patch-html.js <mobile.css> <mobile.js> <breakpoint-px> <title> <contact> <file.html>...
 *
 * It is used twice: on the source template (src/web/html/index.html, before building) and on the
 * built index.html (to make sure the minifier did not drop anything). Both forms are handled: the
 * minified output may drop attribute quotes and optional closing tags, hence the loose regexes.
 */
const fs = require("fs");
const [, , cssPath, jsPath, bp, title, contact, ...files] = process.argv;

const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8")
  .split("__CC_MOBILE_BP__").join(bp)
  .split("__CC_TITLE__").join(title);
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';

/* The page template goes through lodash.template: its delimiters would be interpreted */
if (css.includes("${") || js.includes("${") || js.includes("<%")) {
  console.error("The responsive layer contains lodash template syntax; aborting.");
  process.exit(1);
}
const UNSAFE = /[<>&"\\]|\$\{/;
if (!title || UNSAFE.test(title)) {
  console.error("Invalid title: " + JSON.stringify(title));
  process.exit(1);
}
if (contact && UNSAFE.test(contact)) {
  console.error("Invalid contact: " + JSON.stringify(contact));
  process.exit(1);
}

const OFFICIAL = '<a href="https://gchq.github.io/CyberChef" target="_blank" rel="noopener">gchq.github.io/CyberChef</a>';
const UPSTREAM = '<a href="https://github.com/gchq/CyberChef" target="_blank" rel="noopener">gchq/CyberChef</a>';

/* The contact can be a URL, an email address or plain text */
function contactHtml(c) {
  if (/^https?:\/\/\S+$/.test(c)) return '<a href="' + c + '" target="_blank" rel="noopener">' + c + "</a>";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return '<a href="mailto:' + c + '">' + c + "</a>";
  return c;
}

const MODAL_TITLE_RE = /(id=["']?support-modal["']?[\s\S]*?<h5 class=["']?modal-title["']?>)CyberChef( - The Cyber Swiss Army Knife)/i;

/* "Modified version" notices. Each one is inserted once (see marker) right after the text matched by "re". */
const NOTICES = [
  {
    /* "Download CyberChef" dialog */
    marker: "cc-modified-notice",
    re: /(id=["']?download-modal["']?[\s\S]*?<div class=["']?modal-body["']?>)/i,
    html:
      '<div class="alert alert-warning" id="cc-modified-notice" role="alert">' +
      "<p><strong>This is a modified version of CyberChef.</strong></p>" +
      "<p>It is built from the official " + UPSTREAM + " source, with an added responsive layer (HTML, CSS and JavaScript) " +
      "so it can be used on mobile devices. The operations and the data processing code are unchanged, but the ZIP file below is " +
      "<strong>not</strong> the official release and its SHA256 hash will not match the one published by GCHQ.</p>" +
      "<p>The official, unmodified version is available at " + OFFICIAL + ".</p>" +
      "</div>\n"
  },
  {
    /* "About / Support" dialog: header */
    marker: "cc-modified-about",
    re: /(id=["']?support-modal["']?[\s\S]*?Released under the Apache Licence, Version 2\.0\.(?:<\/p>)?)/i,
    html:
      '\n<p id="cc-modified-about"><strong>Modified build:</strong> this is not the official CyberChef release. ' +
      "It adds a responsive layer for mobile devices to the official source. Official version: " + OFFICIAL + ".</p>\n"
  },
  {
    /* "About / Support" dialog: "Report a bug" tab */
    marker: "cc-modified-bug",
    re: /(<div[^>]*id=["']?report-bug["']?[^>]*>)/i,
    html:
      '\n<div class="alert alert-warning" id="cc-modified-bug" role="alert">' +
      "<p><strong>Using the modified (responsive) version?</strong> " +
      (contact
        ? "Layout or mobile-only problems should be reported to the maintainer of this version, not to GCHQ: " + contactHtml(contact) + "."
        : "Layout or mobile-only problems come from this modified version, so please do not report them to GCHQ. " +
          "Contact whoever hosts this site instead.") + "</p>" +
      "<p>Bugs that also happen in the official version can be reported on GitHub using the button below.</p>" +
      "</div>\n"
  }
];

for (const file of files) {
  let html = fs.readFileSync(file, "utf8");
  let changed = false;

  if (!html.includes("cc-mobile-style")) {
    if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html)) {
      console.error("   ! no </head> or </body> found in " + file);
      process.exit(1);
    }
    const viewportRe = /<meta[^>]*name=["']?viewport["']?[^>]*>/i;
    html = viewportRe.test(html)
      ? html.replace(viewportRe, () => VIEWPORT)
      : html.replace(/<\/head>/i, () => VIEWPORT + "\n</head>");
    html = html.replace(/<\/head>/i, () => '<style id="cc-mobile-style">\n' + css + "\n</style>\n</head>");
    const idx = html.toLowerCase().lastIndexOf("</body>");
    html = html.slice(0, idx) + '<script id="cc-mobile-script">\n' + js + "\n</script>\n" + html.slice(idx);
    changed = true;
  }

  /* Page title and heading of the About dialog */
  const titleRe = /<title>([^<]*)<\/title>/i;
  const m = titleRe.exec(html);
  if (m && m[1] !== title) {
    html = html.replace(titleRe, () => "<title>" + title + "</title>");
    changed = true;
  }
  if (MODAL_TITLE_RE.test(html)) {
    html = html.replace(MODAL_TITLE_RE, (all, a, b) => a + title + b);
    changed = true;
  }

  for (const n of NOTICES) {
    if (!html.includes(n.marker) && n.re.test(html)) {
      html = html.replace(n.re, (all) => all + n.html);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, html);
    console.log("   + patched: " + file);
  } else {
    console.log("   = already patched: " + file);
  }
}
