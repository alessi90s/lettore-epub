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

    let wordIndex = 0;
    let intervalId;
    let speed = 5; // parole al secondo
    let isPaused = false;
    let spans = []; // Array globale di span.word

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
                const content = await extractContent(zip);
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

    // Funzione per estrarre il contenuto dall'EPUB
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

        for (let itemRef of spineItems) {
            const idref = itemRef.getAttribute('idref');
            const item = Array.from(manifestItems).find(i => i.getAttribute('id') === idref);

            if (item) {
                const href = item.getAttribute('href');
                const mediaType = item.getAttribute('media-type');
                const filePath = resolvePath(rootfilePath, href);

                if (mediaType.includes('application/xhtml+xml') || mediaType.includes('text/html')) {
                    const fileContent = await
