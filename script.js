
/* ==========================================
   SpeakTrack - Smart Speech Tracker
   Improved scrolling and speech recovery
   ========================================== */

const scriptInput = document.getElementById("scriptInput");
const languageSelect = document.getElementById("language");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const resetBtn = document.getElementById("resetBtn");

const statusBox = document.getElementById("status");
const wordCount = document.getElementById("wordCount");
const speechDisplay = document.getElementById("speechDisplay");
const progressText = document.getElementById("progressText");
const progressCount = document.getElementById("progressCount");
const progressBar = document.getElementById("progressBar");
const transcriptBox = document.getElementById("transcript");
const liveLabel = document.getElementById("liveLabel");
const liveIndicator = document.querySelector(".live-indicator");
const scrollBtn = document.getElementById("scrollBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");

// Application state
let originalText = "";
let scriptParts = [];
let scriptWords = [];

let currentIndex = 0;
let completedWords = new Set();
let recognition = null;
let recognitionActive = false;
let shouldListen = false;
let sessionStarted = false;

let recognizedHistory = [];
let interimText = "";
let restartTimer = null;
let lastScrollTime = 0;

// ------------------------------------------
// 1. Text processing
// ------------------------------------------

function normalizeWord(word) {
    return word
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[^\p{L}\p{N}']/gu, "")
        .replace(/^'+|'+$/g, "");
}

function extractWords(text) {
    return text.match(
        /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu
    ) || [];
}

function prepareScript() {
    originalText = scriptInput.value.trim();

    if (!originalText) {
        setStatus("Please paste your speech before starting.");
        return false;
    }

    // Keep punctuation and spaces for display.
    scriptParts = originalText.split(
        /([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)/gu
    );

    scriptWords = [];

    scriptParts.forEach((part, partIndex) => {
        if (
            /^[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*$/u.test(part)
        ) {
            scriptWords.push({
                text: part,
                normalized: normalizeWord(part),
                partIndex
            });
        }
    });

    currentIndex = 0;
    recognizedHistory = [];
    interimText = "";

    wordCount.textContent = `${scriptWords.length} words`;

    renderScript();
    updateProgress();
    scrollToCurrentWord();

    return true;
}

// ------------------------------------------
// 2. Render script and highlights
// ------------------------------------------

function renderScript() {
    if (!scriptWords.length) {
        speechDisplay.textContent =
            "Your speech will appear here.";
        return;
    }

    const wordPositions = new Map();

    scriptWords.forEach((word, index) => {
        wordPositions.set(word.partIndex, index);
    });

    speechDisplay.replaceChildren();

    scriptParts.forEach((part, partIndex) => {
        if (!wordPositions.has(partIndex)) {
            speechDisplay.appendChild(
                document.createTextNode(part)
            );
            return;
        }

        const wordIndex = wordPositions.get(partIndex);
        const span = document.createElement("span");

        span.classList.add("speech-word");
        span.dataset.index = wordIndex;
        span.textContent = part;

        if (completedWords.has(wordIndex)) {
    span.classList.add("done");
} else if (wordIndex === currentIndex) {
    span.classList.add("current");
    span.id = "currentSpeechWord";
} else {
    span.classList.add("remaining");
}

        speechDisplay.appendChild(span);
    });
}

function updateProgress() {
    const total = scriptWords.length;
    const completed = completedWords.size;

    const percentage = total
        ? Math.round((completed / total) * 100)
        : 0;

    progressText.textContent = `${percentage}% completed`;
    progressCount.textContent = `${completed} / ${total} words`;
    progressBar.style.width = `${percentage}%`;
}

// ------------------------------------------
// 3. Approximate word matching
// ------------------------------------------

function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let previous = Array.from(
        { length: b.length + 1 },
        (_, index) => index
    );

    for (let i = 1; i <= a.length; i++) {
        const current = [i];

        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;

            current[j] = Math.min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + cost
            );
        }

        previous = current;
    }

    return previous[b.length];
}

