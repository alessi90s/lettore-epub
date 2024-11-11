// script.js

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('epubFile');
    const readerDiv = document.getElementById('reader');
    const startButton = document.getElementById('start');
    const stopButton = document.getElementById('stop');
    const speedInput = document.getElementById('speed');
    const spinner = document.getElementById('spinner');
    const tocList = document.getElementById('tocList');
    const toggleNightModeBtn = document.getElementById('toggleNightMode');

    let wordIndex = 0;
    let intervalId;
    let chapters = []; // Array di {title, wordIndex}
    let spans = []; // Array globale di span.word

    // Funzione per mostrare lo spinner
    function showSpinner() {
        spinner.style.display = 'block';
    }

    // Funzione per nascondere lo spinner
    function hideSpinner() {
        spinner.style.display = 'none';
    }

    // Evento per il caricamento del file EPUB
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.epub')) {
            showSpinner();
            try {
                const arrayBuffer = await file.arrayBuffer();
                const zip = await JSZip.loadAsync(arrayBuffer);
                const { chapters: extractedChapters, cssContent } = await extractChaptersAndCSS(zip);
                chapters = extractedChapters; // Salva i capitoli

                const fullHTML = chapters.map(chapter => chapter.htmlContent).join('<hr>'); // Separa con <hr>

                const processedHTML = await wrapWordsInSpans(fullHTML);
                applyCSS(cssContent);
                readerDiv.innerHTML = processedHTML;

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

                // Costruisci il TOC
                buildTOC();

                // Mappa i capitoli agli indici delle parole
                mapChaptersToWordIndices();

                hideSpinner();
                alert('EPUB caricato correttamente!');
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

        startHighlighting(wordIndex); // Inizia dalla posizione corrente
    });

    // Evento per fermare la lettura
    stopButton.addEventListener('click', () => {
        clearInterval(intervalId);
        // Rimuove tutte le sottolineature
        clearHighlights();
        wordIndex = 0;
    });

    // Evento per la modalità notte
    toggleNightModeBtn.addEventListener('click', () => {
        document.body.classList.toggle('night-mode');
        readerDiv.classList.toggle('night-mode');
    });

    // Funzione per iniziare la sottolineatura delle parole
    function startHighlighting(startIndex) {
        const speed = parseInt(speedInput.value) || 5; // parole al secondo
        const interval = 1000 / speed;

        if (intervalId) {
            clearInterval(intervalId);
        }

        // Inizia a evidenziare le parole
        intervalId = setInterval(() => {
            if (wordIndex > startIndex) {
                spans[wordIndex - 1].classList.remove('highlight');
            }
            if (wordIndex < spans.length) {
                spans[wordIndex].classList.add('highlight');
                // Scrolla verso la parola evidenziata
                spans[wordIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                wordIndex++;
            } else {
                clearInterval(intervalId);
                alert('Lettura completata!');
            }
        }, interval);
    }

    // Funzione per estrarre i capitoli e i CSS dall'EPUB
    async function extractChaptersAndCSS(zip) {
        // Trova il percorso del file OPF (contenente il manifesto)
        const containerXML = await zip.file('META-INF/container.xml').async('string');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXML, 'text/xml');
        const rootfilePath = containerDoc.querySelector('rootfile').getAttribute('full-path');

        // Carica il file OPF
        const contentOPF = await zip.file(rootfilePath).async('string');
        const contentDoc = parser.parseFromString(contentOPF, 'text/xml');

        // Estrae i riferimenti ai file xhtml e css
        const spineItems = contentDoc.querySelectorAll('spine itemref');
        const manifestItems = contentDoc.querySelectorAll('manifest item');

        let chapters = [];
        let cssCollection = [];

        for (let itemRef of spineItems) {
            const idref = itemRef.getAttribute('idref');
            const item = Array.from(manifestItems).find(i => i.getAttribute('id') === idref);

            if (item) {
                const href = item.getAttribute('href');
                const mediaType = item.getAttribute('media-type');
                const filePath = resolvePath(rootfilePath, href);

                if (mediaType === 'application/xhtml+xml' || mediaType === 'application/xhtml' || mediaType === 'text/html') {
                    const fileContent = await zip.file(filePath).async('string');
                    const fileDoc = parser.parseFromString(fileContent, 'text/html');

                    // Gestisci le immagini
                    await handleImages(zip, fileDoc, filePath);

                    // Estrai il titolo del capitolo
                    let title = '';
                    const titleTag = fileDoc.querySelector('title');
                    if (titleTag) {
                        title = titleTag.textContent.trim();
                    } else {
                        const h1 = fileDoc.querySelector('h1');
                        title = h1 ? h1.textContent.trim() : `Capitolo ${chapters.length + 1}`;
                    }

                    // Evita di aggiungere capitoli con titoli vuoti o duplicati
                    if (title && !chapters.some(ch => ch.title === title)) {
                        chapters.push({
                            title: title,
                            htmlContent: fileDoc.body.innerHTML
                        });
                    }
                }
            }
        }

        // Estrai i file CSS dal manifest
        const cssItems = Array.from(manifestItems).filter(item => item.getAttribute('media-type').includes('css'));
        for (let cssItem of cssItems) {
            const href = cssItem.getAttribute('href');
            const filePath = resolvePath(rootfilePath, href);
            const cssContent = await zip.file(filePath).async('string');
            cssCollection.push(cssContent);
        }

        return { chapters, cssContent: cssCollection };
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

    // Funzione per applicare i CSS estratti
    function applyCSS(cssCollection) {
        // Rimuovi eventuali CSS precedenti
        const existingStyles = readerDiv.querySelectorAll('style');
        existingStyles.forEach(style => style.remove());

        // Aggiungi i nuovi CSS
        cssCollection.forEach(css => {
            const style = document.createElement('style');
            style.textContent = css;
            readerDiv.appendChild(style);
        });
    }

    // Funzione per costruire il TOC
    function buildTOC() {
        tocList.innerHTML = ''; // Pulisci la lista
        chapters.forEach((chapter, index) => {
            const li = document.createElement('li');
            const button = document.createElement('button');
            button.textContent = chapter.title;
            button.addEventListener('click', () => {
                jumpToChapter(index);
            });
            li.appendChild(button);
            tocList.appendChild(li);
        });
    }

    // Funzione per mappare i capitoli agli indici delle parole
    function mapChaptersToWordIndices() {
        let cumulativeWordIndex = 0;

        chapters.forEach((chapter, index) => {
            // Crea un elemento temporaneo per trovare il primo span del capitolo
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = chapter.htmlContent;
            const tempSpans = tempDiv.querySelectorAll('span.word');

            if (tempSpans.length > 0) {
                const firstWord = tempSpans[0].textContent;

                // Cerca nel readerDiv il primo span che corrisponde al primo span del capitolo
                for (let i = cumulativeWordIndex; i < spans.length; i++) {
                    if (spans[i].textContent === firstWord) {
                        chapters[index].wordIndex = i;
                        cumulativeWordIndex = i;
                        break;
                    }
                }
            } else {
                chapters[index].wordIndex = cumulativeWordIndex;
            }
        });
    }

    // Funzione per saltare a un capitolo specifico
    function jumpToChapter(chapterIndex) {
        const chapter = chapters[chapterIndex];
        if (chapter.wordIndex !== undefined) {
            wordIndex = chapter.wordIndex;
            const span = spans[wordIndex];
            if (span) {
                // Rimuovi gli highlight precedenti
                clearHighlights();
                // Evidenzia la parola corrente
                span.classList.add('highlight');
                // Scrolla verso la parola evidenziata
                span.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    // Funzione per pulire tutti gli highlight
    function clearHighlights() {
        spans.forEach(span => span.classList.remove('highlight'));
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
});
