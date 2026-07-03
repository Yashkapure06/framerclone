import { generateTextWithFallback } from "./ai-provider";

const MAX_HTML_CHARS = 12000;

export interface AiGeneratedSection {
  name: string;
  code: string;
}

export interface AiGeneratedPage {
  sections: AiGeneratedSection[];
  provider: string;
  tried: Array<{ provider: string; ok: boolean; error?: string }>;
}

function truncateAtTagBoundary(html: string, maxChars: number): string {
  if (html.length <= maxChars) return html;
  const cut = html.lastIndexOf("<", maxChars);
  const sliceAt = cut > maxChars * 0.85 ? cut : maxChars;
  return html.slice(0, sliceAt) + "\n<!-- truncated -->";
}

function buildAssetMapLines(assetMap: Record<string, string>, max = 20): string {
  const entries = Object.entries(assetMap).slice(0, max);
  if (!entries.length) return "(none)";
  return entries.map(([k, v]) => `  ${k} → ${v}`).join("\n");
}

function buildPrompt(
  bodyHtml: string,
  pageName: string,
  assetMap: Record<string, string>,
): string {
  return `Convert this website HTML body into interactive React functional components WITH PROPER STATE MANAGEMENT.

PAGE: ${pageName}
SECTIONS: Identify 3–6 logical sections (e.g. SiteHeader, HeroSection, FeaturesSection, SiteFooter).

## CRITICAL: Generate REAL React Components, not dangerouslySetInnerHTML

### INTERACTIVE ELEMENTS — These MUST use React state:

1. **FAQ / Accordion** (collapsible questions):
   Convert this HTML pattern:
   \`\`\`html
   <div class="faq-item">
     <button class="faq-question">What is your question?</button>
     <div class="faq-answer">Answer content here</div>
   </div>
   \`\`\`
   Into this React component:
   \`\`\`jsx
   export function FaqItem({ question, children }) {
     const [open, setOpen] = useState(false);
     return (
       <div className="faq-item">
         <button className="faq-question" onClick={() => setOpen(!open)}>
           {question}
           <span className={open ? 'rotated' : ''}>▼</span>
         </button>
         {open && <div className="faq-answer">{children}</div>}
       </div>
     );
   }
   \`\`\`

2. **Tabs** (tabbed content):
   \`\`\`jsx
   export function Tabs({ tabs }) {
     const [activeTab, setActiveTab] = useState(0);
     return (
       <div className="tabs">
         <div className="tab-buttons">
           {tabs.map((tab, i) => (
             <button key={i} className={i === activeTab ? 'active' : ''} onClick={() => setActiveTab(i)}>
               {tab.label}
             </button>
           ))}
         </div>
         <div className="tab-content">{tabs[activeTab]?.content}</div>
       </div>
     );
   }
   \`\`\`

3. **Modal/Dialog**:
   \`\`\`jsx
   export function Modal({ isOpen, onClose, children }) {
     if (!isOpen) return null;
     return (
       <div className="modal-overlay" onClick={onClose}>
         <div className="modal-content" onClick={e => e.stopPropagation()}>
           <button className="modal-close" onClick={onClose}>×</button>
           {children}
         </div>
       </div>
     );
   }
   \`\`\`

4. **Expandable/Collapsible sections**:
   \`\`\`jsx
   export function Expandable({ title, children }) {
     const [expanded, setExpanded] = useState(false);
     return (
       <div className="expandable">
         <button onClick={() => setExpanded(!expanded)}>
           {title} {expanded ? '−' : '+'}
         </button>
         {expanded && <div className="content">{children}</div>}
       </div>
     );
   }
   \`\`\`

5. **Nav Dropdown menus**:
   \`\`\`jsx
   export function Dropdown({ label, items }) {
     const [open, setOpen] = useState(false);
     return (
       <div className="dropdown" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
         <button>{label}</button>
         {open && <div className="dropdown-menu">
           {items.map((item, i) => <a key={i} href={item.href}>{item.label}</a>)}
         </div>}
       </div>
     );
   }
   \`\`\`

### CONVERSION RULES:
- class= → className=
- Convert onclick/onchange handlers to onClick={fn}/onChange={fn}
- Replace <details><summary> with useState accordion
- <a href> → <Link to> for internal routes, keep <a href> for external
- Self-close: <img />, <br />, <hr />, <input />
- style="a: b" → style={{a: 'b'}} (camelCase)
- Keep commas/calc()/var() as strings: style={{background: 'linear-gradient(...)'}}
- Remove <script> tags entirely
- Preserve ALL class names, data-*, aria-*, id attributes
- Preserve data-framer-* attributes for Framer sites

### URL REPLACEMENTS:
${buildAssetMapLines(assetMap)}

### HTML TO CONVERT:
${truncateAtTagBoundary(bodyHtml, MAX_HTML_CHARS)}`;
}

