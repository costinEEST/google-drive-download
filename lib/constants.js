export const ITEM_URL = (id) => `https://drive.google.com/open?id=${id}`;
export const FILE_URL = (id) =>
  `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0`;
export const FOLDER_URL = (id) =>
  `https://drive.google.com/embeddedfolderview?id=${id}#list`;
export const CHUNKSIZE = 64 * 1024;
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export const ID_PATTERNS = [
  /\/file\/d\/([0-9A-Za-z_-]{10,})(?:\/|$)/i,
  /\/folders\/([0-9A-Za-z_-]{10,})(?:\/|$)/i,
  /id=([0-9A-Za-z_-]{10,})(?:&|$)/i,
  /([0-9A-Za-z_-]{10,})/i,
];

export const FOLDER_PATTERN =
  /<a href="(https:\/\/drive\.google\.com\/.*?)".*?<div class="flip-entry-title">(.*?)<\/div>.*?<div class="flip-entry-last-modified"><div>(.*?)<\/div>/gis;

export const CONFIRM_PATTERNS = [
  /confirm=([0-9A-Za-z_-]+)/i,
  /name="confirm"\s+value="([0-9A-Za-z_-]+)"/i,
];

export const UUID_PATTERN = /name="uuid"\s+value="([0-9A-Za-z_-]+)"/i;
export const FILENAME_PATTERN = /filename="(.*?)"/i;
