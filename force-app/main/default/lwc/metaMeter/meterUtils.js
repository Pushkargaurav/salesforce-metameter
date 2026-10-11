export function enrichField(field, longestValue, recordCount) {
  const declared = field.declaredSize || 0;
  const proposed = Math.max(10, Math.ceil((longestValue * 1.25) / 10) * 10);
  const canShrink = field.shrinkable && recordCount > 0 && proposed < declared;
  return {
    ...field,
    longestValue,
    utilization: declared ? longestValue / declared : null,
    suggestedSize: canShrink ? proposed : null,
    potentialSavings: canShrink ? (declared - proposed) * recordCount : 0
  };
}

export function sortRows(rows, fieldName, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[fieldName];
    const right = b[fieldName];
    // Unknown counts stay at the bottom in either direction.
    if (left == null && right == null)
      return a.apiName.localeCompare(b.apiName);
    if (left == null) return 1;
    if (right == null) return -1;
    const compared =
      typeof left === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return compared * multiplier || a.apiName.localeCompare(b.apiName);
  });
}

export function csvContent(headers, rows) {
  const escape = (value) => {
    let content = value == null ? "" : String(value);
    if (/^\s*[=+\-@]/.test(content)) content = `'${content}`;
    return `"${content.replace(/"/g, '""')}"`;
  };
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")
  );
}

export function errorMessage(error) {
  return (
    error?.body?.message ||
    error?.message ||
    "The request failed. Refresh and try again."
  );
}