/**
 * Parse markdown response: find all "# ComponentName" followed by ```jsx ... ``` blocks.
 * Handles proper React components with useState, useEffect, etc.
 */
function parseMarkdownComponents(text: string): AiGeneratedSection[] {
  const sections: AiGeneratedSection[] = [];
  const pattern = /^#\s+([A-Za-z][A-Za-z0-9]*)\s*\n```(?:[jt]sx?|javascript|typescript)?\s*\n([\s\S]*?)```/gm;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].trim();
    let code = match[2].trim();
    if (name && code.length > 20) {
      code = ensureImports(code);
      if (code.includes('data-framer-') || code.includes('fm-')) {
        code = fixFramerOpacity(code);
      }
      sections.push({ name, code });
    }
  }
  return sections;
}

function ensureImports(code: string): string {
  let imports = '';
  if (/useState|useEffect|useRef|useCallback|useMemo/.test(code)) {
    imports += "import { useState, useEffect, useRef } from 'react';\n";
  }
  if (/^import\s+React\b/m.test(code)) {
    return imports ? code.replace(/^import\s+React\b.*?;?\n/, '') : `import React from 'react';\n${code}`;
  }
  return imports + code;
}

function fixFramerOpacity(code: string): string {
  if (code.includes('opacity') || !code.includes('data-framer')) return code;
  return code + '\n<style>{\'[data-framer-] { opacity: 1 !important; }\'}</style>';
}

/**
 * Fallback: some models output without language tag or use different heading levels.
 * Try ## and ### as well, and bare ``` blocks.
 */
function parseMarkdownComponentsFallback(text: string): AiGeneratedSection[] {
  const sections: AiGeneratedSection[] = [];
  const pattern = /^#{1,3}\s+([A-Za-z][A-Za-z0-9]*)\s*\n```[^\n]*\n([\s\S]*?)```/gm;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].trim();
    const code = match[2].trim();
    if (name && code.length > 20 && !sections.find((s) => s.name === name)) {
      sections.push({ name, code });
    }
  }
  return sections;
}

export async function generateAiReactPage(
  bodyHtml: string,
  pageName: string,
  assetMap: Record<string, string>,
): Promise<AiGeneratedPage | null> {
  try {
    const prompt = buildPrompt(bodyHtml, pageName, assetMap);
    const result = await generateTextWithFallback({
      messages: [
        {
          role: "system",
          content:
            "You are an expert React developer. Convert HTML to clean React JSX components WITH STATE MANAGEMENT. Generate REAL interactive components — use useState for FAQs, tabs, modals, accordions, dropdowns. Do NOT use dangerouslySetInnerHTML. Output only the markdown format requested — component name as a # heading, then a ```jsx code block. Include useState/useEffect imports as needed.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 12000,
    });

    let sections = parseMarkdownComponents(result.text);
    if (sections.length === 0) {
      sections = parseMarkdownComponentsFallback(result.text);
    }
    if (sections.length === 0) return null;

    return { sections, provider: result.provider, tried: result.tried };
  } catch {
    return null;
  }
}

/** Ensure component code has a React import if missing */
export function ensureReactImport(code: string): string {
  if (/^import\s+React\b/m.test(code)) return code;
  return `import React from 'react';\n${code}`;
}
