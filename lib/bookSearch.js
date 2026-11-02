'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PDFParse } = require('pdf-parse');

const BOOKS_DIR = path.join(__dirname, '..', 'books');
const MAX_CHUNK_CHARS = 1500;
const OVERLAP_CHARS = 180;
let index = [];
let lastIndexReport = { books: 0, pages: 0, chunks: 0, unreadable: [] };

function normalizeArabic(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'ما','ماذا','متى','اين','كيف','هل','هو','هي','هم','هن','هذا','هذه','ذلك','تلك',
  'من','الى','عن','على','في','مع','بين','ثم','او','و','ف','ب','ل','الذي','التي',
  'اشرح','شرح','وضح','اذكر','عدد','عرف','ماهو','شنو','ليش','اريد','ممكن','السؤال',
  'الجواب','حل','سؤال','اجب','فسر','علل','قارن','استنتج','بين'
]);

function tokens(value) {
  return normalizeArabic(value).split(' ').filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function splitPage(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= MAX_CHUNK_CHARS) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(' ', end);
      if (boundary > start + 900) end = boundary;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - OVERLAP_CHARS);
  }
  return chunks;
}

function listPdfFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...listPdfFiles(full));
    else if (item.isFile() && item.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b, 'ar'));
}

async function extractPdfPages(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ itemJoiner: ' ' });
    return (result.pages || []).map(page => page.text || '');
  } finally {
    await parser.destroy();
  }
}

async function rebuildBookIndex() {
  const files = listPdfFiles(BOOKS_DIR);
  const next = [];
  const unreadable = [];
  let pagesCount = 0;

  for (const file of files) {
    const relative = path.relative(BOOKS_DIR, file).split(path.sep).join('/');
    const title = path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').trim();
    try {
      const pages = await extractPdfPages(file);
      let extractedChars = 0;
      pages.forEach((pageText, pageIndex) => {
        if (!pageText) return;
        extractedChars += pageText.length;
        for (const chunk of splitPage(pageText)) {
          const words = tokens(chunk);
          if (!words.length) continue;
          next.push({
            book: title,
            file: relative,
            page: pageIndex + 1,
            text: chunk,
            normalized: normalizeArabic(chunk),
            words
          });
        }
      });
      pagesCount += pages.length;
      if (!extractedChars) unreadable.push(`${relative}: لا يوجد نص قابل للاستخراج (قد يكون PDF مصوراً ويحتاج OCR).`);
    } catch (error) {
      unreadable.push(`${relative}: ${error.message}`);
      console.error(`[PDF] Failed to read ${relative}:`, error.message);
    }
  }

  index = next;
  lastIndexReport = { books: files.length, pages: pagesCount, chunks: index.length, unreadable };
  console.log(`[PDF] Index ready: ${files.length} books, ${pagesCount} pages, ${index.length} searchable chunks.`);
  if (unreadable.length) console.warn('[PDF] Some books need attention:', unreadable);
  return lastIndexReport;
}

function scoreChunk(queryTokens, normalizedQuery, chunk) {
  if (!queryTokens.length) return 0;
  let score = 0;
  const counts = new Map();
  for (const word of chunk.words) counts.set(word, (counts.get(word) || 0) + 1);
  let matched = 0;
  for (const term of new Set(queryTokens)) {
    const count = counts.get(term) || 0;
    if (count) {
      matched++;
      score += 2 + Math.min(count, 3) * 0.35;
    }
  }
  const coverage = matched / new Set(queryTokens).size;
  score *= (0.35 + coverage);
  if (normalizedQuery.length >= 8 && chunk.normalized.includes(normalizedQuery)) score += 5;
  return score;
}

function searchBooks(question, limit = 5) {
  const normalizedQuery = normalizeArabic(question);
  const queryTokens = tokens(question);
  if (!queryTokens.length || !index.length) return [];
  return index
    .map(chunk => ({ ...chunk, score: scoreChunk(queryTokens, normalizedQuery, chunk) }))
    .filter(chunk => chunk.score >= 2.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function getBookIndexStatus() {
  return { ...lastIndexReport, ready: index.length > 0 };
}

module.exports = { rebuildBookIndex, searchBooks, getBookIndexStatus };