function wordsMatch(spoken, expected) {
    if (!spoken || !expected) return false;

    if (spoken === expected) return true;

    // Fuzzy matching is limited to Latin words.
    const latinWords = /^[a-z0-9']+$/i;

    if (
        latinWords.test(spoken) &&
        latinWords.test(expected) &&
        spoken.length >= 5 &&
        expected.length >= 5
    ) {
        return levenshteinDistance(spoken, expected) <= 1;
    }

    return false;
}

function findNextMatch(spokenWord, fromIndex) {
    // Search farther ahead when recognition misses words.
    const searchLimit = Math.min(
        scriptWords.length - 1,
        fromIndex + 30
    );

    for (let i = fromIndex; i <= searchLimit; i++) {
        if (
            wordsMatch(
                spokenWord,
                scriptWords[i].normalized
            )
        ) {
            return i;
        }
    }

    return -1;
}

// ------------------------------------------
// 4. Track recognized speech
// ------------------------------------------

function processFinalSpeech(text) {
    const spokenWords = extractWords(text);

    if (!spokenWords.length) return;

    let matchedAny = false;
    let recoveredSkippedWords = false;

    for (const word of spokenWords) {
        const normalized = normalizeWord(word);

        if (!normalized) continue;

        const matchIndex = findNextMatch(
            normalized,
            currentIndex
        );

        if (matchIndex !== -1) {
    if (matchIndex > currentIndex) {
        recoveredSkippedWords = true;
    }

    completedWords.add(matchIndex);
    currentIndex = matchIndex + 1;
    matchedAny = true;
}
    }

    if (!matchedAny) return;

    renderScript();
    updateProgress();
    scrollToCurrentWord();

    if (currentIndex >= scriptWords.length) {
        setStatus(
            "Speech tracking complete! You reached the end of your script."
        );
    } else if (recoveredSkippedWords) {
        setStatus(
            "Your place was recovered. Continue with the highlighted word."
        );
    } else {
        setStatus(
            "Speech detected. Your script is tracking your progress."
        );
    }
}

// ------------------------------------------
// 5. Speech recognition
// ------------------------------------------

function createRecognition() {
    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        setStatus(
            "Speech recognition is not supported. Please try Google Chrome."
        );
        return false;
    }

    recognition = new SpeechRecognition();

    recognition.lang = languageSelect.value;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        recognitionActive = true;
        setListeningUI(true);
        setStatus("Microphone active. Start speaking naturally.");
    };

    recognition.onresult = (event) => {
        interimText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text = result[0].transcript.trim();

            if (!text) continue;

            if (result.isFinal) {
                recognizedHistory.push(text);
                processFinalSpeech(text);
            } else {
                interimText += text + " ";
            }
        }

        const fullTranscript = [
            recognizedHistory.join(" "),
            interimText.trim()
        ].filter(Boolean).join(" ");

        transcriptBox.textContent =
            fullTranscript || "Listening for speech...";
    };

    recognition.onerror = (event) => {
        if (
            event.error === "not-allowed" ||
            event.error === "service-not-allowed"
        ) {
            shouldListen = false;
            setListeningUI(false);
            updateButtons();

            setStatus(
                "Microphone permission denied. Allow microphone access in Chrome settings."
            );
        } else if (event.error === "no-speech") {
            setStatus(
                "No speech detected. Continue when you are ready."
            );
        } else if (event.error === "network") {
            setStatus(
                "Speech recognition network error. Check your connection."
            );
        } else if (event.error !== "aborted") {
            setStatus(
                `Speech recognition issue: ${event.error}. Try resuming.`
            );
        }
    };

    recognition.onend = () => {
        recognitionActive = false;

        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }

        if (shouldListen) {
            restartTimer = setTimeout(() => {
                if (shouldListen && !recognitionActive) {
                    startRecognition();
                }
            }, 300);
        } else {
            setListeningUI(false);
        }
    };

    return true;
}

function startRecognition() {
    if (!recognition || !shouldListen || recognitionActive) {
        return;
    }

    try {
        recognition.start();
    } catch (error) {
        console.warn("Recognition start:", error.message);
    }
}

