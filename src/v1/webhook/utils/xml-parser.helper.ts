/**
 * Lightweight XML to JSON Parser Helper for inbound webhook payloads.
 */

export function isXmlPayload(content: string): boolean {
  if (!content || typeof content !== "string") return false;
  const trimmed = content.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">");
}

/**
 * Parses an XML string into a JavaScript object.
 */
export function parseXmlToJson(xml: string): Record<string, any> {
  if (!xml || typeof xml !== "string") {
    return {};
  }

  // Strip XML declaration, comments, and DOCTYPE
  const cleanXml = xml
    .replace(/<\?[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .trim();

  if (!cleanXml) {
    return { _rawXml: xml };
  }

  function parseNode(xmlStr: string): any {
    const trimmed = xmlStr.trim();
    if (!trimmed.startsWith("<")) {
      return decodeXmlEntities(trimmed);
    }

    const result: Record<string, any> = {};
    const tagRegex =
      /<([a-zA-Z0-9_\-:]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9_\-:]+)([^>]*)\/>/g;
    let match: RegExpExecArray | null;
    let hasMatches = false;

    while ((match = tagRegex.exec(trimmed)) !== null) {
      hasMatches = true;
      const tagName = match[1] || match[4];
      const innerContent = match[3] !== undefined ? match[3] : "";

      let parsedValue: any;
      if (match[3] === undefined) {
        parsedValue = true;
      } else if (innerContent.includes("<")) {
        parsedValue = parseNode(innerContent);
      } else {
        parsedValue = decodeXmlEntities(innerContent.trim());
      }

      if (result[tagName] !== undefined) {
        if (!Array.isArray(result[tagName])) {
          result[tagName] = [result[tagName]];
        }
        result[tagName].push(parsedValue);
      } else {
        result[tagName] = parsedValue;
      }
    }

    if (!hasMatches) {
      return decodeXmlEntities(trimmed);
    }

    return result;
  }

  try {
    const parsed = parseNode(cleanXml);
    if (typeof parsed === "object" && parsed !== null) {
      parsed._rawXml = xml;
      return parsed;
    }
    return { _rawXml: xml, value: parsed };
  } catch {
    return { _rawXml: xml };
  }
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
