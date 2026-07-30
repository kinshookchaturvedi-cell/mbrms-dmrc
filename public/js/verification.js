// verification.js
// Generalised version of the team's pdf-parser-4 prototype.
// Loads a PDF (or image) bill, extracts text (+ OCR fallback for scanned pages),
// then lets the rest of the app fuzzy-match user-entered field values against
// the extracted text, using an "anchor" word (e.g. "patient", "hospital") to
// narrow the search window before looking for the value nearby.
//
// Requires (loaded via CDN before this script):
//   pdf.js, fuse.js, tesseract.js, opencv.js (optional), handwritten-verification.js

const Verifier = (() => {
  const CHUNK_SIZE = 200;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function chunkText(text, source, page) {
    const chunks = [];
    const words = text.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      cur += (cur ? ' ' : '') + w;
      if (cur.length >= CHUNK_SIZE) {
        chunks.push({ text: cur.trim(), source, page });
        cur = '';
      }
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
    let pageCanvases = [];

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
          if (m.status === 'recognizing text')
            onProgress(40 + (m.progress || 0) * 55, `OCR: ${Math.round((m.progress || 0) * 100)}%`);
        },
      });

      for (let p = 1; p <= totalPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 3.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        // Store rendered canvas for handwritten OCR fallback pass if standard OCR yields low text volume
        pageCanvases.push({ pageNum: p, canvas });

        const { data: { text } } = await worker.recognize(canvas);
        const cleaned = text.replace(/\s+/g, ' ').trim();
        if (cleaned.length > 20) ocrChunks.push(...chunkText(cleaned, 'ocr', p));
      }
      await worker.terminate();

      // --- HANDWRITTEN OCR FALLBACK PASS ---
      // If standard OCR yields < 30 characters, run HandwrittenOCR on the saved page canvases
      const totalOcrLen = ocrChunks.reduce((s, c) => s + c.text.length, 0);
      if (totalOcrLen < 30 && window.HandwrittenOCR && pageCanvases.length > 0) {
        onProgress(90, 'Processing handwritten text fallback...');
        console.warn("Standard OCR yield low. Triggering HandwrittenOCR fallback engine...");

        for (const item of pageCanvases) {
          const hwResult = await window.HandwrittenOCR.processHandwrittenDoc(item.canvas);
          const hwCleaned = (hwResult.extractedText || '').replace(/\s+/g, ' ').trim();
          if (hwCleaned.length > 10) {
            ocrChunks.push(...chunkText(hwCleaned, 'handwritten-ocr', item.pageNum));
          }
        }
      }
    }

    onProgress(100, 'Ready');
    return { chunks: [...textChunks, ...ocrChunks], totalPages, pdfDoc: pdf };
  }

  function fuseFind(query, candidates, threshold) {
    const fuse = new Fuse(candidates, {
      keys: ['text'],
      threshold,
      ignoreLocation: true,
      ignoreFieldNorm: true,
      minMatchCharLength: 3,
      includeMatches: true,
      includeScore: true,
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

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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
      `${day}/${month}/${year}`, `${day}-${month}-${year}`, `${year}-${mm}-${dd}`,
      `${year}/${mm}/${dd}`, `${dd} ${mn} ${year}`, `${dd} ${ms} ${year}`,
      `${mn} ${dd}, ${year}`, `${ms} ${dd}, ${year}`, `${mn} ${day} ${year}`,
      `${ms} ${day} ${year}`, `${dd}/${mm}/${String(year).slice(2)}`,
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
  const STOP_WORDS = new Set(['and', 'the', 'for', 'serum', 'test', 'level', 'with', 'tab', 'cap', 'examination', 'of']);
  const TEST_ALIASES = {
    'cbc': ['complete blood count', 'blood picture', 'hemogram'],
    'crp': ['c-reactive protein', 'c reactive protein'],
    'sgpt': ['alt', 'alanine aminotransferase'],
    'sgot': ['ast', 'aspartate aminotransferase'],
    'lft': ['liver function test'],
    'kft': ['kidney function test'],
    'rft': ['renal function test'],
    'tft': ['thyroid function test'],
    'lipid': ['lipid profile'],
    'fbs': ['fasting blood sugar'],
    'ppbs': ['post prandial blood sugar'],
    'hba1c': ['glycated hemoglobin', 'glycosylated hemoglobin', 'hb1ac'],
    'tsh': ['thyroid stimulating hormone'],
    't3': ['triiodothyronine'],
    't4': ['thyroxine'],
    'esr': ['erythrocyte sedimentation rate'],
    'bun': ['blood urea nitrogen'],
    'wbc': ['white blood cell count', 'total leucocyte count', 'tlc'],
    'rbc': ['red blood cell count'],
    'plt': ['platelet count'],
    'ecg': ['electrocardiogram', 'ekg'],
    'usg': ['ultrasound', 'ultrasonography'],
    'mri': ['magnetic resonance imaging'],
    'ct': ['computed tomography'],
    'xray': ['x-ray', 'radiograph'],
    'rtpcr': ['rt-pcr', 'reverse transcription polymerase chain reaction'],
    'hiv': ['human immunodeficiency virus'],
    'hcv': ['hepatitis c virus'],
    'hbsag': ['hepatitis b surface antigen'],
    'vdrl': ['venereal disease research laboratory'],
    'tmt': ['treadmill test'],
    'pft': ['pulmonary function test'],
    'eeg': ['electroencephalogram'],
    'dexa': ['dual-energy x-ray absorptiometry', 'bone mineral density'],
    'pap': ['papanicolaou smear'],
    'fnac': ['fine needle aspiration cytology'],
    'urine rm': ['urine routine microscopy', 'urine r/m', 'urine routine', 'urine r/m & c/s', 'urine routine (automated)'],
    'culture urine': ['culture, urine', 'urine culture', 'urine c/s']
  };

  function getLabelVariants(label) {
    const variants = new Set([label.toLowerCase().trim()]);
    const lower = label.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    // 1. Generate dynamic acronym from full form (e.g. "COMPLETE BLOOD COUNT" -> "cbc")
    const words = label.toLowerCase().split(/[\s\-]+/).filter(w => w.length > 0 && !STOP_WORDS.has(w));
    if (words.length >= 2) {
      const acronym = words.map(w => w[0]).join('');
      if (acronym.length >= 2) variants.add(acronym);
    }
    // 2. Map aliases (both ways)
    for (const [short, longs] of Object.entries(TEST_ALIASES)) {
      if (lower === short || lower === short.replace(/[^a-z0-9]/g, '')) {
        longs.forEach(l => variants.add(l));
      }
      for (const l of longs) {
        if (lower === l.replace(/[^a-z0-9\s]/g, '')) {
          variants.add(short);
          longs.forEach(lo => variants.add(lo));
        }
      }
    }
    return Array.from(variants);
  }

  function matchLabelInChunks(label, chunks, threshold = 0.35) {
    if (!chunks || chunks.length === 0) return { status: 'pending' };
    const variants = getLabelVariants(label);
    let bestResult = { status: 'failed', ratio: 0 };

    for (const variantLabel of variants) {
      const lowerLabel = variantLabel.toLowerCase().trim();
      const alphaLabel = lowerLabel.replace(/[^a-z0-9]/g, '');

      // Pass 0: Exact substring match (very fast and reliable for acronyms/short tests)
      for (const chunk of chunks) {
        const lowerText = chunk.text.toLowerCase();
        const idx = lowerText.indexOf(lowerLabel);
        if (idx !== -1) {
          const snippet = buildSnippet(chunk.text, idx, idx + variantLabel.length, idx, idx + variantLabel.length);
          return { status: 'verified', snippet, page: chunk.page, method: 'exact' };
        }
      }

      // Pass 0.5: Alphanumeric exact match (for things like C.B.C matching CBC)
      if (alphaLabel.length >= 2) {
        for (const chunk of chunks) {
          if (chunk.text.toLowerCase().replace(/[^a-z0-9]/g, '').includes(alphaLabel)) {
            return { status: 'verified', snippet: variantLabel, page: chunk.page, method: 'alpha' };
          }
        }
      }

      // Pass 1: direct fuzzy match of the whole label against each chunk
      const direct = fuseFind(variantLabel, chunks, threshold);
      if (direct.length > 0) {
        const h = direct[0];
        const pos = getMatchPos(h.item.text, variantLabel, h);
        if (pos) {
          return { status: 'verified', snippet: buildSnippet(h.item.text, pos.start, pos.start, pos.start, pos.end), page: h.item.page, method: 'direct' };
        }
        return { status: 'verified', snippet: variantLabel, page: h.item.page, method: 'direct' };
      }

      // Pass 2: fallback to token overlap (evaluated PER LINE to avoid cross-test combination)
      const tokens = lowerLabel.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
      if (tokens.length > 0) {
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
        if (bestRatio > bestResult.ratio) {
          if (bestRatio >= 0.80) {
            bestResult = { status: 'verified', snippet: lastSnippet, page: lastPage, method: 'token', ratio: bestRatio };
            return bestResult; // Immediate return if verified
          } else if (bestRatio > 0.40) {
            bestResult = { status: 'partial', snippet: lastSnippet, page: lastPage, method: 'token', ratio: bestRatio };
          }
        }
      }
    }
    return bestResult;
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
      searchValues = [userVal, numeric, numFloat.toLocaleString('en-IN'), numFloat.toFixed(2), numFloat.toLocaleString('en-IN', {minimumFractionDigits: 2})];
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

    outer: for (const aHit of anchorHits) {
      const chunk = aHit.item;
      const aPos = getMatchPos(chunk.text, field.anchor, aHit);
      if (!aPos) continue;
      const winS = Math.max(0, aPos.start - proximity);
      const winE = Math.min(chunk.text.length, aPos.end + proximity);
      const winTxt = chunk.text.substring(winS, winE);

      for (const variant of searchValues) {
        const exactIdx = winTxt.toLowerCase().indexOf(variant.toLowerCase());
        if (exactIdx !== -1) {
          found = { page: chunk.page, text: chunk.text, anchorStart: aPos.start, anchorEnd: aPos.end, nearbyStart: winS + exactIdx, nearbyEnd: winS + exactIdx + variant.length, score: 100 };
          break outer;
        }
        const nHits = fuseFind(variant, [{ text: winTxt }], threshold);
        if (nHits.length > 0) {
          const nHit = nHits[0];
          const nPos = getMatchPos(winTxt, variant, nHit);
          if (nPos) {
            found = { page: chunk.page, text: chunk.text, anchorStart: aPos.start, anchorEnd: aPos.end, nearbyStart: winS + nPos.start, nearbyEnd: winS + nPos.end, score: Math.round((1 - (nHit.score || 0)) * 100) };
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
