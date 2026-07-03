/**
 * Prepare crawled HTML for `dangerouslySetInnerHTML`: remove executable scripts
 * and inline event handlers only. Preserves `class`, `style`, `for`, etc. as real HTML.
 *
 * Do **not** pipe body HTML through {@link htmlToJsx} for this path: converting
 * `style="..."` to `style={{...}}` and back breaks on commas inside `rgb()`,
 * `transform`, `url(...)`, etc., which strips styles and hides Framer / motion UIs.
 */
export function sanitizeHtmlForInnerHtml(htmlString: string): string {
  return htmlString
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

/**
 * Shared HTML → JSX-ish markup (e.g. validators or a future true-JSX body embed).
 * For `dangerouslySetInnerHTML`, use {@link sanitizeHtmlForInnerHtml} instead of this + {@link jsxLikeToHtmlForInnerHtml}.
 */
export function htmlToJsx(htmlString: string): string {
  return htmlString
    .replace(/\sclass=/g, " className=")
    .replace(/^class=/gm, "className=")
    .replace(/\sfor=/g, " htmlFor=")
    .replace(/^for=/gm, "htmlFor=")
    .replace(/<(img|br|hr|input|meta|link)([^>]*?)(?<!\/)>/gi, "<$1$2 />")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\sstyle="([^"]*)"/gi, (_match, styles: string) => {
      const obj = styles
        .split(";")
        .filter(Boolean)
        .map((s: string) => {
          const [prop, ...val] = s.split(":");
          if (!prop || !val.length) return null;
          const camel = prop.trim().replace(/-([a-z])/g, (__: string, c: string) => c.toUpperCase());
          return `${camel}: '${val.join(":").trim().replace(/'/g, "\\'")}'`;
        })
        .filter(Boolean)
        .join(", ");
      return ` style={{${obj}}}`;
    })
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*>/gi, "<br />")
    .replace(/<hr\s*>/gi, "<hr />")
    .replace(/tabindex=/gi, "tabIndex=")
    .replace(/autocomplete=/gi, "autoComplete=")
    .replace(/autofocus/gi, "autoFocus")
    .replace(/colspan=/gi, "colSpan=")
    .replace(/rowspan=/gi, "rowSpan=")
    .replace(/srcset=/gi, "srcSet=")
    .replace(/crossorigin=/gi, "crossOrigin=");
}

/** Best-effort inverse so markup from {@link htmlToJsx} is safe for `dangerouslySetInnerHTML` (real HTML). */
export function jsxLikeToHtmlForInnerHtml(markup: string): string {
  let s = markup
    .replace(/\sclassName=/g, " class=")
    .replace(/^className=/gm, "class=")
    .replace(/\shtmlFor=/g, " for=")
    .replace(/^htmlFor=/gm, "for=");

  s = s.replace(/style=\{\{([^}]*)\}\}/gi, (_m, inner: string) => {
    const parts = inner
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const rules: string[] = [];
    for (const part of parts) {
      const m = part.match(/^([\w]+):\s*'([^']*)'\s*$/);
      if (!m) continue;
      const kebab = m[1].replace(/([A-Z])/g, (a, b) => `-${b.toLowerCase()}`).replace(/^-/, "");
      rules.push(`${kebab}: ${m[2]}`);
    }
    if (rules.length === 0) return "";
    return ` style="${rules.join("; ").replace(/"/g, "&quot;")}"`;
  });

  return s
    .replace(/<br \/>/gi, "<br>")
    .replace(/<hr \/>/gi, "<hr>")
    .replace(/<(img|input)([^>]*?) \/>/gi, "<$1$2>");
}
