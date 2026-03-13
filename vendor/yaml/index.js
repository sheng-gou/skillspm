export function parse(source) {
  const lines = String(source)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((rawLine) => {
      const withoutComment = rawLine.trimStart().startsWith("#") ? "" : rawLine;
      return {
        raw: withoutComment,
        indent: withoutComment.match(/^ */)[0].length,
        content: withoutComment.trim()
      };
    })
    .filter((line) => line.content.length > 0);

  let index = 0;
  return parseBlock(0);

  function parseBlock(indent) {
    if (index >= lines.length) {
      return {};
    }
    return lines[index].content.startsWith("- ") ? parseArray(indent) : parseObject(indent);
  }

  function parseObject(indent) {
    const result = {};
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) {
        break;
      }
      if (line.indent > indent) {
        throw new Error(`Invalid indentation near "${line.raw.trim()}"`);
      }
      if (line.content.startsWith("- ")) {
        break;
      }
      const split = splitKeyValue(line.content);
      if (!split) {
        throw new Error(`Invalid mapping line "${line.raw.trim()}"`);
      }
      index += 1;
      if (split.valueText === "") {
        if (index < lines.length && lines[index].indent > indent) {
          result[split.key] = parseBlock(lines[index].indent);
        } else {
          result[split.key] = null;
        }
      } else {
        result[split.key] = parseScalar(split.valueText);
      }
    }
    return result;
  }

  function parseArray(indent) {
    const result = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) {
        break;
      }
      if (line.indent > indent || !line.content.startsWith("- ")) {
        throw new Error(`Invalid list indentation near "${line.raw.trim()}"`);
      }
      const itemText = line.content.slice(2);
      index += 1;
      if (itemText === "") {
        result.push(index < lines.length && lines[index].indent > indent ? parseBlock(lines[index].indent) : null);
        continue;
      }

      const inlineObject = splitKeyValue(itemText);
      if (inlineObject) {
        const item = {};
        item[inlineObject.key] = inlineObject.valueText === "" ? null : parseScalar(inlineObject.valueText);
        if (index < lines.length && lines[index].indent > indent) {
          const nested = parseBlock(lines[index].indent);
          if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            Object.assign(item, nested);
          }
        }
        result.push(item);
        continue;
      }

      result.push(parseScalar(itemText));
    }
    return result;
  }
}

export function stringify(value, options = {}) {
  const indentSize = options.indent ?? 2;
  const lines = emit(value, 0);
  return `${lines.join("\n")}\n`;

  function emit(current, depth) {
    if (Array.isArray(current)) {
      if (current.length === 0) {
        return ["[]"];
      }
      return current.flatMap((item) => emitArrayItem(item, depth));
    }
    if (current && typeof current === "object") {
      const entries = Object.entries(current);
      if (entries.length === 0) {
        return ["{}"];
      }
      return entries.flatMap(([key, entryValue]) => emitObjectEntry(key, entryValue, depth));
    }
    return [formatScalar(current)];
  }

  function emitObjectEntry(key, entryValue, depth) {
    const prefix = " ".repeat(depth * indentSize);
    if (Array.isArray(entryValue)) {
      if (entryValue.length === 0) {
        return [`${prefix}${key}: []`];
      }
      return [`${prefix}${key}:`, ...entryValue.flatMap((item) => emitArrayItem(item, depth + 1))];
    }
    if (entryValue && typeof entryValue === "object") {
      if (Object.keys(entryValue).length === 0) {
        return [`${prefix}${key}: {}`];
      }
      const nested = emit(entryValue, depth + 1);
      return [`${prefix}${key}:`, ...nested];
    }
    return [`${prefix}${key}: ${formatScalar(entryValue)}`];
  }

  function emitArrayItem(item, depth) {
    const prefix = " ".repeat(depth * indentSize);
    if (Array.isArray(item)) {
      if (item.length === 0) {
        return [`${prefix}- []`];
      }
      const nested = item.flatMap((entry) => emitArrayItem(entry, depth + 1));
      const [first, ...rest] = nested;
      return [`${prefix}- ${first.trimStart()}`, ...rest];
    }
    if (item && typeof item === "object") {
      const entries = Object.entries(item);
      if (entries.length === 0) {
        return [`${prefix}- {}`];
      }
      const [firstKey, firstValue] = entries[0];
      const firstBlock = emitObjectEntry(firstKey, firstValue, depth + 1);
      const firstLine = `${prefix}- ${firstBlock[0].trimStart()}`;
      const remaining = [
        ...firstBlock.slice(1),
        ...entries.slice(1).flatMap(([key, value]) => emitObjectEntry(key, value, depth + 1))
      ];
      return [firstLine, ...remaining];
    }
    return [`${prefix}- ${formatScalar(item)}`];
  }
}

function splitKeyValue(text) {
  const match = /^([^:]+):(.*)$/.exec(text);
  if (!match) {
    return null;
  }
  return {
    key: match[1].trim(),
    valueText: match[2].trim()
  };
}

function parseScalar(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (value === "[]") {
    return [];
  }
  if (value === "{}") {
    return {};
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function formatScalar(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const stringValue = String(value);
  if (stringValue === "" || /^(?:-|\?|\{|}|\[|\]|#|!|&|\*|\s)/.test(stringValue) || /\s$/.test(stringValue)) {
    return JSON.stringify(stringValue);
  }
  return stringValue;
}
