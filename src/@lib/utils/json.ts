/**
 * Cleans a JSON string by removing problematic special characters and escape sequences
 * @param {string} jsonString - The raw JSON string to clean
 * @param {Object} options - Configuration options
 * @param {boolean} options.preserveQuotes - Keep quotes within string values (default: true)
 * @param {boolean} options.fixUnicode - Convert Unicode escape sequences to actual characters (default: true)
 * @param {boolean} options.removeControlChars - Remove control characters (default: true)
 * @param {boolean} options.normalizeWhitespace - Normalize whitespace (default: true)
 * @returns {string} Cleaned JSON string
 */
function cleanJsonString(jsonString: string, options = {}) {
  const {
    preserveQuotes = true,
    fixUnicode = true,
    removeControlChars = true,
    normalizeWhitespace = true,
  }: any = options;

  if (typeof jsonString !== "string") {
    return jsonString;
  }

  let cleaned = jsonString;

  // 1. Remove BOM (Byte Order Mark) if present
  cleaned = cleaned.replace(/^\uFEFF/, "");

  if (fixUnicode) {
    // 2. Fix common Unicode escape sequences
    cleaned = cleaned
      .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (match, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
  }

  if (removeControlChars) {
    // 3. Remove control characters (except \n, \r, \t)
    cleaned = cleaned.replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      "",
    );
  }

  if (normalizeWhitespace) {
    // 4. Normalize line endings
    cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // 5. Remove extra whitespace around JSON (but preserve within strings)
    cleaned = cleaned.trim();
  }

  if (!preserveQuotes) {
    // 6. Fix common quote issues (only if preserveQuotes is false)
    cleaned = cleaned
      .replace(/([^\\])'/g, '$1"') // Replace single quotes with double (unless escaped)
      .replace(/^'|'$/g, '"') // Replace leading/trailing single quotes
      .replace(/\\'/g, "'"); // Unescape escaped single quotes
  }

  // 7. Fix common escape sequences
  cleaned = cleaned
    .replace(/\\"/g, '"') // Unescape double quotes
    .replace(/\\n/g, "\n") // Convert \n to actual newline
    .replace(/\\r/g, "\r") // Convert \r to actual carriage return
    .replace(/\\t/g, "\t") // Convert \t to actual tab
    .replace(/\\f/g, "\f") // Convert \f to actual form feed
    .replace(/\\b/g, "\b") // Convert \b to actual backspace
    .replace(/\\\\/g, "\\"); // Unescape backslashes

  // 8. Fix common malformed JSON patterns
  cleaned = cleaned
    .replace(/,(\s*[}\]])/g, "$1") // Remove trailing commas before closing braces/brackets
    .replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3') // Add quotes to unquoted property names
    .replace(/:\s*undefined/g, ": null") // Replace undefined with null
    .replace(/(?<!\\)\/\*[\s\S]*?\*\//g, "") // Remove block comments
    .replace(/(?<!\\)\/\/.*$/gm, ""); // Remove line comments

  return cleaned;
}

/**
 * Detects and removes common JSON string prefixes/suffixes
 * @param {string} str - String that might contain JSON
 * @returns {string} Extracted JSON portion
 */
function extractJsonFromString(str: any) {
  if (typeof str !== "string") return str;

  // Remove common wrapper patterns
  const patterns = [
    /^.*?(\{.*\}).*?$/s, // JSON object in middle of string
    /^.*?(\[.*\]).*?$/s, // JSON array in middle of string
    /^```json\s*([\s\S]*?)\s*```$/i, // Markdown code block
    /^`([\s\S]*?)`$/, // Backtick wrapper
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return str.trim();
}

// Combined utility function
export function cleanAndParseJson(input: any, options = {}) {
  const extracted = extractJsonFromString(input);
  const cleaned = cleanJsonString(extracted, options);

  try {
    return {
      success: true,
      data: JSON.parse(cleaned),
      cleanedString: cleaned,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      cleanedString: cleaned,
      originalInput: input,
    };
  }
}

/**
 * Recursively flattens a nested JavaScript object or array into a single-level object with dot-notation and bracket-notation keys.
 *
 * Nested object properties are concatenated using dot notation (e.g. `user.address.city`),
 * while array elements are indexed using bracket notation (e.g. `items[0].name`).
 * Empty objects or arrays are preserved as empty structure values.
 *
 * @param {any} data - The target object or array to flatten.
 * @returns {Record<string, any>} A flattened single-level key-value map.
 *
 * @example
 * flatten({ user: { name: "Alice" }, items: [{ id: 1 }] })
 * // Returns: { "user.name": "Alice", "items[0].id": 1 }
 */
export function flatten(data: any) {
  var result: any = {};
  function recurse(cur: any, prop: any) {
    if (Object(cur) !== cur) {
      result[prop] = cur;
    } else if (Array.isArray(cur)) {
      for (var i = 0, l = cur.length; i < l; i++)
        recurse(cur[i], prop + "[" + i + "]");
      if (l == 0) result[prop] = [];
    } else {
      var isEmpty = true;
      for (var p in cur) {
        isEmpty = false;
        recurse(cur[p], prop ? prop + "." + p : p);
      }
      if (isEmpty && prop) result[prop] = {};
    }
  }
  recurse(data, "");
  return result;
}
