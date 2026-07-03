/**
 * Deterministic HTML → JSX converter + section splitter.
 *
 * Powers the React and Next.js exports: the crawled DOM is converted into real
 * JSX component files (no AI, no dangerouslySetInnerHTML, no runtime HTML parsing).
 * Cheerio (parse5) handles the DOM so SVG tag/attribute casing survives.
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";

// ─── Attribute translation ──────────────────────────────────────────

/** HTML attributes whose JSX names differ. */
const HTML_ATTR_MAP: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  autoplay: "autoPlay",
  playsinline: "playsInline",
  colspan: "colSpan",
  rowspan: "rowSpan",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  srcset: "srcSet",
  crossorigin: "crossOrigin",
  usemap: "useMap",
  frameborder: "frameBorder",
  allowfullscreen: "allowFullScreen",
  contenteditable: "contentEditable",
  spellcheck: "spellCheck",
  enctype: "encType",
  formaction: "formAction",
  formenctype: "formEncType",
  formmethod: "formMethod",
  formnovalidate: "formNoValidate",
  formtarget: "formTarget",
  novalidate: "noValidate",
  datetime: "dateTime",
  accesskey: "accessKey",
  inputmode: "inputMode",
  referrerpolicy: "referrerPolicy",
  srcdoc: "srcDoc",
  srclang: "srcLang",
  hreflang: "hrefLang",
  "http-equiv": "httpEquiv",
  fetchpriority: "fetchPriority",
  charset: "charSet",
  itemscope: "itemScope",
  itemtype: "itemType",
  itemprop: "itemProp",
  itemid: "itemID",
  itemref: "itemRef",
  controlslist: "controlsList",
  disablepictureinpicture: "disablePictureInPicture",
  disableremoteplayback: "disableRemotePlayback",
  enterkeyhint: "enterKeyHint",
  popovertarget: "popoverTarget",
  popovertargetaction: "popoverTargetAction",
  "xlink:href": "xlinkHref",
  "xlink:title": "xlinkTitle",
  "xml:lang": "xmlLang",
  "xml:space": "xmlSpace",
  "xmlns:xlink": "xmlnsXlink",
};

/** Attributes that are boolean in React (bare name = true). */
const BOOLEAN_ATTRS = new Set([
  "allowFullScreen",
  "async",
  "autoFocus",
  "autoPlay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formNoValidate",
  "hidden",
  "loop",
  "multiple",
  "muted",
  "noValidate",
  "open",
  "playsInline",
  "readOnly",
  "required",
  "reversed",
  "selected",
]);

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const SVG_TAGS = new Set([
  "svg",
  "path",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "rect",
  "g",
  "defs",
  "symbol",
  "use",
  "text",
  "tspan",
  "textPath",
  "marker",
  "mask",
  "pattern",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDropShadow",
  "feFlood",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "feSpecularLighting",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "desc",
  "title",
  "switch",
  "view",
  "animate",
  "animateMotion",
  "animateTransform",
  "mpath",
  "set",
  "metadata",
]);

function kebabToCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function jsxAttrName(rawName: string, inSvg: boolean): string {
  const name = rawName;
  const lower = name.toLowerCase();
  if (lower.startsWith("data-") || lower.startsWith("aria-")) return lower;
  if (HTML_ATTR_MAP[lower]) return HTML_ATTR_MAP[lower];
  // SVG presentation attributes: stroke-width → strokeWidth, clip-path → clipPath, …
  if (inSvg && name.includes("-")) return kebabToCamel(name);
  // parse5 already restores camelCase for known SVG attrs (viewBox, preserveAspectRatio, …)
  return name;
}

// ─── style="…" → style={{…}} ────────────────────────────────────────

