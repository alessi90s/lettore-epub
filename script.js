// Lettore EPUB mobile-friendly con evidenziatore pastello + salvataggio progressi

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
  const speedRange = document.getElementById("speedRange");
  const speedValue = document.getElementById("speedValue");
  const controlsBar = document.getElementById("controlsBar");
  const fabControls = document.getElementById("fabControls");

  // Slider velocità: 0 => 5 s, 100 => 0,2 s
  function sliderValueToMs(value) {
    const v = Math.max(0, Math.min(100, Number(value)));
    const slowMs = 5000;
    const fastMs = 200;
    const t = v / 100;
    return Math.round(slowMs - (slowMs - fastMs) * t);
  }

  const state = {
    pages: [],
    currentPageIndex: 0,
    currentParagraphIndex: 0,
    currentWordIndex: 0,
    chunkSize: 4,
    autoTimerId: null,
    autoSpeedMs: sliderValueToMs(speedRange.value),
    bookLoaded: false,
    bookKey: null // chiave per localStorage
  };

  /* -------- EVENTI UI -------- */

  if (fileInput) {
    fileInput.addEventListener("change", handleFileChange);
  }

  prevPageBtn.addEventListener("click", () => {
    changePage(-1);
  });

  nextPageBtn.addEventListener("click", () => {
    changePage(1);
  });

  prevChunkBtn.addEventListener("click", () => {
    stopAuto();
    previousChunk();
  });

  nextChunkBtn.addEventListener("click", () => {
    stopAuto();
    advanceChunk();
  });

  toggleAutoBtn.addEventListener("click", () => {
    if (!state.bookLoaded) return;
    if (state.autoTimerId) {
      stopAuto();
    } else {
      startAuto();
    }
  });

  speedRange.addEventListener("input", (e) => {
    const rawVal = Number(e.target.value);
    state.autoSpeedMs = sliderValueToMs(rawVal);
    speedValue.textContent = (state.autoSpeedMs / 1000).toFixed(2) + " s";
    if (state.autoTimerId) {
      startAuto();
    }
  });

  // FAB per aprire/chiudere i comandi su mobile
  if (fabControls) {
    fabControls.addEventListener("click", () => {
      const isOpen = controlsBar.classList.toggle("controls-open");
      fabControls.textContent = isOpen ? "✕" : "☰";
    });
  }

  function closeControlsPanel() {
    if (controlsBar.classList.contains("controls-open")) {
      controlsBar.classList.remove("controls-open");
      if (fabControls) fabControls.textContent = "☰";
    }
  }

  // Barra spaziatrice = play/pausa (desktop)
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.closest("input")) {
      e.preventDefault();
      if (!state.bookLoaded) return;
      if (state.autoTimerId) {
        stopAuto();
      } else {
        startAuto();
      }
    }
  });

  speedValue.textContent = (state.autoSpeedMs / 1000).toFixed(2) + " s";

  /* -------- GESTIONE FILE -------- */

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
      const paragraphs = await extractParagraphsFromEpub(arrayBuffer);

      if (!paragraphs.length) {
        throw new Error("Nessun testo leggibile trovato nell'EPUB.");
      }

      buildPages(paragraphs);

      // Chiave per i progressi di questo libro
      const fileKey = `epub-progress:${file.name}:${file.size}`;
      state.bookKey = fileKey;

      let resume = null;
      const savedRaw = localStorage.getItem(fileKey);
      if (savedRaw) {
        try {
          resume = JSON.parse(savedRaw);
        } catch {
          resume = null;
        }
      }

      if (resume && typeof resume.pageIndex === "number") {
        const safePage = clamp(resume.pageIndex, 0, state.pages.length - 1);
        renderPage(safePage, {
          paragraphIndex: resume.paragraphIndex || 0,
          wordIndex: resume.wordIndex || 0
        });
        statusEl.textContent = `File caricato: ${file.name} • Ripreso a pagina ${safePage + 1}`;
      } else {
        renderPage(0, null);
        statusEl.textContent = `File caricato: ${file.name} • Paragrafi: ${paragraphs.length}`;
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
   * Estrae paragrafi:
   * - apre zip con JSZip
   * - prende tutti i .xhtml/.html (escluso nav.xhtml)
   * - li ordina per nome
   * - estrae body > p/div/li/h*
   */
  async function extractParagraphsFromEpub(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parser = new DOMParser();
    const paragraphs = [];
    const htmlPaths = [];

    zip.forEach((relativePath, file) => {
      if (file.dir) return;
      if (/nav\.x?html$/i.test(relativePath)) return;
      if (/\.(xhtml|html)$/i.test(relativePath)) {
        htmlPaths.push(relativePath);
      }
    });

    if (!htmlPaths.length) {
      throw new Error("Nessun capitolo HTML trovato nello zip.");
    }

    htmlPaths.sort();

    for (const path of htmlPaths) {
      const file = zip.file(path);
      if (!file) continue;

      const xhtml = await file.async("string");
      const doc = parser.parseFromString(xhtml, "text/html");
      const body = doc.querySelector("body");
      if (!body) continue;

      const blocks = body.querySelectorAll("p, div, li, h1, h2, h3, h4");
      blocks.forEach((node) => {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length > 30) {
          paragraphs.push(text);
        }
      });
    }

    return paragraphs;
  }

  /* -------- PAGINAZIONE -------- */

  function buildPages(paragraphs) {
    const CHARS_PER_PAGE = 1500;
    const pages = [];
    let currentPage = [];
    let currentCount = 0;

    paragraphs.forEach((pText) => {
      const len = pText.length;
      if (currentPage.length && currentCount + len > CHARS_PER_PAGE) {
        pages.push(currentPage);
        currentPage = [];
        currentCount = 0;
      }
      currentPage.push(pText);
      currentCount += len;
    });

    if (currentPage.length) {
      pages.push(currentPage);
    }

    state.pages = pages;
  }

  // renderPage ora accetta opzionalmente "restore" per riprendere posizione
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
      const safePara = clamp(
        restore.paragraphIndex,
        0,
        pageContainer.querySelectorAll(".book-paragraph").length - 1
      );
      setActiveParagraph(safePara);
      state.currentWordIndex = Math.max(0, restore.wordIndex || 0);
      updateWordHighlight();
      scrollActiveParagraphIntoView();
    } else {
      setActiveParagraph(0);
      scrollActiveParagraphIntoView();
    }

    updatePageIndicator();
    closeControlsPanel();
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

  function scrollActiveParagraphIntoView() {
    const active = pageContainer.querySelector(".book-paragraph.active-paragraph");
    if (!active) return;
    const parent = active.closest(".book-page") || pageContainer.parentElement;
    if (!parent) return;
    const rect = active.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    if (rect.top < parentRect.top + 60 || rect.bottom > parentRect.bottom - 60) {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  /* -------- EVIDENZIATORE -------- */

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
    scrollActiveParagraphIntoView();
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

    saveProgress(); // ogni volta che cambia evidenziazione, salvo
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

  /* -------- AUTO -------- */

  function startAuto() {
    stopAuto();
    state.autoTimerId = setInterval(advanceChunk, state.autoSpeedMs);
    toggleAutoBtn.textContent = "⏸";
    toggleAutoBtn.classList.add("active");
  }

  function stopAuto() {
    if (state.autoTimerId) {
      clearInterval(state.autoTimerId);
      state.autoTimerId = null;
    }
    toggleAutoBtn.textContent = "▶ Auto";
    toggleAutoBtn.classList.remove("active");
  }

  /* -------- SALVATAGGIO PROGRESSO -------- */

  function saveProgress() {
    if (!state.bookKey) return;
    const data = {
      pageIndex: state.currentPageIndex,
      paragraphIndex: state.currentParagraphIndex,
      wordIndex: state.currentWordIndex
    };
    try {
      localStorage.setItem(state.bookKey, JSON.stringify(data));
    } catch (e) {
      // se lo storage è pieno, amen
      console.warn("Impossibile salvare i progressi:", e);
    }
  }

  /* -------- UTIL -------- */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
  }
});