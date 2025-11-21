// Lettore EPUB con evidenziatore a pastello

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

  const state = {
    pages: [],
    currentPageIndex: 0,
    currentParagraphIndex: 0,
    currentWordIndex: 0,
    chunkSize: 4,
    autoTimerId: null,
    autoSpeedMs: Number(speedRange.value),
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
    state.autoSpeedMs = Number(e.target.value);
    speedValue.textContent = (state.autoSpeedMs / 1000).toFixed(1) + " s";
    if (state.autoTimerId) {
      startAuto(); // restart per applicare la nuova velocità
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
        <div class="placeholder">
          <h1>Errore di lettura ⚠️</h1>
          <p>Non sono riuscito a leggere questo EPUB.</p>
          <p>Messaggio: <code>${escapeHtml(err.message || String(err))}</code></p>
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
    pageContainer.innerHTML = "";
    pageIndicator.textContent = "Pagina 0 / 0";
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

    // Manifest: id -> href
    const manifestItems = {};
    opfDoc.querySelectorAll("manifest > item").forEach((item) => {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      const mediaType = item.getAttribute("media-type") || "";
      if (id && href && mediaType.includes("html")) {
        manifestItems[id] = href;
      }
    });

    // Spine: ordine di lettura
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

    pageContainer.innerHTML = "";

    const inner = document.createElement("div");
    inner.className = "page-inner";

    const paras = state.pages[pageIndex];
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

    pageContainer.appendChild(inner);
    setActiveParagraph(0);
    updatePageIndicator();
  }

  function updatePageIndicator() {
    const total = state.pages.length;
    const current = total ? state.currentPageIndex + 1 : 0;
    pageIndicator.textContent = `Pagina ${current} / ${total}`;
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

  // NON facciamo più scrollIntoView → il testo non si muove
  function setActiveParagraph(paragraphIndex) {
    const paras = pageContainer.querySelectorAll(".book-paragraph");
    if (!paras.length) return;

    const clampedIndex = Math.max(0, Math.min(paragraphIndex, paras.length - 1));

    paras.forEach((p) => p.classList.remove("active-paragraph"));
    const active = paras[clampedIndex];
    if (!active) return;

    active.classList.add("active-paragraph");
    state.currentParagraphIndex = clampedIndex;
    state.currentWordIndex = 0;
    updateWordHighlight();
  }

  function updateWordHighlight() {
    const active = pageContainer.querySelector(".book-paragraph.active-paragraph");
    if (!active) return;

    const words = active.querySelectorAll(".word");
    words.forEach((w) => w.classList.remove("word-highlight"));

    if (!words.length) return;

    const start = Math.max(0, Math.min(state.currentWordIndex, words.length - 1));
    const end = Math.min(start + state.chunkSize, words.length);

    for (let i = start; i < end; i++) {
      words[i].classList.add("word-highlight");
    }
  }

  function advanceChunk() {
    const active = pageContainer.querySelector(".book-paragraph.active-paragraph");
    if (!active) return;

    const words = active.querySelectorAll(".word");
    if (!words.length) return;

    if (state.currentWordIndex + state.chunkSize < words.length) {
      state.currentWordIndex += state.chunkSize;
      updateWordHighlight();
    } else {
      const paras = pageContainer.querySelectorAll(".book-paragraph");
      if (state.currentParagraphIndex + 1 < paras.length) {
        setActiveParagraph(state.currentParagraphIndex + 1);
      } else if (state.currentPageIndex + 1 < state.pages.length) {
        renderPage(state.currentPageIndex + 1);
      } else {
        stopAuto();
      }
    }
  }

  function previousChunk() {
    const active = pageContainer.querySelector(".book-paragraph.active-paragraph");
    if (!active) return;

    const words = active.querySelectorAll(".word");
    if (!words.length) return;

    if (state.currentWordIndex - state.chunkSize >= 0) {
      state.currentWordIndex -= state.chunkSize;
      updateWordHighlight();
    } else {
      const paras = pageContainer.querySelectorAll(".book-paragraph");
      if (state.currentParagraphIndex - 1 >= 0) {
        setActiveParagraph(state.currentParagraphIndex - 1);
        const newActive = pageContainer.querySelector(".book-paragraph.active-paragraph");
        const newWords = newActive ? newActive.querySelectorAll(".word") : [];
        if (newWords.length) {
          state.currentWordIndex = Math.max(0, newWords.length - state.chunkSize);
          updateWordHighlight();
        }
      } else if (state.currentPageIndex - 1 >= 0) {
        renderPage(state.currentPageIndex - 1);
        const parasNew = pageContainer.querySelectorAll(".book-paragraph");
        if (parasNew.length) {
          setActiveParagraph(parasNew.length - 1);
          const newActive = pageContainer.querySelector(".book-paragraph.active-paragraph");
          const newWords = newActive ? newActive.querySelectorAll(".word") : [];
          if (newWords.length) {
            state.currentWordIndex = Math.max(0, newWords.length - state.chunkSize);
            updateWordHighlight();
          }
        }
      }
    }
  }

  function startAuto() {
    stopAuto();
    state.autoTimerId = setInterval(advanceChunk, state.autoSpeedMs);
    toggleAutoBtn.textContent = "⏸ Pausa evidenziatore";
    toggleAutoBtn.classList.add("active");
  }

  function stopAuto() {
    if (state.autoTimerId) {
      clearInterval(state.autoTimerId);
      state.autoTimerId = null;
    }
    toggleAutoBtn.textContent = "▶ Auto evidenziatore";
    toggleAutoBtn.classList.remove("active");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  speedValue.textContent = (state.autoSpeedMs / 1000).toFixed(1) + " s";
});
