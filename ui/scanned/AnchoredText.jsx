import React from 'react';
import Markdown from '../Markdown.jsx';
import { useInjectCss } from '../shared.js';

/** Math glyph offsets are not OCR offsets. Selectable prose retains exact ranges. */
export default function AnchoredText({ block, pageText, heading = false, inline = false, prefix, suffix }) {
  useInjectCss('.reading-inline-math>.md,.reading-inline-math>.md>p{display:inline;margin:0}', 'study-reading-inline-math');
  const text = block.text, start = block.textRange.start, parts = [];
  let offset = 0;
  for (const match of text.matchAll(/\$\$[\s\S]+?\$\$|(?<!\\)\$[^\n$]+?\$/g)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index), start: offset });
    parts.push({ text: match[0], math: true }); offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), start: offset });
  return <div style={{ display: inline ? 'inline' : undefined, whiteSpace: 'pre-wrap', lineHeight: 'var(--reader-line-height, 1.8)', fontSize: 'inherit', fontWeight: heading ? 700 : undefined }}>
    {parts.map((part, index) => part.math ? <span key={index} data-study-marker="true" className="reading-inline-math"><Markdown text={part.text} /></span>
      : <span key={index} data-study-text="true" data-study-anchor-start={start + part.start} data-study-anchor-end={start + part.start + part.text.length}
        data-study-prefix={pageText ? pageText.slice(Math.max(0, start + part.start - 80), start + part.start) : `${prefix || ''}${text.slice(0, part.start)}`.slice(-80)}
        data-study-suffix={pageText ? pageText.slice(start + part.start + part.text.length, start + part.start + part.text.length + 80) : `${text.slice(part.start + part.text.length)}${suffix || ''}`.slice(0, 80)}>{part.text}</span>)}
  </div>;
}
