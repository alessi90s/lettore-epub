// script.js

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('epubFile');
    const readerDiv = document.getElementById('reader');
    const startButton = document.getElementById('start');
    const stopButton = document.getElementById('stop');
    const speedInput = document.getElementById('speed');

    let book;
    let rendition;
    let currentWords = [];
    let wordIndex = 0;
    let intervalId;

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.epub')) {
            const reader = new FileReader();
            reader.onload = function(event) {
                const arrayBuffer = event.target.result;
                book = ePub(arrayBuffer);
                rendition = book.renderTo("reader", {
                    width: "100%",
                    height: "100%",
                });
                rendition.display();
            };
            reader.readAsArrayBuffer(file);
        } else {
            alert('Per favore, carica un file EPUB valido.');
        }
    });

    startButton.addEventListener('click', () => {
        if (!book) {
            alert('Per favore, carica un file EPUB prima.');
            return;
        }

        // Recupera tutto il testo
        book.loaded.spine.all().then((spineItems) => {
            let fullText = '';
            const promises = spineItems.map(item => item.load()).map(c => c.then(section => {
                fullText += section.document.body.innerText + ' ';
                item.unload();
            }));
            Promise.all(promises).then(() => {
                // Suddivide il testo in parole
                currentWords = fullText.split(/\s+/);
                wordIndex = 0;
                // Inizia la sottolineatura
                startHighlighting();
            });
        });
    });

    stopButton.addEventListener('click', () => {
        clearInterval(intervalId);
    });

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
                spans[wordIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                wordIndex++;
            } else {
                clearInterval(intervalId);
            }
        }, interval);
    }
});
