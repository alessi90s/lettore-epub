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
    chunkSize: 4, // parole max
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

  // Calcola boundaries di chunk per un paragrafo:
  // max chunkSize parole, ma si ferma PRIMA se trova . ! ? …
  function getWordsAndBoundaries(activeParagraph) {
    const words = activeParagraph.querySelectorAll(".word");
    const boundaries = [0];
    let count = 0;

    for (let i = 0; i < words.length; i++) {
      count++;
      const text = words[i].textContent || "";
      const hasEndPunct = /[.!?…]/.test(text);

      if (count >= state.chunkSize || hasEndPunct) {
        boundaries.push(i + 1); // prossimo inizio
        count = 0;
      }
    }

    if (boundaries[boundaries.length - 1] !== words.length) {
      boundaries.push(words.length);
    }

    return { words, boundaries };
  }

  // Seleziona il paragrafo attivo
  function setActiveParagraph(paragraphIndex) {
    const paras = pageContainer.querySelectorAll(".book-paragraph");
    if (!paras.length) return;

    const clampedIndex = Math.max(0, Math.min(paragraphIndex, paras.length - 1));

    // pulisco tutti gli highlight ovunque
    pageContainer.querySelectorAll(".word-highlight").forEach((el) => {
      el.classList.remove("word-highlight");
    });

    paras.forEach((p) => p.classList.remove("active-paragraph"));
    const active = paras[clampedIndex];
    if (!active) return;

    active.classList.add("active-paragraph");
    state.currentParagraphIndex = clampedIndex;
    state.currentWordIndex = 0;
    updateWordHighlight();
  }

  // Aggiorna l'evidenziatore sul blocco corrente, fermandosi al punto
  function updateWordHighlight() {
    const active = pageContainer.querySelector(".book-paragraph.active-paragraph");
    if (!active) return;

    const { words, boundaries } = getWordsAndBoundaries(active);

    // pulisco qualunque highlight residuo nella pagina
    pageContainer.querySelectorAll(".word-highlight").forEach((el) => {
      el.classList.remove("word-highlight");
    });

    if (!words.length) return;

    let start = state.currentWordIndex || 0;
    if (start >= words.length) {
      start = boundaries[Math.max(0, boundaries.length - 2)] || 0;
    }

    // trovo il boundary che contiene questo start
    let boundaryIndex = 0;
    for (let i = 0; i < boundaries.length - 1; i++) {
      if (boundaries[i] <= start && start < boundaries[i + 1]) {
        boundaryIndex = i;
        break;
      }
    }

    const chunkStart = boundaries[boundaryIndex];
    const chunkEnd = boundaries[boundaryIndex + 1];

    state.currentWordIndex = chunkStart;

    for (let i = chunkStart; i < chunkEnd; i++) {
      words[i].classList.add("word-highlight");
    }
  }

  function advanceChunk() {
    const active = pageContainer.querySelector(".book-paragraph.active-paragraph");
    if (!active) return;

    const { words, boundaries } = getWordsAndBoundaries(active);
    if (!words.length) return;

    let start = state.currentWordIndex || 0;
    if (start >= words.length) {
      start = boundaries[Math.max(0, boundaries.length - 2)] || 0;
    }

    // trovo l'indice del boundary attuale
    let boundaryIndex = 0;
    for (let i = 0; i < boundaries.length - 1; i++) {
      if (boundaries[i] === start) {
        boundaryIndex = i;
        break;
      }
      if (boundaries[i] < start && start < boundaries[i + 1]) {
        boundaryIndex = i;
        break;
      }
    }

    // se non siamo all'ultimo chunk del paragrafo → vai al prossimo chunk
    if (boundaryIndex < boundaries.length - 2) {
      const nextStart = boundaries[boundaryIndex + 1];
      if (nextStart < words.length) {
        state.currentWordIndex = nextStart;
        updateWordHighlight();
        return;
      }
    }

    // altrimenti: fine paragrafo → passo al successivo
    const paras = pageContainer.querySelectorAll(".book-paragraph");
    if (state.currentParagraphIndex + 1 < paras.length) {
      setActiveParagraph(state.currentParagraphIndex + 1);
    } else if (state.currentPageIndex + 1 < state.pages.length) {
      // fine pagina -> pagina successiva
      renderPage(state.currentPageIndex + 1);
    } else {
      // fine libro
      stopAuto();
    }
  }

  function previousChunk() {
    const active = pageContainer.querySelector(".book-paragraph.active-paragraph");
    if (!active) return;

    const { words, boundaries } = getWordsAndBoundaries(active);
    if (!words.length) return;

    let start = state.currentWordIndex || 0;
    if (start > words.length) {
      start = boundaries[Math.max(0, boundaries.length - 2)] || 0;
    }

    // trovo l'indice del boundary attuale
    let boundaryIndex = 0;
    for (let i = 0; i < boundaries.length - 1; i++) {
      if (boundaries[i] === start) {
        boundaryIndex = i;
        break;
      }
      if (boundaries[i] < start && start < boundaries[i + 1]) {
        boundaryIndex = i;
        break;
      }
    }

    // se c'è un chunk prima nello stesso paragrafo
    if (boundaryIndex > 0) {
      const prevStart = boundaries[boundaryIndex - 1];
      state.currentWordIndex = prevStart;
      updateWordHighlight();
      return;
    }

    // altrimenti passo al paragrafo precedente
    const paras = pageContainer.querySelectorAll(".book-paragraph");
    if (state.currentParagraphIndex - 1 >= 0) {
      // vai al paragrafo precedente e metti l'ultimo chunk di quel paragrafo
      const prevIndex = state.currentParagraphIndex - 1;
      state.currentParagraphIndex = prevIndex;
      const prevPara = paras[prevIndex];
      paras.forEach((p) => p.classList.remove("active-paragraph"));
      prevPara.classList.add("active-paragraph");

      const { words: prevWords, boundaries: prevBoundaries } =
        getWordsAndBoundaries(prevPara);
      if (prevWords.length) {
        const lastStart = prevBoundaries[Math.max(0, prevBoundaries.length - 2)];
        state.currentWordIndex = lastStart || 0;
        updateWordHighlight();
      }
    } else if (state.currentPageIndex - 1 >= 0) {
      // pagina precedente, ultimo paragrafo/ultimo chunk
      renderPage(state.currentPageIndex - 1);
      const newParas = pageContainer.querySelectorAll(".book-paragraph");
      if (newParas.length) {
        const lastIdx = newParas.length - 1;
        state.currentParagraphIndex = lastIdx;
        newParas.forEach((p) => p.classList.remove("active-paragraph"));
        const lastPara = newParas[lastIdx];
        lastPara.classList.add("active-paragraph");

        const { words: lastWords, boundaries: lastBoundaries } =
          getWordsAndBoundaries(lastPara);
        if (lastWords.length) {
          const lastStart =
            lastBoundaries[Math.max(0, lastBoundaries.length - 2)];
          state.currentWordIndex = lastStart || 0;
          updateWordHighlight();
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
