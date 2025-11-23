// Lettore EPUB con:
// - 1 "pagina" = 1 capitolo (spine EPUB)
// - evidenziatore pastello a parole
// - salvataggio progressi per libro
// - font / dimensione / colore evidenziatore personalizzabili
// - velocità discrete da 0.70s a 0.20s

const WELCOME_HTML = `
  <div class="placeholder">
    <h1>Benvenuto 👋</h1>
    <p>Carica un file <strong>.epub</strong> dal pulsante in alto per iniziare a leggere.</p>
    <p>Il paragrafo che stai leggendo verrà illuminato,
       con <strong>4 parole alla volta</strong> evidenziate con un effetto evidenziatore pastello.</p>
  </div>
`;

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const statusEl = document.getElementById("status");
  const pageContainer = document.getElementById("pageContainer");
  const prevPageBtn = document.getElementById("prevPage");
  const nextPageBtn = document.getElementById("nextPage");
  const pageIndicator = document.getElementById("pageIndicator");
  const prevChunkBtn = document.getElementById("prevChunk");
  const nextChunkBtn = document.getElementById("nextChunk");
  const toggleAutoBtn = document.getElementById("toggleAuto");
  const speedDownBtn = document.getElementById("speedDown");
  const speedUpBtn = document.getElementById("speedUp");
  const speedValue = document.getElementById("speedValue");
  const controlsBar = document.getElementById("controlsBar");
  const fabControls = document.getElementById("fabControls");
  const autoScrollToggle = document.getElementById("autoScrollToggle");

  const fontDownBtn = document.getElementById("fontDown");
  const fontUpBtn = document.getElementById("fontUp");
  const fontSizeValueEl = document.getElementById("fontSizeValue");
  const fontSelect = document.getElementById("fontSelect");
  const highlightPicker = document.getElementById("highlightPicker");

  if (!pageContainer || !pageIndicator || !statusEl) {
    console.error("Elementi base mancanti, controlla index.html");
    return;
  }

  // --- velocità fisse (ms) ---
  // corrispondono a: 0.70, 0.65, 0.60, 0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20
  const SPEED_STEPS_MS = [700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200];
  const DEFAULT_SPEED_INDEX = 6; // 0.40 s

  // --- font / dimensione ---
  const DEFAULT_FONT_SIZE_PX = 18;
  const MIN_FONT_SIZE_PX = 14;
  const MAX_FONT_SIZE_PX = 26;

  const SETTINGS_KEY = "epub-reader-settings-v2";

  const FONT_STACKS = {
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    serif: "'Georgia', 'Times New Roman', serif",
    merriweather: "'Merriweather', 'Georgia', serif",
    inter: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  };

  const state = {
    pages: [], // ora: array di capitoli, ogni capitolo = array di paragrafi
    currentPageIndex: 0, // in realtà "chapterIndex"
    currentParagraphIndex: 0,
    currentWordIndex: 0,
    chunkSize: 4,
    autoTimerId: null,
    speedIndex: DEFAULT_SPEED_INDEX,
    autoSpeedMs: SPEED_STEPS_MS[DEFAULT_SPEED_INDEX],
    bookLoaded: false,
    bookKey: null,
    autoScrollEnabled: true,
    fontSizePx: DEFAULT_FONT_SIZE_PX,
    highlightColor: "#ffef7d",
    fontFamilyKey: "system"
  };

  /* ---------- UTIL ---------- */

  function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* ---------- IMPOSTAZIONI GLOBALI (font, highlight, velocità) ---------- */

  function applyFontSize(px, skipSave) {
    let val = Number(px);
    if (!Number.isFinite(val)) val = DEFAULT_FONT_SIZE_PX;
    val = clamp(val, MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX);
    state.fontSizePx = val;
    const lineStep = Math.round(val * 1.6);

    document.documentElement.style.setProperty("--book-font-size-px", val + "px");
    document.documentElement.style.setProperty("--line-step", lineStep + "px");

    if (fontSizeValueEl) {
      fontSizeValueEl.textContent = val + " px";
    }
    if (!skipSave) saveSettings();
  }

  function applyHighlightColor(color, skipSave) {
    if (typeof color !== "string") return;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return;
    state.highlightColor = color;
    document.documentElement.style.setProperty("--highlight-word", color);
    if (highlightPicker) highlightPicker.value = color;
    if (!skipSave) saveSettings();
  }

  function applyFontFamily(key, skipSave) {
    const stack = FONT_STACKS[key] || FONT_STACKS.system;
    state.fontFamilyKey = key in FONT_STACKS ? key : "system";
    document.documentElement.style.setProperty("--book-font-family", stack);
    if (fontSelect) fontSelect.value = state.fontFamilyKey;
    if (!skipSave) saveSettings();
  }

  function updateSpeedLabel() {
    if (!speedValue) return;
    const seconds = state.autoSpeedMs / 1000;
    speedValue.textContent = seconds.toFixed(2) + " s";
  }

  function saveSettings() {
    const data = {
      fontSizePx: state.fontSizePx,
      highlightColor: state.highlightColor,
      fontFamilyKey: state.fontFamilyKey,
      speedIndex: state.speedIndex
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Impossibile salvare impostazioni lettore:", e);
    }
  }

  (function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        applyFontFamily("system", true);
        applyFontSize(DEFAULT_FONT_SIZE_PX, true);
        applyHighlightColor("#ffef7d", true);
        state.speedIndex = DEFAULT_SPEED_INDEX;
        state.autoSpeedMs = SPEED_STEPS_MS[state.speedIndex];
        updateSpeedLabel();
        return;
      }
      const s = JSON.parse(raw);

      // font
      if (s.fontFamilyKey) applyFontFamily(s.fontFamilyKey, true);
      else applyFontFamily("system", true);

      // size
      if (s.fontSizePx) applyFontSize(s.fontSizePx, true);
      else applyFontSize(DEFAULT_FONT_SIZE_PX, true);

      // highlight
      if (s.highlightColor) applyHighlightColor(s.highlightColor, true);
      else applyHighlightColor("#ffef7d", true);

      // speed
      if (typeof s.speedIndex === "number") {
        const idx = clamp(s.speedIndex, 0, SPEED_STEPS_MS.length - 1);
        state.speedIndex = idx;
      } else {
        state.speedIndex = DEFAULT_SPEED_INDEX;
      }
      state.autoSpeedMs = SPEED_STEPS_MS[state.speedIndex];
      updateSpeedLabel();
    } catch {
      applyFontFamily("system", true);
      applyFontSize(DEFAULT_FONT_SIZE_PX, true);
      applyHighlightColor("#ffef7d", true);
      state.speedIndex = DEFAULT_SPEED_INDEX;
      state.autoSpeedMs = SPEED_STEPS_MS[state.speedIndex];
      updateSpeedLabel();
    }
  })();

  /* ---------- EVENTI UI ---------- */

  if (fileInput) {
    fileInput.addEventListener("change", handleFileChange);
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      changePage(-1);
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      changePage(1);
    });
  }

  if (prevChunkBtn) {
    prevChunkBtn.addEventListener("click", () => {
      stopAuto();
      previousChunk();
    });
  }

  if (nextChunkBtn) {
    nextChunkBtn.addEventListener("click", () => {
      stopAuto();
      advanceChunk();
    });
  }

  if (toggleAutoBtn) {
    toggleAutoBtn.addEventListener("click", () => {
      if (!state.bookLoaded) return;
      if (state.autoTimerId) {
        stopAuto();
      } else {
        startAuto();
      }
    });
  }

  if (speedDownBtn) {
    // meno = più lento
    speedDownBtn.addEventListener("click", () => {
      state.speedIndex = clamp(
        state.speedIndex + 1,
        0,
        SPEED_STEPS_MS.length - 1
      );
      state.autoSpeedMs = SPEED_STEPS_MS[state.speedIndex];
      updateSpeedLabel();
      saveSettings();
      if (state.autoTimerId) startAuto();
    });
  }

  if (speedUpBtn) {
    // più = più veloce
    speedUpBtn.addEventListener("click", () => {
      state.speedIndex = clamp(
        state.speedIndex - 1,
        0,
        SPEED_STEPS_MS.length - 1
      );
      state.autoSpeedMs = SPEED_STEPS_MS[state.speedIndex];
      updateSpeedLabel();
      saveSettings();
      if (state.autoTimerId) startAuto();
    });
  }

  if (autoScrollToggle) {
    autoScrollToggle.checked = true;
    autoScrollToggle.addEventListener("change", (e) => {
      state.autoScrollEnabled = !!e.target.checked;
    });
  }

  // Font size A-/A+
  if (fontDownBtn) {
    fontDownBtn.addEventListener("click", () => {
      applyFontSize(state.fontSizePx - 2);
    });
  }
  if (fontUpBtn) {
    fontUpBtn.addEventListener("click", () => {
      applyFontSize(state.fontSizePx + 2);
    });
  }

  // font select
  if (fontSelect) {
    fontSelect.value = state.fontFamilyKey;
    fontSelect.addEventListener("change", (e) => {
      applyFontFamily(e.target.value);
    });
  }

  // highlight color picker
  if (highlightPicker) {
    highlightPicker.value = state.highlightColor;
    highlightPicker.addEventListener("input", (e) => {
      applyHighlightColor(e.target.value);
    });
  }

  // FAB per aprire/chiudere i comandi su mobile
  if (fabControls && controlsBar) {
    fabControls.addEventListener("click", () => {
      const isOpen = controlsBar.classList.toggle("controls-open");
      fabControls.textContent = isOpen ? "✕" : "☰";
    });
  }

  // Barra spaziatrice = play/pausa (desktop)
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.closest("input") && !e.target.closest("select")) {
      e.preventDefault();
      if (!state.bookLoaded || !toggleAutoBtn) return;
      if (state.autoTimerId) {
        stopAuto();
      } else {
        startAuto();
      }
    }
  });

  /* ---------- GESTIONE FILE / CAPITOLI ---------- */

  async function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    resetState();
    statusEl.textContent = `Caricamento di "${file.name}"...`;

    try {
      if (typeof JSZip === "undefined") {
        throw new Error("JSZip non è caricato. Controlla il tag <script> in index.html.");
      }

      const arrayBuffer = await file.arrayBuffer();
      const chapters = await extractChaptersFromEpub(arrayBuffer);

      if (!chapters.length) {
        throw new Error("Nessun capitolo leggibile trovato nell'EPUB.");
      }

      // Ogni "pagina" ora è un capitolo
      state.pages = chapters;

      // Chiave per i progressi di questo libro
      const fileKey = `epub-progress:${file.name}:${file.size}`;
      state.bookKey = fileKey;

      let resume = null;
      try {
        const savedRaw = localStorage.getItem(fileKey);
        if (savedRaw) resume = JSON.parse(savedRaw);
      } catch {
        resume = null;
      }

      if (
        resume &&
        typeof resume.pageIndex === "number" &&
        resume.pageIndex >= 0 &&
        resume.pageIndex < state.pages.length
      ) {
        const safePage = resume.pageIndex;
        renderPage(safePage, {
          paragraphIndex: resume.paragraphIndex || 0,
          wordIndex: resume.wordIndex || 0
        });
        statusEl.textContent = `File caricato: ${file.name} • Capitolo ${safePage + 1} di ${state.pages.length}`;
      } else {
        renderPage(0, null);
        statusEl.textContent = `File caricato: ${file.name} • Capitoli: ${state.pages.length}`;
      }

      state.bookLoaded = true;
    } catch (err) {
      console.error(err);
      pageContainer.innerHTML = `
        <div class="placeholder">
          <h1>Errore di lettura ⚠️</h1>
          <p>Non sono riuscito a leggere questo EPUB.</p>
          <p>Messaggio: <code>${escapeHtml(err.message || String(err))}</code></p>
        </div>
      `;
      statusEl.textContent = "Errore: impossibile leggere il file.";
      state.bookLoaded = false;
      stopAuto();
    }
  }

  function resetState() {
    stopAuto();
    state.pages = [];
    state.currentPageIndex = 0;
    state.currentParagraphIndex = 0;
    state.currentWordIndex = 0;
    state.bookKey = null;
    pageContainer.innerHTML = WELCOME_HTML;
    pageIndicator.textContent = "0 / 0";
  }

  /**
   * Estrae i capitoli usando:
   * - META-INF/container.xml -> percorso OPF
   * - file OPF: manifest + spine per ordine di lettura
   * Ogni capitolo = array di paragrafi (stringhe).
   */
  async function extractChaptersFromEpub(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parser = new DOMParser();

    // 1) Trova file OPF dal container.xml
    let opfPath = null;
    const containerFile = zip.file("META-INF/container.xml");
    if (containerFile) {
      try {
        const xml = await containerFile.async("string");
        const doc = parser.parseFromString(xml, "application/xml");
        const rootfile = doc.querySelector("rootfile");
        if (rootfile) {
          opfPath = rootfile.getAttribute("full-path");
        }
      } catch (e) {
        console.warn("Errore lettura container.xml:", e);
      }
    }

    let spineHrefs = [];

    if (opfPath && zip.file(opfPath)) {
      try {
        const opfXml = await zip.file(opfPath).async("string");
        const opfDoc = parser.parseFromString(opfXml, "application/xml");

        // manifest: id -> href (solo html/xhtml)
        const manifest = new Map();
        opfDoc.querySelectorAll("manifest > item").forEach((item) => {
          const id = item.getAttribute("id");
          const href = item.getAttribute("href");
          const mediaType = item.getAttribute("media-type") || "";
          if (id && href && /xhtml|html/i.test(mediaType)) {
            manifest.set(id, href);
          }
        });

        const opfDir =
          opfPath && opfPath.includes("/")
            ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
            : "";

        opfDoc.querySelectorAll("spine > itemref").forEach((itemref) => {
          const idref = itemref.getAttribute("idref");
          const href = manifest.get(idref);
          if (href) {
            spineHrefs.push(opfDir + href);
          }
        });
      } catch (e) {
        console.warn("Errore lettura OPF:", e);
      }
    }

    // Fallback: niente spine -> ordinamento alfabetico dei file html
    if (!spineHrefs.length) {
      const htmlPaths = [];
      zip.forEach((relativePath, file) => {
        if (file.dir) return;
        if (/nav\.x?html$/i.test(relativePath)) return;
        if (/\.(xhtml|html)$/i.test(relativePath)) {
          htmlPaths.push(relativePath);
        }
      });
      htmlPaths.sort();
      spineHrefs = htmlPaths;
    }

    const chapters = [];

    for (const path of spineHrefs) {
      const file = zip.file(path);
      if (!file) continue;

      const xhtml = await file.async("string");
      const doc = parser.parseFromString(xhtml, "text/html");
      const body = doc.querySelector("body");
      if (!body) continue;

      const blocks = body.querySelectorAll("p, div, li, h1, h2, h3, h4");
      const chapterParas = [];

      blocks.forEach((node) => {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length > 30) {
          chapterParas.push(text);
        }
      });

      if (chapterParas.length) {
        chapters.push(chapterParas);
      }
    }

    return chapters;
  }

  /* ---------- RENDER CAPITOLO + PAGINAZIONE ---------- */

  function renderPage(pageIndex, restore) {
    if (!state.pages.length) return;
    if (pageIndex < 0 || pageIndex >= state.pages.length) return;

    state.currentPageIndex = pageIndex;
    state.currentParagraphIndex = 0;
    state.currentWordIndex = 0;

    const paras = state.pages[pageIndex];

    pageContainer.innerHTML = "";
    const fragment = document.createDocumentFragment();

    paras.forEach((text, idx) => {
      const p = document.createElement("p");
      p.className = "book-paragraph";
      p.dataset.paragraphIndex = String(idx);
      wrapWordsInParagraph(p, text);

      p.addEventListener("click", () => {
        stopAuto();
        setActiveParagraph(idx);
      });

      fragment.appendChild(p);
    });

    pageContainer.appendChild(fragment);

    if (restore && typeof restore.paragraphIndex === "number") {
      const totalParas = pageContainer.querySelectorAll(".book-paragraph").length;
      const safePara = clamp(restore.paragraphIndex, 0, totalParas - 1);
      setActiveParagraph(safePara);
      state.currentWordIndex = Math.max(0, restore.wordIndex || 0);
      updateWordHighlight();
      scrollToCurrentHighlight();
    } else {
      setActiveParagraph(0);
      scrollToCurrentHighlight();
    }

    updatePageIndicator();
  }

  function updatePageIndicator() {
    const total = state.pages.length;
    const current = total ? state.currentPageIndex + 1 : 0;
    pageIndicator.textContent = `${current} / ${total}`;
  }

  function changePage(direction) {
    if (!state.pages.length) return;
    const newIndex = state.currentPageIndex + direction;
    if (newIndex < 0 || newIndex >= state.pages.length) return;
    stopAuto();
    renderPage(newIndex, null);
  }

  function wrapWordsInParagraph(pEl, text) {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    pEl.textContent = "";
    words.forEach((word, index) => {
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = index < words.length - 1 ? word + " " : word;
      pEl.appendChild(span);
    });
  }

  /* ---------- SCROLL AUTO SULL'EVIDENZIATO ---------- */

  function scrollToCurrentHighlight() {
    if (!state.autoScrollEnabled) return;

    const activeWord = pageContainer.querySelector(
      ".book-paragraph.active-paragraph .word-highlight"
    );
    const target =
      activeWord || pageContainer.querySelector(".book-paragraph.active-paragraph");

    if (!target) return;

    target.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  }

  /* ---------- EVIDENZIATORE ---------- */

  function getSentenceBoundaries(words) {
    const sentenceStarts = [0];
    const sentenceEnds = [];
    for (let i = 0; i < words.length; i++) {
      const text = words[i].textContent || "";
      if (/[.!?…]/.test(text)) {
        sentenceEnds.push(i);
        if (i + 1 < words.length) {
          sentenceStarts.push(i + 1);
        }
      }
    }

    if (!sentenceEnds.length) {
      sentenceEnds.push(words.length - 1);
    } else if (sentenceEnds.length < sentenceStarts.length) {
      sentenceEnds.push(words.length - 1);
    }

    return { sentenceStarts, sentenceEnds };
  }

  function getActiveParagraphData() {
    const active = pageContainer.querySelector(".book-paragraph.active-paragraph");
    if (!active) return null;
    const words = active.querySelectorAll(".word");
    if (!words.length) return null;
    const { sentenceStarts, sentenceEnds } = getSentenceBoundaries(words);
    return { active, words, sentenceStarts, sentenceEnds };
  }

  function clearAllHighlights() {
    pageContainer.querySelectorAll(".word-highlight").forEach((el) =>
      el.classList.remove("word-highlight")
    );
  }

  function setActiveParagraph(paragraphIndex) {
    const paras = pageContainer.querySelectorAll(".book-paragraph");
    if (!paras.length) return;

    const clampedIndex = clamp(paragraphIndex, 0, paras.length - 1);

    clearAllHighlights();
    paras.forEach((p) => p.classList.remove("active-paragraph"));

    const active = paras[clampedIndex];
    active.classList.add("active-paragraph");

    state.currentParagraphIndex = clampedIndex;
    state.currentWordIndex = 0;
    updateWordHighlight();
    scrollToCurrentHighlight();
  }

  function updateWordHighlight() {
    const data = getActiveParagraphData();
    if (!data) return;

    const { words, sentenceStarts, sentenceEnds } = data;

    clearAllHighlights();
    if (!words.length) return;

    let idx = state.currentWordIndex;
    if (idx < 0) idx = 0;
    if (idx >= words.length) idx = words.length - 1;
    state.currentWordIndex = idx;

    let sentenceIndex = 0;
    for (let i = 0; i < sentenceStarts.length; i++) {
      if (idx >= sentenceStarts[i]) sentenceIndex = i;
      else break;
    }

    const sentEnd = sentenceEnds[sentenceIndex];

    const start = idx;
    const end = Math.min(idx + state.chunkSize - 1, sentEnd);

    for (let i = start; i <= end; i++) {
      words[i].classList.add("word-highlight");
    }

    scrollToCurrentHighlight();
    saveProgress();
  }

  function goToNextParagraphStart() {
    const paras = pageContainer.querySelectorAll(".book-paragraph");
    if (state.currentParagraphIndex + 1 < paras.length) {
      setActiveParagraph(state.currentParagraphIndex + 1);
    } else if (state.currentPageIndex + 1 < state.pages.length) {
      renderPage(state.currentPageIndex + 1, { paragraphIndex: 0, wordIndex: 0 });
    } else {
      stopAuto();
    }
  }

  function goToPrevParagraphEnd() {
    const paras = pageContainer.querySelectorAll(".book-paragraph");
    if (state.currentParagraphIndex - 1 >= 0) {
      const prevIdx = state.currentParagraphIndex - 1;
      paras.forEach((p) => p.classList.remove("active-paragraph"));
      const prevPara = paras[prevIdx];
      prevPara.classList.add("active-paragraph");
      state.currentParagraphIndex = prevIdx;

      const words = prevPara.querySelectorAll(".word");
      if (words.length) {
        state.currentWordIndex = words.length - 1;
        updateWordHighlight();
      }
    } else if (state.currentPageIndex - 1 >= 0) {
      renderPage(state.currentPageIndex - 1, null);
      const newParas = pageContainer.querySelectorAll(".book-paragraph");
      if (newParas.length) {
        const lastIdx = newParas.length - 1;
        newParas.forEach((p) => p.classList.remove("active-paragraph"));
        const lastPara = newParas[lastIdx];
        lastPara.addClass;
        lastPara.classList.add("active-paragraph");
        state.currentParagraphIndex = lastIdx;

        const words = lastPara.querySelectorAll(".word");
        if (words.length) {
          state.currentWordIndex = words.length - 1;
          updateWordHighlight();
        }
      }
    }
  }

  function advanceChunk() {
    const data = getActiveParagraphData();
    if (!data) return;
    const { words, sentenceStarts, sentenceEnds } = data;
    if (!words.length) return;

    let idx = state.currentWordIndex;

    if (idx >= words.length - 1) {
      goToNextParagraphStart();
      return;
    }

    let sentenceIndex = 0;
    for (let i = 0; i < sentenceStarts.length; i++) {
      if (idx >= sentenceStarts[i]) sentenceIndex = i;
      else break;
    }

    const sentEnd = sentenceEnds[sentenceIndex];

    let nextIdx = idx + 1;
    if (nextIdx > sentEnd) {
      if (sentenceIndex + 1 < sentenceStarts.length) {
        nextIdx = sentenceStarts[sentenceIndex + 1];
      } else {
        goToNextParagraphStart();
        return;
      }
    }

    state.currentWordIndex = nextIdx;
    updateWordHighlight();
  }

  function previousChunk() {
    const data = getActiveParagraphData();
    if (!data) return;
    const { words } = data;
    if (!words.length) return;

    let idx = state.currentWordIndex;

    if (idx <= 0) {
      goToPrevParagraphEnd();
      return;
    }

    state.currentWordIndex = idx - 1;
    updateWordHighlight();
  }

  /* ---------- AUTO ---------- */

  function startAuto() {
    stopAuto();
    state.autoTimerId = setInterval(advanceChunk, state.autoSpeedMs);
    if (toggleAutoBtn) {
      toggleAutoBtn.textContent = "⏸";
      toggleAutoBtn.classList.add("active");
    }
  }

  function stopAuto() {
    if (state.autoTimerId) {
      clearInterval(state.autoTimerId);
      state.autoTimerId = null;
    }
    if (toggleAutoBtn) {
      toggleAutoBtn.textContent = "▶ Auto";
      toggleAutoBtn.classList.remove("active");
    }
  }

  /* ---------- SALVATAGGIO PROGRESSO ---------- */

  function saveProgress() {
    if (!state.bookKey) return;
    const data = {
      pageIndex: state.currentPageIndex, // ora = capitolo
      paragraphIndex: state.currentParagraphIndex,
      wordIndex: state.currentWordIndex
    };
    try {
      localStorage.setItem(state.bookKey, JSON.stringify(data));
    } catch (e) {
      console.warn("Impossibile salvare i progressi:", e);
    }
  }
});
