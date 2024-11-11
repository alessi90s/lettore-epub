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
                const fullText = await extractFullText(zip);
                currentWords = fullText.split(/\s+/).filter(word => word.length > 0);
                wordIndex = 0;
                alert('EPUB caricato correttamente!');
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
        if (currentWords.length === 0) {
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

        readerDiv.innerHTML = ''; // Pulisce l'area del lettore
        currentWords.forEach(word => {
            const span = document.createElement('span');
            span.textContent = word + ' ';
            readerDiv.appendChild(span);
        });

        const spans = readerDiv.querySelectorAll('span');

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

    // Funzione per estrarre il testo completo dall'EPUB
    async function extractFullText(zip) {
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

        let fullText = '';

        for (let itemRef of itemRefs) {
            const idref = itemRef.getAttribute('idref');
            const item = Array.from(items).find(i => i.getAttribute('id') === idref);

            if (item) {
                const href = item.getAttribute('href');
                const filePath = resolvePath(rootfilePath, href);
                const fileContent = await zip.file(filePath).async('string');
                const fileDoc = parser.parseFromString(fileContent, 'text/html');
                const bodyText = fileDoc.body.innerText;
                fullText += bodyText + ' ';
            }
        }

        return fullText;
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
});

