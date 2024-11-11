// script.js

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('epubFile');
    const readerDiv = document.getElementById('reader');
    const startButton = document.getElementById('start');
    const stopButton = document.getElementById('stop');
    const speedInput = document.getElementById('speed');
    const spinner = document.getElementById('spinner');

    let currentWords = [];
    let wordIndex = 0;
    let intervalId;

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
                const htmlContent = await extractHTMLContent(zip);
                const processedHTML = await wrapWordsInSpans(htmlContent);
                readerDiv.innerHTML = processedHTML;
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
        if (!readerDiv.innerHTML.trim()) {
            alert('Per favore, carica un file EPUB prima.');
            return;
        }

        startHighlighting();
    });

    // Evento per fermare la lettura
    stopButton.addEventListener('click', () => {
        clearInterval(intervalId);
        // Rimuove tutte le sottolineature
        const spans = readerDiv.querySelectorAll('span');
        spans.forEach(span => span.classList.remove('highlight'));
        wordIndex = 0;
    });

    // Funzione per iniziare la sottolineatura delle parole
    function startHighlighting() {
        const speed = parseInt(speedInput.value) || 5; // parole al secondo
        const interval = 1000 / speed;

        const spans = readerDiv.querySelectorAll('span.word');
        wordIndex = 0;

        intervalId = setInterval(() => {
            if (wordIndex > 0) {
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

    // Funzione per estrarre il contenuto HTML dall'EPUB
    async function extractHTMLContent(zip) {
        // Trova il percorso del file OPF (contenente il manifesto)
        const containerXML = await zip.file('META-INF/container.xml').async('string');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXML, 'text/xml');
        const rootfilePath = containerDoc.querySelector('rootfile').getAttribute('full-path');

        // Carica il file OPF
        const contentOPF = await zip.file(rootfilePath).async('string');
        const contentDoc = parser.parseFromString(contentOPF, 'text/xml');

        // Estrae i riferimenti ai file xhtml
        const itemRefs = contentDoc.querySelectorAll('spine itemref');
        const items = contentDoc.querySelectorAll('manifest item');

        let fullHTML = '';

        for (let itemRef of itemRefs) {
            const idref = itemRef.getAttribute('idref');
            const item = Array.from(items).find(i => i.getAttribute('id') === idref);

            if (item) {
                const href = item.getAttribute('href');
                const filePath = resolvePath(rootfilePath, href);
                const fileContent = await zip.file(filePath).async('string');
                fullHTML += fileContent + '<hr>'; // Separatore tra capitoli
            }
        }

        return fullHTML;
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

    // Funzione per avvolgere ogni parola in un span
    async function wrapWordsInSpans(htmlContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        // Funzione ricorsiva per attraversare tutti i nodi di testo
        function traverse(node) {
            if (node.nodeType === Node.TEXT_NODE) {
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
            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
                node.childNodes.forEach(child => traverse(child));
            }
        }

        traverse(doc.body);

        return doc.body.innerHTML;
    }
});
