import React, { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';

export default function VisualTable({ text }) {
  const [render, setRender] = useState(null);
  useEffect(() => {
    let active = true;
    import('../study-math-render.js').then(module => { if (active) setRender(() => module.renderStudyFormula); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const html = useMemo(() => {
    const clean = DOMPurify.sanitize(text, { ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'td', 'th', 'eq'], ALLOWED_ATTR: ['rowspan', 'colspan'] });
    const parsed = new DOMParser().parseFromString(clean, 'text/html');
    for (const equation of parsed.querySelectorAll('eq')) {
      const math = render?.(equation.textContent, false), element = parsed.createElement('span');
      if (math) element.innerHTML = math; else element.textContent = equation.textContent;
      equation.replaceWith(element);
    }
    return parsed.body.innerHTML;
  }, [text, render]);
  return <div className="scanned-table source-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
