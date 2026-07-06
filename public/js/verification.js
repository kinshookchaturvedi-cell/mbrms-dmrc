// verification.js
// Generalised version of the team's pdf-parser-4 prototype.
// Loads a PDF (or image) bill, extracts text (+ OCR fallback for scanned pages),
// then lets the rest of the app fuzzy-match user-entered field values against
// the extracted text, using an "anchor" word (e.g. "patient", "hospital") to
// narrow the search window before looking for the value nearby.
//
// Requires (loaded via CDN before this script):
//   pdf.js, fuse.js, tesseract.js

const Verifier = (() => {
  const CHUNK_SIZE = 200;

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function chunkText(text, source, page) {
    const chunks = [];
    const words = text.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      cur += (cur ? ' ' : '') + w;
      if (cur.length >= CHUNK_SIZE) { chunks.push({ text: cur.trim(), source, page }); cur = ''; }
    }
    if (cur.trim()) chunks.push({ text: cur.trim(), source, page });
    return chunks;
  }

  // Extract text+OCR chunks from a PDF File object. onProgress(pct, label) is optional.
  async function processFile(file, onProgress = () => {}) {
    const arrayBuffer = await file.arrayBuffer();
    onProgress(2, 'Reading file...');
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;
    let textChunks = [];

    for (let p = 1; p <= totalPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const raw = tc.items.map(i => i.str).join(' ').trim();
      if (raw.length > 0) textChunks.push(...chunkText(raw, 'text', p));
      onProgress((p / totalPages) * 40, `Extracting page ${p}/${totalPages}`);
    }

    let ocrChunks = [];
    // Only run OCR if very little selectable text was found (keeps demo fast for normal PDFs)
    const totalTextLen = textChunks.reduce((s, c) => s + c.text.length, 0);
    if (totalTextLen < 60) {
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') onProgress(40 + (m.progress || 0) * 55, `OCR: ${Math.round((m.progress || 0) * 100)}%`);
        },
      });
      for (let p = 1; p <= totalPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const { data: { text } } = await worker.recognize(canvas);
        const cleaned = text.replace(/\s+/g, ' ').trim();
        if (cleaned.length > 20) ocrChunks.push(...chunkText(cleaned, 'ocr', p));
      }
      await worker.terminate();
    }

    onProgress(100, 'Ready');
    return { chunks: [...textChunks, ...ocrChunks], totalPages, pdfDoc: pdf };
  }

  function fuseFind(query, candidates, threshold) {
    const fuse = new Fuse(candidates, {
      keys: ['text'], threshold, ignoreLocation: true, ignoreFieldNorm: true, minMatchCharLength: 3,
      includeMatches: true, includeScore: true,
    });
    // Fuse's `threshold` option alone does not reliably cut off matches for short
    // queries against long chunk text (esp. with ignoreLocation: true) — enforce the
    // score cutoff explicitly to avoid false positives like "MRI" fuzzy-matching
    // random unrelated text in a chunk.
    return fuse.search(query).filter(r => (r.score ?? 1) <= threshold);
  }

  function getMatchPos(str, query, fuseHit) {
    const exactIdx = str.toLowerCase().indexOf(query.toLowerCase());
    if (exactIdx !== -1) return { start: exactIdx, end: exactIdx + query.length };
    if (fuseHit?.matches?.[0]?.indices?.[0]) {
      const [s, e] = fuseHit.matches[0].indices[0];
      return { start: s, end: e + 1 };
    }
    return null;
  }

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function buildSnippet(text, aStart, aEnd, nStart, nEnd) {
    const ctxS = Math.max(0, aStart - 20);
    const ctxE = Math.min(text.length, nEnd + 20);
    const ctx = text.substring(ctxS, ctxE);
    const off = ctxS;
    const as = aStart - off, ae = aEnd - off, ns = nStart - off, ne = nEnd - off;
    let html = '', pos = 0;
    const events = [];
    if (as >= 0 && as < ctx.length) events.push({ pos: as, type: 'open', cls: 'anchor' });
    if (ae > 0 && ae <= ctx.length) events.push({ pos: ae, type: 'close', cls: 'anchor' });
    if (ns >= 0 && ns < ctx.length) events.push({ pos: ns, type: 'open', cls: 'nearby' });
    if (ne > 0 && ne <= ctx.length) events.push({ pos: ne, type: 'close', cls: 'nearby' });
    events.sort((a, b) => a.pos - b.pos || (a.type === 'open' ? 1 : -1));
    for (const ev of events) {
      if (ev.pos > pos) html += esc(ctx.substring(pos, ev.pos));
      html += ev.type === 'open' ? `<mark class="${ev.cls}">` : '</mark>';
      pos = ev.pos;
    }
    if (pos < ctx.length) html += esc(ctx.substring(pos));
    return (ctxS > 0 ? '...' : '') + html + (ctxE < text.length ? '...' : '');
  }

  function parseDateVariants(dateStr) {
    if (!dateStr) return [];
    const d = new Date(dateStr);
    if (isNaN(d)) return [];
    const day = d.getDate(), month = d.getMonth() + 1, year = d.getFullYear();
    const dd = String(day).padStart(2, '0'), mm = String(month).padStart(2, '0');
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mn = monthNames[month - 1], ms = monthShort[month - 1];
    return [
      `${dd}/${mm}/${year}`, `${dd}-${mm}-${year}`, `${dd}.${mm}.${year}`,
      `${day}/${month}/${year}`, `${day}-${month}-${year}`,
      `${year}-${mm}-${dd}`, `${year}/${mm}/${dd}`,
      `${dd} ${mn} ${year}`, `${dd} ${ms} ${year}`,
      `${mn} ${dd}, ${year}`, `${ms} ${dd}, ${year}`,
      `${mn} ${day} ${year}`, `${ms} ${day} ${year}`,
      `${dd}/${mm}/${String(year).slice(2)}`,
    ];
  }

  // ── CROSS-DOCUMENT TEST-NAME MATCHING ──
  // Used to check whether a test label (e.g. "VITAMIN B12 CYANOCOBALAMIN") appears
  // somewhere in a document's extracted chunks — first tries a direct fuzzy match of
  // the whole label, then falls back to matching individual significant words. The
  // fallback matters a lot for real scanned documents: OCR noise, column-order
  // jumbling from pdf.js's non-layout-aware text extraction, and genuinely different
  // wording between a lab's bill and a doctor's prescription (e.g. "HbA1c;
  // GLYCOSYLATED HEMOGLOBIN" vs "Glycosylated Haemoglobin (HbA1C),EDTA") mean a
  // single whole-string fuzzy pass often won't hit, even though a human would clearly
  // recognise it as the same test.
  const STOP_WORDS = new Set(['and', 'the', 'for', 'serum', 'test', 'level', 'with', 'tab', 'cap', 'examination']);

  function matchLabelInChunks(label, chunks, threshold = 0.35) {
    if (!label || !label.trim()) return { status: 'pending' };
    if (!chunks.length) return { status: 'pending' };

    // Pass 0: Exact substring match (very fast and reliable for acronyms/short tests)
    const lowerLabel = label.toLowerCase().trim();
    for (const chunk of chunks) {
      const lowerText = chunk.text.toLowerCase();
      const idx = lowerText.indexOf(lowerLabel);
      if (idx !== -1) {
        const snippet = buildSnippet(chunk.text, idx, idx + label.length, idx, idx + label.length);
        return { status: 'verified', snippet, page: chunk.page, method: 'exact' };
      }
    }

    // Pass 0.5: Alphanumeric exact match (for things like C.B.C matching CBC)
    const alphaLabel = lowerLabel.replace(/[^a-z0-9]/g, '');
    if (alphaLabel.length >= 3) {
      for (const chunk of chunks) {
        if (chunk.text.toLowerCase().replace(/[^a-z0-9]/g, '').includes(alphaLabel)) {
          return { status: 'verified', snippet: label, page: chunk.page, method: 'alpha' };
        }
      }
    }

    // Pass 1: direct fuzzy match of the whole label against each chunk
    const direct = fuseFind(label, chunks, threshold);
    if (direct.length > 0) {
      const h = direct[0];
      const pos = getMatchPos(h.item.text, label, h);
      const snippet = pos
        ? buildSnippet(h.item.text, pos.start, pos.end, pos.start, pos.end)
        : esc(h.item.text.slice(0, 100)) + '...';
      return { status: 'verified', snippet, page: h.item.page, method: 'direct' };
    }

    // Pass 2: fallback to token overlap (evaluated PER LINE to avoid cross-test combination)
    const tokens = label.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    if (tokens.length === 0) return { status: 'failed' };

    let bestRatio = 0, lastSnippet = null, lastPage = null;
    for (const chunk of chunks) {
      const lines = chunk.text.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let matchedCount = 0;
        for (const t of tokens) {
          if (line.toLowerCase().includes(t)) matchedCount++;
        }
        const ratio = matchedCount / tokens.length;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          lastSnippet = line.trim();
          lastPage = chunk.page;
        }
      }
    }

    if (bestRatio >= 0.80) return { status: 'verified', snippet: lastSnippet, page: lastPage, method: 'token', ratio: bestRatio };
    if (bestRatio > 0.40) return { status: 'partial', snippet: lastSnippet, page: lastPage, method: 'token', ratio: bestRatio };
    return { status: 'failed' };
  }

  // field: { anchor, inputType: 'text'|'date'|'amount', noAnchorNeeded, proximity }
  function verifyValue(userVal, field, chunks, threshold = 0.4, proximity = 150) {
    userVal = (userVal || '').toString().trim();
    if (!userVal || !chunks.length) return { status: 'pending' };

    let searchValues = [userVal];
    if (field.inputType === 'date') {
      searchValues = parseDateVariants(userVal);
      if (searchValues.length === 0) return { status: 'pending' };
    }
    if (field.inputType === 'amount') {
      const numeric = userVal.replace(/[^0-9.]/g, '');
      const numFloat = parseFloat(numeric);
      searchValues = [
        userVal, 
        numeric, 
        numFloat.toLocaleString('en-IN'),
        numFloat.toFixed(2),
        numFloat.toLocaleString('en-IN', {minimumFractionDigits: 2})
      ];
      searchValues = [...new Set(searchValues)];
    }

    if (field.noAnchorNeeded) {
      for (const variant of searchValues) {
        const lowerVariant = variant.toLowerCase();
        
        // Pass 0: Exact substring match
        for (const chunk of chunks) {
          const idx = chunk.text.toLowerCase().indexOf(lowerVariant);
          if (idx !== -1) {
            return { status: 'verified', snippet: buildSnippet(chunk.text, idx, idx + variant.length, idx, idx + variant.length), page: chunk.page };
          }
        }
        
        // Pass 1: Fuzzy match
        const hits = fuseFind(variant, chunks, threshold);
        if (hits.length > 0) {
          const h = hits[0];
          const pos = getMatchPos(h.item.text, variant, h);
          if (pos) return { status: 'verified', snippet: buildSnippet(h.item.text, pos.start, pos.start, pos.start, pos.end), page: h.item.page };
          return { status: 'verified', page: h.item.page };
        }
      }
      return { status: 'failed' };
    }

    const anchorHits = fuseFind(field.anchor, chunks, threshold);
    if (anchorHits.length === 0) return { status: 'failed' };

    let found = null;
    outer:
    for (const aHit of anchorHits) {
      const chunk = aHit.item;
      const aPos = getMatchPos(chunk.text, field.anchor, aHit);
      if (!aPos) continue;
      const winS = Math.max(0, aPos.start - proximity);
      const winE = Math.min(chunk.text.length, aPos.end + proximity);
      const winTxt = chunk.text.substring(winS, winE);

      for (const variant of searchValues) {
        const exactIdx = winTxt.toLowerCase().indexOf(variant.toLowerCase());
        if (exactIdx !== -1) {
          found = { page: chunk.page, text: chunk.text, anchorStart: aPos.start, anchorEnd: aPos.end,
            nearbyStart: winS + exactIdx, nearbyEnd: winS + exactIdx + variant.length, score: 100 };
          break outer;
        }
        const nHits = fuseFind(variant, [{ text: winTxt }], threshold);
        if (nHits.length > 0) {
          const nHit = nHits[0];
          const nPos = getMatchPos(winTxt, variant, nHit);
          if (nPos) {
            found = { page: chunk.page, text: chunk.text, anchorStart: aPos.start, anchorEnd: aPos.end,
              nearbyStart: winS + nPos.start, nearbyEnd: winS + nPos.end, score: Math.round((1 - (nHit.score || 0)) * 100) };
            break outer;
          }
        }
      }
    }

    if (found) {
      const snippet = buildSnippet(found.text, found.anchorStart, found.anchorEnd, found.nearbyStart, found.nearbyEnd);
      return { status: found.score >= 80 ? 'verified' : 'partial', snippet, page: found.page };
    }
    return { status: 'failed' };
  }

  return { processFile, verifyValue, matchLabelInChunks, parseDateVariants };
})();
