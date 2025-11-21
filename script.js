// Lettore EPUB con evidenziatore a pastello “fluido”

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

  // Slider velocità:
  // 0 => 5000 ms (5s lentissimo)
  // 100 => 200 ms (0,2s veloce)
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
    currentWordIndex: 0,   // indice della prima parola evidenziata
    chunkSize: 4,          // quante parole max evidenziare
    autoTimerId: null,
    autoSpeedMs: sliderValueToMs(speedRange.value),
    bookLoaded: false,
  };

  // --- Event listeners ---

  fileInput.addEventListener("change", handleFileChange);

  prevPageBtn.addEventListener("click", () => changePage(-1));
  nextPageBtn.addEventListener("click", () => changePage(1));

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
      startAuto(); // riavvia con la nuova velocità
    }
  });

  // Barra spaziatrice = play/pausa
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

  // --- Funzioni principali ---

  async function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    resetState();
    statusEl.textContent = `Caricamento di "${file.name}"...`;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const paragraphs = await extractParagraphsFromEpub(arrayBuffer);

      if (!paragraphs.length) {
        throw new Error("Nessun testo leggibile trovato nell'EPUB.");
      }

      buildPages(paragraphs);
      renderPage(0);

      state.bookLoaded = true;
      statusEl.textContent = `File caricato: ${file.name} • Paragrafi: ${paragraphs.length}`;
    } catch (err) {
      console.error(err);
      pageContainer.innerHTML = `
        <div class="page-inner">
          <div class="placeholder">
            <h1>Errore di lettura ⚠️</h1>
            <p>Non sono riuscito a leggere questo EPUB.</p>
            <p>Messaggio: <code>${escapeHtml(err.message || String(err))}</code></p>
          </div>
        </div>
      `;
      statusEl.textContent = "Errore: impossibile leggere il file. Forse non è un EPUB valido.";
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

    pageContainer.innerHTML = `
      <div class="page-inner">
        <div class="placeholder">
          <h1>Benvenuto 👋</h1>
          <p>Carica un file <strong>.epub</strong> dal pulsante in alto per iniziare a leggere.</p>
          <p>Il paragrafo che stai leggendo verrà illuminato, con <strong>4 parole alla volta</strong> evidenziate con un effetto evidenziatore pastello.</p>
        </div>
      </div>
    `;

    pageIndicator.textContent = `0 / 0`;
  }

  // Estrae i paragrafi dal file EPUB usando JSZip + XML
  async function extractParagraphsFromEpub(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);

    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) {
      throw new Error("File META-INF/container.xml non trovato (EPUB non valido?).");
    }

    const parser = new DOMParser();
    const containerText = await containerFile.async("string");
    const containerDoc = parser.parseFromString(containerText, "application/xml");

    const rootfileEl = containerDoc.querySelector("rootfile");
    if (!rootfileEl) {
      throw new Error("rootfile non trovato nel container.xml.");
    }

    const opfPath = rootfileEl.getAttribute("full-path");
    if (!opfPath) {
      throw new Error("Percorso OPF non valido.");
    }

    const opfFile = zip.file(opfPath);
    if (!opfFile) {
      throw new Error(`File OPF non trovato: ${opfPath}`);
    }

    const opfText = await opfFile.async("string");
    const opfDoc = parser.parseFromString(opfText, "application/xml");

    const manifestItems = {};
    opfDoc.querySelectorAll("manifest > item").forEach((item) => {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      const mediaType = item.getAttribute("media-type") || "";
      if (id && href && mediaType.includes("html")) {
        manifestItems[id] = href;
      }
    });

    const spineHrefs = [];
    opfDoc.querySelectorAll("spine > itemref").forEach((ref) => {
      const idref = ref.getAttribute("idref");
      if (idref && manifestItems[idref]) {
        spineHrefs.push(manifestItems[idref]);
      }
    });

    if (!spineHrefs.length) {
      throw new Error("Spine vuota: nessun capitolo da leggere.");
    }

    const paragraphs = [];
    for (const href of spineHrefs) {
      const fullPath = resolveItemPath(opfPath, href);
      const chapterFile = zip.file(fullPath);
      if (!chapterFile) continue;

      const xhtml = await chapterFile.async("string");
      const doc = parser.parseFromString(xhtml, "application/xhtml+xml");
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

  function resolveItemPath(opfPath, href) {
    const baseDir = opfPath.includes("/")
      ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
      : "";
    const fakeBase = "http://example.com/" + baseDir;
    const url = new URL(href, fakeBase);
    return url.pathname.replace(/^\/+/, "");
  }

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

  function renderPage(pageIndex) {
    if (!state.pages.length) return;
    if (pageIndex < 0 || pageIndex >= state.pages.length) return;

    state.currentPageIndex = pageIndex;
    state.currentParagraphIndex = 0;
    state.currentWordIndex = 0;

    const paras = state.pages[pageIndex];

    pageContainer.innerHTML = `<div class="page-inner"></div>`;
    const inner = pageContainer.querySelector(".page-inner");

    paras.forEach((text, idx) => {
      const p = document.createElement("p");
      p.className = "book-paragraph";
      p.dataset.paragraphIndex = String(idx);
      wrapWordsInParagraph(p, text);

      p.addEventListener("click", () => {
        stopAuto();
        setActiveParagraph(idx);
      });

      inner.appendChild(p);
    });

    setActiveParagraph(0);
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
    renderPage(newIndex);
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

  // --- Highlight fluido + frasi -------------------------------------------------

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

    const clampedIndex = Math.max(0, Math.min(paragraphIndex, paras.length - 1));

    clearAllHighlights();
    paras.forEach((p) => p.classList.remove("active-paragraph"));

    const active = paras[clampedIndex];
    active.classList.add("active-paragraph");

    state.currentParagraphIndex = clampedIndex;
    state.currentWordIndex = 0;
    updateWordHighlight();
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
  }

  function goToNextParagraphStart() {
    const paras = pageContainer.querySelectorAll(".book-paragraph");
    if (state.currentParagraphIndex + 1 < paras.length) {
      setActiveParagraph(state.currentParagraphIndex + 1);
    } else if (state.currentPageIndex + 1 < state.pages.length) {
      renderPage(state.currentPageIndex + 1);
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
      renderPage(state.currentPageIndex - 1);
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

  // --- Auto evidenziatore ---

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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // etichetta iniziale velocità
  speedValue.textContent = (state.autoSpeedMs / 1000).toFixed(2) + " s";
});