// ------------------------------------------
// 6. Controls
// ------------------------------------------

startBtn.addEventListener("click", () => {
    if (!prepareScript()) return;
    if (!createRecognition()) return;

    sessionStarted = true;
    shouldListen = true;

    scriptInput.readOnly = true;
    languageSelect.disabled = true;

    updateButtons();
    startRecognition();
});

pauseBtn.addEventListener("click", () => {
    shouldListen = false;

    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

    if (recognition && recognitionActive) {
        recognition.stop();
    }

    setListeningUI(false);
    updateButtons();
    setStatus("Paused. Your progress is saved. Resume when ready.");
});

resumeBtn.addEventListener("click", () => {
    if (!sessionStarted) return;

    shouldListen = true;
    updateButtons();
    startRecognition();
});

resetBtn.addEventListener("click", () => {
    shouldListen = false;

    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

    if (recognition) {
        recognition.onend = null;

        try {
            recognition.abort();
        } catch (error) {
            console.warn(error.message);
        }
    }

    recognition = null;
    recognitionActive = false;
    sessionStarted = false;

    originalText = "";
    scriptParts = [];
    scriptWords = [];
    currentIndex = 0;
    recognizedHistory = [];
    interimText = "";

    scriptInput.readOnly = false;
    languageSelect.disabled = false;

    speechDisplay.textContent =
        "Your speech will appear here. Paste your script above to begin.";

    transcriptBox.textContent =
        "Your recognized speech will appear here.";

    wordCount.textContent = "0 words";
    progressText.textContent = "0% completed";
    progressCount.textContent = "0 / 0 words";
    progressBar.style.width = "0%";

    setListeningUI(false);
    updateButtons();
    setStatus("Reset complete. Paste your script and start again.");
});

function updateButtons() {
    startBtn.disabled = sessionStarted;
    pauseBtn.disabled = !shouldListen;
    resumeBtn.disabled = !sessionStarted || shouldListen;
}

function setListeningUI(listening) {
    liveLabel.textContent = listening
        ? "LISTENING"
        : "NOT LISTENING";

    liveIndicator.classList.toggle("listening", listening);
}

function setStatus(message) {
    statusBox.textContent = message;
}

// ------------------------------------------
// 7. Smarter teleprompter scrolling
// ------------------------------------------

function scrollToCurrentWord() {
    const currentWord = document.getElementById(
        "currentSpeechWord"
    );

    if (!currentWord) return;

    // Avoid repeatedly interrupting smooth scrolling.
    const now = Date.now();

    if (now - lastScrollTime < 250) return;

    lastScrollTime = now;

    requestAnimationFrame(() => {
        currentWord.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest"
        });
    });
}

if (scrollBtn) {
    scrollBtn.addEventListener("click", scrollToCurrentWord);
}

// Update word count while editing.
scriptInput.addEventListener("input", () => {
    const count = extractWords(scriptInput.value).length;
    wordCount.textContent = `${count} words`;
});

// ------------------------------------------
// 8. Full-screen teleprompter
// ------------------------------------------

if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
                document.body.classList.add("fullscreen-mode");
                fullscreenBtn.textContent = "✕ Exit Full Screen";
            } else {
                await document.exitFullscreen();
            }
        } catch (error) {
            // Keep the CSS full-screen mode as a fallback.
            document.body.classList.toggle("fullscreen-mode");

            const active = document.body.classList.contains(
                "fullscreen-mode"
            );

            fullscreenBtn.textContent = active
                ? "✕ Exit Full Screen"
                : "⛶ Full Screen";

            console.warn("Full-screen mode:", error.message);
        }
    });

    document.addEventListener("fullscreenchange", () => {
        const active = Boolean(document.fullscreenElement);

        document.body.classList.toggle("fullscreen-mode", active);

        fullscreenBtn.textContent = active
            ? "✕ Exit Full Screen"
            : "⛶ Full Screen";

        if (active) {
            scrollToCurrentWord();
        }
    });
}

// Initial setup
updateButtons();
