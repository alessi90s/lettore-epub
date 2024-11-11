// script.js

document.addEventListener('DOMContentLoaded', () => {
    // Riferimenti agli elementi del DOM
    const fileInput = document.getElementById('epubFile');
    const readerDiv = document.getElementById('reader');

    // Controlli di riproduzione
    const startButton = document.getElementById('start');
    const pauseButton = document.getElementById('pause');
    const stopButton = document.getElementById('stop');

    // Controlli di velocità
    const increaseSpeedButton = document.getElementById('increaseSpeed');
    const decreaseSpeedButton = document.getElementById('decreaseSpeed');
    const speedDisplay = document.getElementById('speedDisplay');

    // Selezione del numero di parole evidenziate
    const wordCountSelect = document.getElementById('wordCountSelect');

    // Selezione della dimensione del testo
    const fontSizeSelect = document.getElementById('fontSizeSelect');

    // Selezione del font
    const fontSelect = document.getElementById('fontSelect');

    // Selezione del colore dell'evidenziazione
    const highlightColorSelect = document.getElementById('highlightColor');

    // Selezione del tema
    const themeSelect = document.getElementById('themeSelect');

    // Controlli per spostare il testo
    const moveTextUpButton = document.getElementById('moveTextUp');
    const moveTextDownButton = document.getElementById('moveTextDown');

    // Spinner di caricamento
    const spinner = document.getElementById('spinner');

    // Selettore dell'indice
    const tocSelect = document.getElementById('tocSelect');

    // Variabili globali
    let wordIndex = 0;
    let intervalId;
    let speed = 200; // Velocità in parole per minuto (WPM)
    let isPaused = false;
    let spans = []; // Array di span.word
    let tocItems = []; // Array per l'indice del libro
    let wordCount = 3; // Numero di parole da evidenziare
    let fontSize = 18; // Dimensione del testo
    let highlightColor = '#fff9c4'; // Colore di default per l'evidenziazione
    let verticalOffset = 0; // Offset verticale per spostare il testo

    // Funzione per inizializzare i colori dell'evidenziazione
    function initializeHighlightColors() {
        const colors = [
            { name: 'Giallo', value: '#fff9c4' },
            { name: 'Arancione', value: '#ffcc80' },
            { name: 'Rosa', value: '#f8bbd0' },
            { name: 'Viola', value: '#e1bee7' },
            { name: 'Blu', value: '#bbdefb' },
            { name: 'Verde', value: '#c8e6c9' },
            { name: 'Lime', value: '#f0f4c3' },
            { name: 'Ambra', value: '#ffe082' },
            { name: 'Marrone', value: '#d7ccc8' },
            { name: 'Grigio', value: '#cfd8dc' },
            { name: 'Ciano', value: '#b2ebf2' },
            { name: 'Indaco', value: '#c5cae9' }
        ];

        colors.forEach(color => {
            const option = document.createElement('option');
            option.value = color.value;
            option.textContent = color.name;
            highlightColorSelect.appendChild(option);
        });

        // Imposta il colore di default
        highlightColorSelect.value = highlightColor;
    }

    // Funzione per inizializzare le opzioni della dimensione del testo
    function initializeFontSizeOptions() {
        for (let i = 8; i <= 32; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            if (i === fontSize) {
                option.selected = true;
            }
            fontSizeSelect.appendChild(option);
        }
    }

    // Chiamate alle funzioni di inizializzazione
    initializeHighlightColors();
    initializeFontSizeOptions();

    // Aggiorna il colore dell'evidenziazione nel CSS
    function updateHighlightColor() {
        const style = document.documentElement.style;
        style.setProperty('--highlight-color', highlightColorSelect.value);
    }

    // Aggiorna il tema
    function updateTheme() {
        document.body.className = themeSelect.value;
    }

    // Aggiorna la dimensione del testo
    function updateFontSize() {
        fontSize = parseInt(fontSizeSelect.value);
        readerDiv.style.fontSize = `${fontSize}px`;
        // Calcola l'altezza della linea basata sulla dimensione del testo
        const lineHeightRatio = 1.6; // Rapporto tra altezza della linea e dimensione del testo
        const lineHeightPx = fontSize * lineHeightRatio;
        readerDiv.style.lineHeight = `${lineHeightPx}px`;
        // Aggiorna la variabile CSS per l'altezza della linea
        readerDiv.style.setProperty('--line-height', `${lineHeightPx}px`);
    }

    // Aggiorna il font
    function updateFont() {
        readerDiv.style.fontFamily = fontSelect.value;
    }

    // Mostra lo spinner di caricamento
    function showSpinner() {
        spinner.style.display = 'block';
    }

    // Nascondi lo spinner di caricamento
    function hideSpinner() {
        spinner.style.display = 'none';
    }

    // Aggiorna la visualizzazione della velocità
    function updateSpeedDisplay() {
        speedDisplay.textContent = speed;
    }

    // Aggiornamenti iniziali
    updateHighlightColor();
    updateTheme();
    updateFontSize();
    updateFont();
    updateSpeedDisplay();

    // Event listener per aumentare la velocità
    increaseSpeedButton.addEventListener('click', () => {
        if (speed < 1000) { // Limite superiore
            speed += 10;
            updateSpeedDisplay();
            if (!isPaused) {
                restartHighlighting();
            }
        }
    });

    // Event listener per diminuire la velocità
    decreaseSpeedButton.addEventListener('click', () => {
        if (speed > 10) { // Limite inferiore
            speed -= 10;
            updateSpeedDisplay();
            if (!isPaused) {
                restartHighlighting();
            }
        }
    });

    // Event listener per cambiare il numero di parole
    wordCountSelect.addEventListener('change', () => {
        wordCount = parseInt(wordCountSelect.value);
    });

    // Event listener per spostare il testo verso l'alto
    moveTextUpButton.addEventListener('click', () => {
        verticalOffset -= 1; // Modifica l'offset a piacere
        readerDiv.style.transform = `translateY(${verticalOffset}px)`;
        // Imposta il background fisso per allineamento
        readerDiv.classList.add('background-fixed');
    });

    // Event listener per spostare il testo verso il basso
    moveTextDownButton.addEventListener('click', () => {
        verticalOffset += 1; // Modifica l'offset a piacere
        readerDiv.style.transform = `translateY(${verticalOffset}px)`;
        // Imposta il background fisso per allineamento
        readerDiv.classList.add('background-fixed');
    });

    // Rimuovi la classe 'background-fixed' quando l'utente scorre normalmente
    readerDiv.addEventListener('wheel', () => {
        readerDiv.classList.remove('background-fixed');
    });

    // Event listener per cambiare la dimensione del testo
    fontSizeSelect.addEventListener('change', () => {
        updateFontSize();
    });

    // Event listener per cambiare il font
    fontSelect.addEventListener('change', () => {
        updateFont();
    });

    // Event listener per cambiare il colore dell'evidenziazione
    highlightColorSelect.addEventListener('change', () => {
        highlightColor = highlightColorSelect.value;
        updateHighlightColor();
    });

    // Event listener per cambiare il tema
    themeSelect.addEventListener('change', () => {
        updateTheme();
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
                        // Avvia la lettura da questo punto
                        if (!isPaused) {
                            restartHighlighting();
                        }
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

        if (!isPaused) {
            wordIndex = 0;
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
                if (!isPaused) {
                    restartHighlighting();
                }
            }
        }
    });

    // Funzione per iniziare la sottolineatura delle parole
    function startHighlighting(startIndex) {
        const interval = (60000 * wordCount) / speed; // Calcola l'intervallo in millisecondi

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
                // Evidenzia le prossime N parole
                for (let i = 0; i < wordCount; i++) {
                    if (spans[wordIndex + i]) {
                        spans[wordIndex + i].classList.add('highlight');
                    }
                }
                // Scrolla verso la prima parola evidenziata
                spans[wordIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                wordIndex += wordCount; // Incrementa l'indice di N parole
            } else {
                clearInterval(intervalId);
                alert('Lettura completata!');
            }
        }, interval);
    }

    // Funzione per riavviare la lettura mantenendo la posizione attuale
    function restartHighlighting() {
        clearInterval(intervalId);
        startHighlighting(wordIndex);
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

                    // Avvolgi le parole in span e inserisci line breaks dopo i punti
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
        tocSelect.innerHTML = '<option value="">Indice</option>';
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

    // Funzione per avvolgere ogni parola in uno span e inserire line breaks dopo i punti
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

                // Inserisci un'interruzione di linea dopo ogni punto seguito da uno spazio
                const textContent = node.textContent.replace(/\. /g, '.\n');

                const words = textContent.split(/(\s+)/); // Mantiene gli spazi e le nuove linee

                const fragment = document.createDocumentFragment();

                words.forEach(word => {
                    if (word === '\n') {
                        fragment.appendChild(document.createElement('br'));
                    } else if (/\s+/.test(word)) {
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

    // Imposta il colore dell'evidenziazione tramite CSS Custom Property
    const style = document.createElement('style');
    style.innerHTML = `
        .word.highlight {
            background-color: var(--highlight-color) !important;
        }
    `;
    document.head.appendChild(style);

    // Funzione per inserire interruzioni di linea dopo i punti già gestita in wrapWordsInSpans()

});