/** Split CSS declarations on ";" that are not inside url(...) / calc(...) parens. */
function splitCssDeclarations(styleText: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of styleText) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function cssPropToJsKey(prop: string): string {
  const p = prop.trim();
  if (p.startsWith("--")) return JSON.stringify(p); // CSS custom property
  // -webkit-foo → WebkitFoo, -moz-foo → MozFoo, -ms-foo → msFoo
  let name = p;
  let prefix = "";
  const m = p.match(/^-(webkit|moz|o|ms)-(.+)$/i);
  if (m) {
    prefix =
      m[1].toLowerCase() === "ms"
        ? "ms"
        : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    name = m[2];
  }
  const camel = kebabToCamel(name);
  const key = prefix
    ? `${prefix}${camel[0].toUpperCase()}${camel.slice(1)}`
    : camel;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

export function styleStringToJsxObject(styleText: string): string {
  const entries: string[] = [];
  for (const decl of splitCssDeclarations(styleText)) {
    const idx = decl.indexOf(":");
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    entries.push(`${cssPropToJsKey(prop)}: ${JSON.stringify(value)}`);
  }
  return `{{ ${entries.join(", ")} }}`;
}

// ─── Text escaping ──────────────────────────────────────────────────

/** JSX text nodes may not contain <, >, {, } - wrap runs containing them in {"…"}. */
function escapeJsxText(text: string): string {
  if (!/[<>{}]/.test(text)) return text;
  return `{${JSON.stringify(text)}}`;
}

// ─── Serializer ─────────────────────────────────────────────────────

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function serializeAttrs(el: Element, inSvg: boolean): string {
  const parts: string[] = [];
  for (const [rawName, rawValue] of Object.entries(el.attribs || {})) {
    // Event handlers and framework-injected attrs never survive into JSX
    if (/^on[a-z]/i.test(rawName)) continue;
    const name = jsxAttrName(rawName, inSvg);
    if (name === "style") {
      const obj = styleStringToJsxObject(rawValue);
      if (obj !== "{{  }}") parts.push(`style=${obj}`);
      continue;
    }
    if (rawValue === "" && BOOLEAN_ATTRS.has(name)) {
      // React controlled-input rule: uncontrolled initial state uses default*
      parts.push(name === "checked" ? "defaultChecked" : name);
      continue;
    }
    if (name === "checked") {
      parts.push("defaultChecked");
      continue;
    }
    if (name === "value" && (el.name === "input" || el.name === "select")) {
      parts.push(`defaultValue="${rawValue.replace(/"/g, "&quot;")}"`);
      continue;
    }
    // Values are plain strings; use quotes when safe, JSX expression otherwise
    if (!rawValue.includes('"') && !rawValue.includes("\n")) {
      parts.push(`${name}="${rawValue}"`);
    } else {
      parts.push(`${name}={${JSON.stringify(rawValue)}}`);
    }
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function serializeNode(node: AnyNode, inSvg: boolean, depth: number): string {
  const pad = "  ".repeat(depth);

  if (node.type === "text") {
    const data = (node as Text).data;
    if (!data.trim()) return ""; // inter-element whitespace
    return pad + escapeJsxText(data.trim()) + "\n";
  }
  if (node.type === "comment") return "";
  if (!isElement(node)) return "";

  const el = node;
  const tag = el.name;

  // Scripts never survive; styles are hoisted into the global stylesheet upstream
  if (tag === "script") return "";
  if (tag === "style") return "";
  if (tag === "link" || tag === "meta" || tag === "base" || tag === "title")
    return "";

  const svgNow = inSvg || tag === "svg";
  const attrs = serializeAttrs(el, svgNow);

  if (VOID_ELEMENTS.has(tag) || el.children.length === 0) {
    return `${pad}<${tag}${attrs} />\n`;
  }

  // textarea keeps its content via defaultValue (React controlled-input rule)
  if (tag === "textarea") {
    const inner = el.children
      .filter((c): c is Text => c.type === "text")
      .map((c) => c.data)
      .join("");
    return `${pad}<textarea${attrs} defaultValue={${JSON.stringify(inner)}} />\n`;
  }

  let childrenOut = "";
  for (const child of el.children) {
    childrenOut += serializeNode(child, svgNow, depth + 1);
  }

  if (!childrenOut) {
    return `${pad}<${tag}${attrs} />\n`;
  }
  return `${pad}<${tag}${attrs}>\n${childrenOut}${pad}</${tag}>\n`;
}

/** Convert an HTML fragment into JSX markup (multiple roots are allowed). */
export function convertHtmlFragmentToJsx(html: string, depth = 0): string {
  const $ = cheerio.load(html, null, false);
  const roots = $.root().contents().toArray();
  let out = "";
  for (const node of roots) {
    out += serializeNode(node, false, depth);
  }
  return out;
}

// ─── Section splitting ──────────────────────────────────────────────

export interface JsxSection {
  /** PascalCase component name, unique within a page. */
  name: string;
  kind: "header" | "footer" | "section";
  /** Original HTML of this section (used for cross-page dedup). */
  html: string;
  /** JSX body (markup only, no component wrapper). */
  jsx: string;
}

export interface PageSplit {
  /** JSX for the page body with section components referenced as <Name />. */
  pageJsx: string;
  sections: JsxSection[];
}

function toPascal(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  if (!cleaned) return "";
  return /^[0-9]/.test(cleaned) ? `Section${cleaned}` : cleaned;
}

function elementText(
  $: cheerio.CheerioAPI,
  el: Element,
  selector: string,
): string {
  const found = $(el).find(selector).first();
  return found.length ? found.text().trim() : "";
}

/** Best human name for a section element. Framer stamps data-framer-name on blocks. */
function sectionName(
  $: cheerio.CheerioAPI,
  el: Element,
  index: number,
  used: Set<string>,
): { name: string; kind: JsxSection["kind"] } {
  const tag = el.name.toLowerCase();
  // Own name first, then direct children only - deep .find() would steal a
  // nested block's name (e.g. the navbar variant inside a page wrapper)
  const framerName =
    el.attribs?.["data-framer-name"] ||
    el.children
      .filter(isElement)
      .map((c) => c.attribs?.["data-framer-name"])
      .find(Boolean) ||
    "";
  const idName = el.attribs?.id || "";

  let kind: JsxSection["kind"] = "section";
  const nameHint =
    `${tag} ${framerName} ${idName} ${el.attribs?.class || ""}`.toLowerCase();
  if (
    tag === "header" ||
    tag === "nav" ||
    /\b(nav|navbar|header|menu)\b/.test(nameHint)
  )
    kind = "header";
  else if (tag === "footer" || /\bfooter\b/.test(nameHint)) kind = "footer";

  let base = "";
  if (kind === "header") base = "SiteHeader";
  else if (kind === "footer") base = "SiteFooter";
  else if (framerName) base = toPascal(framerName);
  else if (idName) base = toPascal(idName);
  else {
    const heading = elementText($, el, "h1, h2, h3");
    if (heading) {
      const words = heading.split(/\s+/).slice(0, 3).join(" ");
      base = toPascal(words);
    }
  }
  if (!base) base = `Section${index + 1}`;
  if (base.length > 40) base = base.slice(0, 40);
  if (!/Section|Header|Footer|Hero|Nav/i.test(base)) base += "Section";

  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}${n++}`;
  used.add(name);
  return { name, kind };
}

const MIN_SECTION_HTML = 120;

/**
 * Split a page body into wrapper JSX + section components.
 *
 * Framer bodies look like:
 *   <div id="main" data-framer-hydrate-v2><div data-framer-root>…sections…</div></div>
 * We descend single-child wrappers, then treat the container's element children
 * as sections. Tiny fragments stay inline in the page component.
 */
export function splitPageIntoSections(bodyHtml: string): PageSplit {
  const $ = cheerio.load(bodyHtml, null, false);
  const topNodes = $.root().contents().toArray();
  const topElements = topNodes
    .filter(isElement)
    .filter((el) => el.name !== "script" && el.name !== "style");

  // Main root = largest top-level element by serialized size
  let main: Element | null = null;
  let mainSize = -1;
  for (const el of topElements) {
    const size = $.html(el)?.length ?? 0;
    if (size > mainSize) {
      mainSize = size;
      main = el;
    }
  }

  if (!main) {
    return { pageJsx: convertHtmlFragmentToJsx(bodyHtml, 2), sections: [] };
  }

  // Descend to the real section container. Framer nests the page in wrapper
  // divs and a breakpoint container that holds nearly all the markup, so we
  // follow single children and dominant (>70% size, ≥2 children) children.
  const elChildrenOf = (el: Element) =>
    el.children
      .filter(isElement)
      .filter((c) => c.name !== "script" && c.name !== "style");
  const sizeOf = (el: Element) => $.html(el)?.length ?? 0;

  const wrapperChain: Element[] = [];
  let container = main;
  for (let depth = 0; depth < 8; depth++) {
    const kids = elChildrenOf(container);
    if (kids.length === 0) break;
    if (kids.length === 1) {
      wrapperChain.push(container);
      container = kids[0];
      continue;
    }
    const largest = kids.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a));
    const dominant =
      kids.length <= 4 &&
      sizeOf(largest) > 0.7 * sizeOf(container) &&
      elChildrenOf(largest).length >= 2;
    if (dominant) {
      wrapperChain.push(container);
      container = largest;
      continue;
    }
    break;
  }
  wrapperChain.push(container);

  const sectionRoots = elChildrenOf(container);

  // Not enough structure to split - single Content component
  if (sectionRoots.length < 2) {
    const jsx = convertHtmlFragmentToJsx(bodyHtml, 2);
    return {
      pageJsx: "      <PageContent />\n",
      sections: [{ name: "PageContent", kind: "section", html: bodyHtml, jsx }],
    };
  }

  const used = new Set<string>();
  const sections: JsxSection[] = [];
  // child element → component reference or inline JSX
  const childRender = new Map<Element, string>();

  sectionRoots.forEach((el, i) => {
    const html = $.html(el) ?? "";
    const tag = el.name.toLowerCase();
    const alwaysExtract = tag === "header" || tag === "nav" || tag === "footer";
    if (html.length < MIN_SECTION_HTML && !alwaysExtract) {
      childRender.set(el, convertHtmlFragmentToJsx(html, 0));
      return;
    }
    const { name, kind } = sectionName($, el, i, used);
    const jsx = convertHtmlFragmentToJsx(html, 2);
    sections.push({ name, kind, html, jsx });
    childRender.set(el, `<${name} />\n`);
  });

  // Rebuild page JSX: wrappers (as JSX) with section refs inside. Wrapper
  // siblings (overlays, svg templates, …) and non-main top-level nodes stay inline.
  const renderWrapper = (idx: number, depth: number): string => {
    const el = wrapperChain[idx];
    const next = wrapperChain[idx + 1];
    const pad = "  ".repeat(depth);
    const attrs = serializeAttrs(el, false);
    let inner = "";
    for (const child of el.children) {
      if (next && child === next) {
        inner += renderWrapper(idx + 1, depth + 1);
      } else if (isElement(child) && childRender.has(child)) {
        const rendered = childRender.get(child)!;
        inner +=
          rendered
            .split("\n")
            .filter(Boolean)
            .map((l) =>
              l.startsWith("<") || l.startsWith("{")
                ? "  ".repeat(depth + 1) + l
                : l,
            )
            .join("\n") + "\n";
      } else {
        inner += serializeNode(child, false, depth + 1);
      }
    }
    return `${pad}<${el.name}${attrs}>\n${inner}${pad}</${el.name}>\n`;
  };

  let pageJsx = renderWrapper(0, 3);
  for (const el of topElements) {
    if (el === main) continue;
    pageJsx += serializeNode(el, false, 3);
  }

  return { pageJsx, sections };
}

/** Wrap section JSX in a component file. */
export function sectionComponentSource(section: JsxSection): string {
  return `export default function ${section.name}() {
  return (
    <>
${section.jsx.replace(/\s+$/, "")}
    </>
  );
}
`;
}

/** Stable content hash for cross-page component dedup. */
export function sectionContentKey(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}
