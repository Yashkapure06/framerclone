import { htmlToJsx } from "./htmlToJsx";

export interface HtmlSection {
  name: string;
  code: string;
  type: "faq" | "tabs" | "modal" | "dropdown" | "accordion" | "static";
  originalHtml: string;
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

function extractFaqItems(html: string): { question: string; answer: string; questionHtml: string; answerHtml: string }[] {
  const items: { question: string; answer: string; questionHtml: string; answerHtml: string }[] = [];
  
  const patterns = [
    /<div[^>]*class=["'][^"']*faq[-_]?item[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
    /<li[^>]*class=["'][^"']*faq[-_]?item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /<details[^>]*class=["'][^"']*faq[^"']*["'][^>]*>([\s\S]*?)<\/details>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const content = match[1];
      const qMatch = content.match(/<(?:button|h\d|summary)[^>]*class=["'][^"']*faq[-_]?(?:question|header|title)[^"']*["'][^>]*>([\s\S]*?)<\/(?:button|h\d|summary)>/i);
      const qBtnMatch = content.match(/<(?:button|h\d)[^>]*>([\s\S]*?)<\/(?:button|h\d)>/i);
      const question = qMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || qBtnMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
      
      const aMatch = content.match(/<div[^>]*class=["'][^"']*faq[-_]?(?:answer|content|body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      const answerContent = aMatch?.[1]?.trim() || content.replace(/<(?:button|h\d|summary)[^>]*>[\s\S]*?<\/(?:button|h\d|summary)>/gi, "").trim();
      
      if (question && answerContent && answerContent.length > 10) {
        items.push({ question, answer: answerContent, questionHtml: qMatch?.[0] || "", answerHtml: aMatch?.[0] || "" });
      }
    }
  }

  if (items.length === 0) {
    const qaPattern = /<(?:button|h\d)[^>]*>([^<]*(?:what|how|why|when|where|is|are|can|do|does)[^<]*)<\/\2>[\s\S]*?<div[^>]*>([\s\S]{50,2000})<\//gi;
    for (const match of html.matchAll(qaPattern)) {
      items.push({ question: match[1].trim(), answer: match[2].trim(), questionHtml: "", answerHtml: "" });
    }
  }

  return items.slice(0, 20);
}

function extractTabs(html: string): { label: string; content: string }[] {
  const tabs: { label: string; content: string }[] = [];
  
  const btnPattern = /<(?:button|a)[^>]*class=["'][^"']*(?:tab[-_]?(?:btn|item|title)|nav[-_]?tab)[^"']*["'][^>]*class=["'][^"']*active["'][^>]*>([\s\S]*?)<\/(?:button|a)>/gi;
  for (const match of html.matchAll(btnPattern)) {
    const label = match[1].replace(/<[^>]+>/g, "").trim();
    if (label && label.length < 50) tabs.push({ label, content: "" });
  }

  return tabs.slice(0, 10);
}

function extractAccordionSections(html: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  
  const patterns = [
    /<div[^>]*class=["'][^"']*(?:accordion[-_]?item|collapsible[-_]?item|toggle[-_]?item)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
    /<details[^>]*class=["'][^"']*(?:accordion|collapsible|toggle)[^"']*["'][^>]*>([\s\S]*?)<\/details>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const content = match[1];
      const titleMatch = content.match(/<(?:button|h\d|summary)[^>]*>([\s\S]*?)<\/(?:button|h\d|summary)>/i);
      const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
      const bodyMatch = content.match(/<div[^>]*class=["'][^"']*(?:accordion[-_]?(?:content|body)|content|body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      const body = bodyMatch?.[1]?.trim() || content.replace(/<(?:button|h\d|summary)[^>]*>[\s\S]*?<\/(?:button|h\d|summary)>/gi, "").trim();
      
      if (title && body && body.length > 10) {
        sections.push({ title, content: body });
      }
    }
  }

  return sections.slice(0, 15);
}

function detectInteractivePatterns(html: string): HtmlSection[] {
  const sections: HtmlSection[] = [];

  const faqItems = extractFaqItems(html);
  if (faqItems.length >= 2) {
    const faqCode = `import { useState } from 'react';

export default function FaqSection() {
  return (
    <div className="faq-section">
      <h2>Frequently Asked Questions</h2>
      ${faqItems.map((item, i) => `
      <FaqItem key={${i}} question="${item.question}" answer="${item.answer.replace(/"/g, '\\"').slice(0, 200)}${item.answer.length > 200 ? '...' : ''}" />
      `).join("\n")}
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-item">
      <button className="faq-question" onClick={() => setOpen(!open)}>
        {question}
        <span className={"faq-icon"}>{open ? "−" : "+"}</span>
      </button>
      {open && <div className="faq-answer">{answer}</div>}
    </div>
  );
}
`;
    sections.push({ name: "FaqSection", code: faqCode, type: "faq", originalHtml: faqItems.map(i => i.questionHtml + i.answerHtml).join("") });
  }

  const accordionSections = extractAccordionSections(html);
  if (accordionSections.length >= 2) {
    const accCode = `import { useState } from 'react';

export default function AccordionSection() {
  return (
    <div className="accordion-section">
      ${accordionSections.map((item, i) => `
      <AccordionItem key={${i}} title="${item.title}" />
      `).join("\n")}
    </div>
  );
}

function AccordionItem({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="accordion-item">
      <button className="accordion-header" onClick={() => setOpen(!open)}>
        {title}
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && <div className="accordion-content">{title}</div>}
    </div>
  );
}
`;
    sections.push({ name: "AccordionSection", code: accCode, type: "accordion", originalHtml: accordionSections.map(s => s.content).join("") });
  }

  return sections;
}

export function convertHtmlToReactSections(html: string, pageName: string, assetMap: Record<string, string>): HtmlSection[] {
  const interactive = detectInteractivePatterns(html);
  if (interactive.length > 0) {
    return interactive;
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch?.[1] || html;

  const jsx = htmlToJsx(bodyHtml);

  const sectionCode = `import React from 'react';

export default function ${toPascalCase(pageName)}Content() {
  return (
    <div className="${toPascalCase(pageName).toLowerCase()}-content">
      ${jsx}
    </div>
  );
}
`;

  return [{
    name: `${toPascalCase(pageName)}Content`,
    code: sectionCode,
    type: "static",
    originalHtml: bodyHtml,
  }];
}

export function extractInteractiveElements(html: string): {
  faqs: { question: string; answer: string }[];
  tabs: { label: string; content: string }[];
  accordions: { title: string; content: string }[];
} {
  return {
    faqs: extractFaqItems(html),
    tabs: extractTabs(html),
    accordions: extractAccordionSections(html),
  };
}