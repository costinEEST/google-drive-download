export function sanitize(filename) {
  const blacklist = ["\\", "/", ":", "*", "?", '"', "<", ">", "|", "\0"];
  const reserved = ["CON", "PRN", "AUX", "NUL", "COM1"];

  // Decode HTML entities (like Python's unescape)
  filename = decodeURIComponent(filename);

  // Remove blacklisted characters
  filename = filename
    .split("")
    .filter((c) => !blacklist.includes(c))
    .join("");

  // Remove control characters (ASCII < 32)
  filename = filename
    .split("")
    .filter((c) => c.charCodeAt(0) > 31)
    .join("");

  // Trim dots and spaces
  filename = filename.replace(/[. ]+$/, "").trim();

  // Handle edge cases
  if (filename.split("").every((c) => c === ".")) filename = "_" + filename;
  if (reserved.includes(filename.toUpperCase())) filename = "_" + filename;
  if (!filename) filename = "_";

  // Handle length limits (255 chars)
  if (filename.length > 255) {
    const parts = filename.split(".");
    let ext = "";
    if (parts.length > 1) {
      ext = "." + parts.pop();
      filename = filename.slice(0, -ext.length);
    }
    filename = filename.slice(0, 255 - ext.length) + ext;
  }

  return filename;
}

export function urlToId(url) {
  const ID_PATTERNS = [
    /\/file\/d\/([0-9A-Za-z_-]{10,})(?:\/|$)/i,
    /\/folders\/([0-9A-Za-z_-]{10,})(?:\/|$)/i,
    /id=([0-9A-Za-z_-]{10,})(?:&|$)/i,
    /([0-9A-Za-z_-]{10,})/i,
  ];

  for (const pattern of ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function parseModifiedTime(modified) {
  if (!modified) return null;

  try {
    const now = new Date();
    let date;

    if (modified.includes(":")) {
      // Time format: "3:45 PM"
      const [hour, minutePart] = modified.toLowerCase().split(":");
      let hours = parseInt(hour);
      const minutes = parseInt(minutePart);

      if (minutePart.includes("pm") && hours !== 12) hours += 12;
      if (minutePart.includes("am") && hours === 12) hours = 0;

      date = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          hours + 7,
          minutes
        )
      );
    } else if (modified.includes("/")) {
      // Date format: "12/25/23"
      const [month, day, year] = modified.split("/");
      date = new Date(
        2000 + parseInt(year),
        parseInt(month) - 1,
        parseInt(day)
      );
    } else {
      // Month day format: "Dec 25"
      date = new Date(modified + " " + now.getFullYear());
    }

    return Math.floor(date.getTime() / 1000);
  } catch (error) {
    return null;
  }
}
