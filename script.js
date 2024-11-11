// script.js

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('epubFile');
    const readerDiv = document.getElementById('reader');
    const startButton = document.getElementById('start');
    const pauseButton = document.getElementById('pause');
    const stopButton = document.getElementById('stop');
    const increaseSpeedButton = document.getElementById('increaseSpeed');
    const decreaseSpeedButton = document.getElementById('decreaseSpeed');
    const speedDisplay = document.getElementById('speedDisplay');
    const spinner = document.getElementById('spinner');
    const toggleNightModeBtn = document.getElementById('toggleNightMode');
    const tocSelect = document.getElementById('tocSelect');

    let wordIndex = 0;
    let intervalId;
    let speed = 5; // parole al secondo
    let isPaused = false;
    let spans = []; // Array globale di span.word
    let tocItems = []; // Array per l'indice del libro

    // Funzione per mostrare lo spinner
    function showSpinner() {
        spinner.style.display = 'block';
    }

    // Funzione per nascondere lo spinner
    function hideSpinner() {
        spinner.style.display = 'none';
    }

    // Aggiorna la visualizzazione della velocità
    function updateSpeedDisplay() {
        speedDisplay.textContent = speed;
    }

    updateSpeedDisplay();

    // Event listener per aumentare la velocità
    increaseSpeedButton.addEventListener('click', () => {
        if (speed < 20) {
            speed++;
            updateSpeedDisplay();
        }
    });

    // Event listener per diminuire la velocità
    decreaseSpeedButton.addEventListener('click', () => {
        if (speed > 1) {
            speed--;
            updateSpeedDisplay();
        }
    });

    // Evento per il caricamento del file EPUB
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.epub')) {
            showSpinner();
            try {
                const arrayBuffer = await file.arrayBuffer();
                const zip = await JSZip.loadAsync(arrayBuffer);
                const { content, toc } = await extractContent(zip);
                readerDiv.innerHTML = content;

                // Aggiorna l'array globale di spans
                spans = readerDiv.querySelectorAll('span.word');

                // Aggiungi event listener per permettere di iniziare la lettura da un punto specifico
                spans.forEach((span, index) => {
                    span.addEventListener('click', () => {
                        wordIndex = index;
                        clearHighlights();
                        span.classList.add('highlight');
                        // Scrolla verso la parola selezionata
                        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                });

                // Popola il menu a tendina con l'indice
                populateTOC(toc);

                hideSpinner();
            } catch (error) {
                console.error('Errore nel caricamento dell\'EPUB:', error);
                alert('Errore nel caricamento dell\'EPUB. Controlla la console per maggiori dettagli.');
                hideSpinner();
            }
        } else {
            alert('Per favore, carica un file EPUB valido.');
        }
    });

    // Evento per iniziare la lettura
    startButton.addEventListener('click', () => {
        if (spans.length === 0) {
            alert('Per favore, carica un file EPUB prima.');
            return;
        }

        isPaused = false;
        startHighlighting(wordIndex);
    });

    // Evento per mettere in pausa la lettura
    pauseButton.addEventListener('click', () => {
        isPaused = true;
        clearInterval(intervalId);
    });

    // Evento per fermare la lettura
    stopButton.addEventListener('click', () => {
        clearInterval(intervalId);
        clearHighlights();
        wordIndex = 0;
        isPaused = false;
    });

    // Evento per la modalità notte
    toggleNightModeBtn.addEventListener('click', () => {
        document.body.classList.toggle('night-mode');
    });

    // Evento per la selezione di un capitolo dal menu a tendina
    tocSelect.addEventListener('change', () => {
        const selectedWordIndex = parseInt(tocSelect.value);
        if (!isNaN(selectedWordIndex)) {
            wordIndex = selectedWordIndex;
            clearHighlights();
            const span = spans[wordIndex];
            if (span) {
                span.classList.add('highlight');
                span.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    // Funzione per iniziare la sottolineatura delle parole
    function startHighlighting(startIndex) {
        const interval = 1000 / speed;

        if (intervalId) {
            clearInterval(intervalId);
        }

        intervalId = setInterval(() => {
            if (isPaused) {
                clearInterval(intervalId);
                return;
            }
            // Rimuove l'highlight delle parole precedenti
            spans.forEach(span => span.classList.remove('highlight'));

            if (wordIndex < spans.length) {
                // Evidenzia le prossime 4 parole
                for (let i = 0; i < 4; i++) {
                    if (spans[wordIndex + i]) {
                        spans[wordIndex + i].classList.add('highlight');
                    }
                }
                // Scrolla verso la prima parola evidenziata
                spans[wordIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                wordIndex += 4; // Incrementa l'indice di 4 parole
            } else {
                clearInterval(intervalId);
                alert('Lettura completata!');
            }
        }, interval);
    }

    // Funzione per estrarre il contenuto e l'indice dall'EPUB
    async function extractContent(zip) {
        // Trova il percorso del file OPF (contenente il manifesto)
        const containerXML = await zip.file('META-INF/container.xml').async('string');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXML, 'text/xml');
        const rootfilePath = containerDoc.querySelector('rootfile').getAttribute('full-path');

        // Carica il file OPF
        const contentOPF = await zip.file(rootfilePath).async('string');
        const contentDoc = parser.parseFromString(contentOPF, 'text/xml');

        // Estrae i riferimenti ai file xhtml
        const spineItems = contentDoc.querySelectorAll('spine itemref');
        const manifestItems = contentDoc.querySelectorAll('manifest item');

        let fullText = '';
        let cumulativeWordCount = 0;
        tocItems = [];

        for (let itemRef of spineItems) {
            const idref = itemRef.getAttribute('idref');
            const item = Array.from(manifestItems).find(i => i.getAttribute('id') === idref);

            if (item) {
                const href = item.getAttribute('href');
                const mediaType = item.getAttribute('media-type');
                const filePath = resolvePath(rootfilePath, href);

                if (mediaType.includes('application/xhtml+xml') || mediaType.includes('text/html')) {
                    const fileContent = await zip.file(filePath).async('string');
                    const fileDoc = parser.parseFromString(fileContent, 'application/xhtml+xml');

                    // Gestisci le immagini
                    await handleImages(zip, fileDoc, filePath);

                    // Avvolgi le parole in span
                    const processedHTML = await wrapWordsInSpans(fileDoc.body.innerHTML);

                    // Mappa il capitolo all'indice delle parole
                    const wordCountBefore = cumulativeWordCount;
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = processedHTML;
                    const tempSpans = tempDiv.querySelectorAll('span.word');
                    cumulativeWordCount += tempSpans.length;

                    // Estrai i titoli dei capitoli
                    const chapterTitles = extractChapterTitles(fileDoc);
                    if (chapterTitles.length > 0) {
                        chapterTitles.forEach(title => {
                            tocItems.push({
                                title: title,
                                wordIndex: wordCountBefore
                            });
                        });
                    }

                    fullText += processedHTML;
                }
            }
        }

        return { content: fullText, toc: tocItems };
    }

    // Funzione per estrarre i titoli dei capitoli
    function extractChapterTitles(doc) {
        const titles = [];
        const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headings.forEach(heading => {
            const titleText = heading.textContent.trim();
            if (titleText) {
                titles.push(titleText);
            }
        });
        return titles;
    }

    // Funzione per popolare il menu a tendina dell'indice
    function populateTOC(tocItems) {
        tocSelect.innerHTML = '<option value="">Seleziona un capitolo</option>';
        tocItems.forEach((tocItem) => {
            const option = document.createElement('option');
            option.value = tocItem.wordIndex;
            option.textContent = tocItem.title;
            tocSelect.appendChild(option);
        });
    }

    // Funzione per gestire le immagini all'interno dei capitoli
    async function handleImages(zip, doc, basePath) {
        const images = doc.querySelectorAll('img');
        for (let img of images) {
            const src = img.getAttribute('src');
            if (src) {
                const imagePath = resolvePath(basePath, src);
                const imageFile = zip.file(imagePath);
                if (imageFile) {
                    const blob = await imageFile.async('blob');
                    const url = URL.createObjectURL(blob);
                    img.setAttribute('src', url);
                } else {
                    console.warn('Immagine non trovata:', imagePath);
                }
            }
        }
    }

    // Funzione per risolvere il percorso del file
    function resolvePath(basePath, relativePath) {
        const baseParts = basePath.split('/');
        baseParts.pop(); // Rimuove il nome del file
        const relativeParts = relativePath.split('/');

        for (let part of relativeParts) {
            if (part === '..') {
                baseParts.pop();
            } else if (part !== '.') {
                baseParts.push(part);
            }
        }

        return baseParts.join('/');
    }

    // Funzione per avvolgere ogni parola in uno span
    async function wrapWordsInSpans(htmlContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        // Funzione ricorsiva per attraversare tutti i nodi di testo
        function traverse(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const parentTag = node.parentNode.tagName.toLowerCase();
                // Evita di avvolgere parole all'interno di tag che non dovrebbero essere modificati
                const nonProcessTags = ['script', 'style', 'a', 'code', 'pre', 'img', 'svg'];
                if (nonProcessTags.includes(parentTag)) {
                    return;
                }

                const words = node.textContent.split(/(\s+)/); // Mantiene gli spazi
                const fragment = document.createDocumentFragment();

                words.forEach(word => {
                    if (/\s+/.test(word)) {
                        fragment.appendChild(document.createTextNode(word));
                    } else {
                        const span = document.createElement('span');
                        span.textContent = word;
                        span.classList.add('word');
                        fragment.appendChild(span);
                    }
                });

                node.parentNode.replaceChild(fragment, node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Evita di attraversare i nodi che non devono essere modificati
                const nonProcessTags = ['script', 'style', 'a', 'code', 'pre', 'img', 'svg'];
                const tagName = node.tagName.toLowerCase();
                if (nonProcessTags.includes(tagName)) {
                    return;
                }

                Array.from(node.childNodes).forEach(child => traverse(child));
            }
        }

        traverse(doc.body);

        return doc.body.innerHTML;
    }

    // Funzione per pulire tutti gli highlight
    function clearHighlights() {
        spans.forEach(span => span.classList.remove('highlight'));
    }
});
