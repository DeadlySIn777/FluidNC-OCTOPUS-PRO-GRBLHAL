// Browser-only synchronous subset adapted from cncjs/gcode-parser 2.2.0 (MIT).
const LINE_MODES = ["original", "stripped", "compact"];
const WORD_PATTERN = /(%.*)|({.*)|((?:\$\$)|(?:\$[a-zA-Z0-9#]*))|([a-zA-Z][0-9+\-.]+)|(\*[0-9]+)/gim;

function computeChecksum(source) {
  const checksumSource = source.lastIndexOf("*") >= 0
    ? source.slice(0, source.lastIndexOf("*"))
    : source;
  let checksum = 0;
  for (let index = 0; index < checksumSource.length; index += 1) {
    checksum ^= checksumSource.charCodeAt(index);
  }
  return checksum;
}

function stripComments(source) {
  let result = "";
  let currentComment = "";
  const comments = [];
  let openParens = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === ";" && openParens === 0) {
      comments.push(source.slice(index + 1).trim());
      break;
    }
    if (character === "(") {
      if (openParens === 0) currentComment = "";
      else currentComment += character;
      openParens = Math.min(openParens + 1, Number.MAX_SAFE_INTEGER);
    } else if (character === ")") {
      openParens = Math.max(0, openParens - 1);
      if (openParens === 0) {
        comments.push(currentComment.trim());
        currentComment = "";
      } else {
        currentComment += character;
      }
    } else if (openParens > 0) {
      currentComment += character;
    } else {
      result += character;
    }
  }

  return [result.trim(), comments];
}

export function parseLine(source, options = {}) {
  const originalLine = String(source ?? "");
  const [strippedLine, comments] = stripComments(originalLine);
  const compactLine = strippedLine.replace(/\s+/g, "");
  const lineMode = LINE_MODES.includes(options.lineMode) ? options.lineMode : "original";
  const result = {
    line: lineMode === "compact"
      ? compactLine
      : lineMode === "stripped" ? strippedLine : originalLine,
    words: [],
  };
  const words = compactLine.match(WORD_PATTERN) ?? [];
  let lineNumber;
  let checksum;

  if (comments.length > 0) result.comments = comments;
  for (const word of words) {
    const letter = word[0].toUpperCase();
    const argument = word.slice(1);
    if (letter === "%" || letter === "{" || letter === "$") {
      result.cmds = (result.cmds ?? []).concat(letter === "$" ? `${letter}${argument}` : originalLine.trim());
      continue;
    }
    if (letter === "N" && lineNumber === undefined) {
      lineNumber = Number(argument);
      continue;
    }
    if (letter === "*" && checksum === undefined) {
      checksum = Number(argument);
      continue;
    }

    const numericValue = Number(argument);
    const value = Number.isNaN(numericValue) ? argument : numericValue;
    result.words.push(options.flatten ? `${letter}${value}` : [letter, value]);
  }

  if (lineNumber !== undefined) result.ln = lineNumber;
  if (checksum !== undefined) result.cs = checksum;
  if (result.cs && computeChecksum(originalLine) !== result.cs) result.err = true;
  return result;
}

export function parseStringSync(source, options = {}) {
  return String(source ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseLine(line, options));
}

function unsupportedBrowserParserMethod() {
  throw new Error("Only synchronous string parsing is available in the browser preview.");
}

export const parseFile = unsupportedBrowserParserMethod;
export const parseFileSync = unsupportedBrowserParserMethod;
export const parseStream = unsupportedBrowserParserMethod;
export const parseString = unsupportedBrowserParserMethod;
