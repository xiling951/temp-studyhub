/** Remove only trailing structural commas. Never change characters in strings. */
export function stripTrailingCommas(text) {
  let quoted = false, escaped = false, result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      let next = i + 1; while (/\s/.test(text[next] || '') && next < text.length) next++;
      if (text[next] === ']' || text[next] === '}') continue;
    }
    result += char;
  }
  return result;
}
