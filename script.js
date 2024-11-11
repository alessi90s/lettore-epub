// script.js

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('epubFile');
    const readerDiv = document.getElementById('reader');
    const startButton = document.getElementById('start');
    const stopButton = document.getElementById('stop');
    const speedInput = document.getElementById('speed');
    const spinner = document.getElementById('spinner');

    let book;
    let rendition;
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

    // Test di caricamento di ePub.js
    if (typeof ePub === 'undefined') {
        console.error('ePub.js non è stato caricato correttamente.');
        alert('Errore: ePub.js non è stato caricato correttamente.');
        return;
    } else {
        console.log('ePub.js caricato correttamente.');
    }

    // Evento per il caricamento del file EPUB
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.epub')) {
            // Pulisce eventuali letture precedenti
            if (rendition) {
                rendition.destroy();
                readerDiv.innerHTML = '';
            }

            const reader = new FileReader();
            reader.onload = function(event) {
                const arrayBuffer = event.target.result;
                try {
                    book = ePub(arrayBuffer);
                    rendition = book.renderTo("reader", {
                        width: "100%",
                        height: "100%",
                    });

                    rendition.display().then(() => {
                        console.log('EPUB caricato correttamente.');
                        alert('EPUB caricato correttamente!');
                    }).catch(err => {
                        console.error('Errore durante la visualizzazione:', err);
                        alert('Errore durante la visualizzazione dell\'EPUB. Controlla la console per maggiori dettagli.');
                    });
                } catch (error) {
                    console.error('Errore nell\'inizializzazione di ePub.js:', error);
                    alert('Errore nell\'inizializzazione di ePub.js. Controlla la console per maggiori dettagli.');
                }
            };
            reader.onerror = function(error) {
                console.error('Errore nella lettura del file:', error);
                alert('Errore nella lettura del file EPUB.');
            };
            reader.readAsArrayBuffer(file);
        } else {
            alert('Per favore, carica un file EPUB valido.');
        }
    });

    // Evento per iniziare la lettura
    startButton.addEventListener('click', () => {
        if (!book) {
            alert('Per favore, carica un file EPUB prima.');
            return;
        }

        showSpinner();

        // Recupera tutto il testo
        book.ready.then(() => {
            const spineItems = book.spine.spineItems;
            let fullText = '';
            const promises = spineItems.map(item => {
                return book.load(item).then(contents => {
                    // Estrarre solo il testo visibile
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(contents.document.documentElement.innerHTML, 'text/html');
                    return doc.body.innerText;
                }).catch(err => {
                    console.error(`Errore nel caricamento della sezione ${item.id}:`, err);
                    return '';
                });
            });

            Promise.all(promises).then(texts => {
                fullText = texts.join(' ');
                // Suddivide il testo in parole
                currentWords = fullText.split(/\s+/).filter(word => word.length > 0);
                wordIndex = 0;
                // Inizia la sottolineatura
                startHighlighting();
                hideSpinner();
            }).catch(err => {
                console.error('Errore nel recupero del testo:', err);
                alert('Errore nel recupero del testo dell\'EPUB. Controlla la console per maggiori dettagli.');
                hideSpinner();
            });
        }).catch(err => {
            console.error('Errore nel preparare il libro:', err);
            alert('Errore nel preparare il libro. Controlla la console per maggiori dettagli.');
            hideSpinner();
        });
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
});
