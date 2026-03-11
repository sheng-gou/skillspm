function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compare(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

function normalizeRange(range) {
  if (typeof range !== "string") {
    return null;
  }
  if (parseVersion(range)) {
    return { type: "exact", version: parseVersion(range) };
  }
  if ((range.startsWith("^") || range.startsWith("~")) && parseVersion(range.slice(1))) {
    return { type: range[0] === "^" ? "caret" : "tilde", version: parseVersion(range.slice(1)) };
  }
  return null;
}

function upperBound(range) {
  if (range.type === "exact") {
    return range.version;
  }
  if (range.type === "tilde") {
    return {
      major: range.version.major,
      minor: range.version.minor + 1,
      patch: 0
    };
  }
  if (range.version.major > 0) {
    return { major: range.version.major + 1, minor: 0, patch: 0 };
  }
  if (range.version.minor > 0) {
    return { major: 0, minor: range.version.minor + 1, patch: 0 };
  }
  return { major: 0, minor: 0, patch: range.version.patch + 1 };
}

export function valid(version) {
  return parseVersion(version) ? version : null;
}

export function clean(version) {
  return valid(version);
}

export function validRange(range) {
  return normalizeRange(range) ? range : null;
}

export function satisfies(version, range) {
  const parsedVersion = parseVersion(version);
  const parsedRange = normalizeRange(range);
  if (!parsedVersion || !parsedRange) {
    return false;
  }
  if (parsedRange.type === "exact") {
    return compare(parsedVersion, parsedRange.version) === 0;
  }
  return compare(parsedVersion, parsedRange.version) >= 0 && compare(parsedVersion, upperBound(parsedRange)) < 0;
}

export function maxSatisfying(versions, range) {
  const matches = versions.filter((version) => satisfies(version, range));
  const sorted = rsort(matches);
  return sorted[0] ?? null;
}

export function rsort(versions) {
  return [...versions].sort((left, right) => compare(parseVersion(right), parseVersion(left)));
}

const api = {
  clean,
  maxSatisfying,
  rsort,
  satisfies,
  valid,
  validRange
};

export default api;
