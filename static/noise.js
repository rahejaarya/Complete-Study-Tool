(() => {
    const recommendations = {
        learning: { label: "Learning something new", sounds: ["brown", "piano", "ocean"] },
        reviewing: { label: "Reviewing & revising", sounds: ["pink", "lofi", "brown"] },
        coding: { label: "Coding & programming", sounds: ["brown", "lofi", "ocean"] },
        writing: { label: "Writing & typing", sounds: ["852hz", "piano", "lofi"] },
        reading: { label: "Reading", sounds: ["852hz", "ocean", "pink"] },
        "problem-solving": { label: "Problem solving", sounds: ["brown", "piano", "pink"] },
        homework: { label: "Homework", sounds: ["lofi", "brown", "852hz"] },
        creative: { label: "Creative work", sounds: ["ocean", "lofi", "piano"] },
        memorization: { label: "Memorization", sounds: ["pink", "brown", "ocean"] },
        break: { label: "Taking a study break", sounds: ["852hz", "ocean", "piano"] }
    };
    const soundLabels = {
        brown: "Brown Noise", pink: "Pink Noise", "852hz": "852 Hz", ocean: "Ocean Waves", lofi: "Lo-Fi Glow", piano: "Calm Piano"
    };
    const cards = Array.from(document.querySelectorAll("[data-sound]"));
    const activityButtons = Array.from(document.querySelectorAll("[data-activity]"));
    const recommendationCopy = document.getElementById("recommendation-copy");
    const selectedActivityLabel = document.getElementById("selected-activity-label");
    const audioStatus = document.getElementById("audio-status");
    const volumeInput = document.getElementById("master-volume");
    const volumeValue = document.getElementById("volume-value");
    const oceanAudio = document.getElementById("ocean-waves-audio");
    let audioContext;
    let masterGain;
    const activeSounds = new Map();
    const soundVolumes = new Map(cards.map((card) => [card.dataset.sound, 1]));

    function getAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            audioStatus.textContent = "Audio is not supported in this browser.";
            return null;
        }
        audioContext ??= new AudioContextClass();
        masterGain ??= audioContext.createGain();
        masterGain.gain.value = Number(volumeInput.value) / 100;
        masterGain.connect(audioContext.destination);
        return audioContext;
    }

    function createNoiseBuffer(context, color) {
        const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const samples = buffer.getChannelData(0);
        let lastSample = 0;
        for (let index = 0; index < samples.length; index++) {
            const randomSample = Math.random() * 2 - 1;
            if (color === "brown") {
                lastSample = (lastSample + 0.025 * randomSample) / 1.025;
                samples[index] = lastSample * 3.5;
            } else {
                lastSample = 0.98 * lastSample + 0.02 * randomSample;
                samples[index] = randomSample * 0.7 + lastSample * 0.3;
            }
        }
        return buffer;
    }

    function createNoiseSound(context, kind) {
        const source = context.createBufferSource();
        source.buffer = createNoiseBuffer(context, kind);
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = kind === "brown" ? "lowpass" : "highpass";
        filter.frequency.value = kind === "brown" ? 900 : 500;
        const gain = context.createGain();
        gain.gain.value = 0.08 * soundVolumes.get(kind);
        source.connect(filter).connect(gain).connect(masterGain);
        source.start();
        return {
            stop: () => source.stop(),
            setVolume: (value) => { gain.gain.setTargetAtTime(0.08 * value, context.currentTime, 0.02); }
        };
    }

    function createMusicSound(context, kind) {
        const gain = context.createGain();
        gain.gain.value = 0.055 * soundVolumes.get(kind);
        gain.connect(masterGain);
        const notes = kind === "piano" ? [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23] : [146.83, 174.61, 220, 261.63, 220, 174.61];
        let noteIndex = 0;
        const playNote = () => {
            const oscillator = context.createOscillator();
            const noteGain = context.createGain();
            oscillator.type = kind === "piano" ? "triangle" : "sine";
            oscillator.frequency.value = notes[noteIndex % notes.length];
            noteGain.gain.setValueAtTime(0, context.currentTime);
            noteGain.gain.linearRampToValueAtTime(0.7, context.currentTime + 0.04);
            noteGain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + (kind === "piano" ? 1.2 : 1.7));
            oscillator.connect(noteGain).connect(gain);
            oscillator.start();
            oscillator.stop(context.currentTime + 1.8);
            noteIndex += 1;
        };
        playNote();
        const interval = window.setInterval(playNote, kind === "piano" ? 900 : 1200);
        return {
            stop: () => window.clearInterval(interval),
            setVolume: (value) => { gain.gain.setTargetAtTime(0.055 * value, context.currentTime, 0.02); }
        };
    }

    function createToneSound(context, frequency) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.08 * soundVolumes.get("852hz");
        oscillator.connect(gain).connect(masterGain);
        oscillator.start();
        return {
            stop: () => {
                oscillator.stop();
                oscillator.disconnect();
                gain.disconnect();
            },
            setVolume: (value) => { gain.gain.setTargetAtTime(0.08 * value, context.currentTime, 0.02); }
        };
    }

    async function toggleSound(soundId) {
        if (activeSounds.has(soundId)) {
            activeSounds.get(soundId).stop();
            activeSounds.delete(soundId);
            updateCard(soundId, false);
            audioStatus.textContent = `${soundLabels[soundId]} stopped.`;
            return;
        }
        let sound;
        if (soundId === "ocean") {
            oceanAudio.volume = soundVolumes.get(soundId) * Number(volumeInput.value) / 100;
            try {
                await oceanAudio.play();
            } catch {
                audioStatus.textContent = "Ocean Waves could not load. Check your internet connection.";
                return;
            }
            sound = {
                stop: () => {
                    oceanAudio.pause();
                    oceanAudio.currentTime = 0;
                },
                setVolume: (soundVolume, masterVolume) => { oceanAudio.volume = soundVolume * masterVolume; }
            };
        } else {
            const context = getAudioContext();
            if (!context) return;
            await context.resume();
            if (soundId === "852hz") {
                sound = createToneSound(context, 852);
            } else {
                sound = ["brown", "pink"].includes(soundId)
                    ? createNoiseSound(context, soundId)
                    : createMusicSound(context, soundId);
            }
        }
        activeSounds.set(soundId, sound);
        updateCard(soundId, true);
        audioStatus.textContent = `${soundLabels[soundId]} is playing.`;
    }

    function updateCard(soundId, isPlaying) {
        const card = document.querySelector(`[data-sound="${soundId}"]`);
        const button = card?.querySelector(".sound-play");
        card?.classList.toggle("is-playing", isPlaying);
        if (button) {
            button.textContent = isPlaying ? "Stop" : "Play";
            button.setAttribute("aria-pressed", String(isPlaying));
        }
    }

    function updateRecommendations(activityId) {
        const recommendation = recommendations[activityId];
        selectedActivityLabel.textContent = recommendation.label;
        recommendationCopy.textContent = recommendation.sounds.map((sound) => soundLabels[sound]).join(", ");
        activityButtons.forEach((button) => button.classList.toggle("active", button.dataset.activity === activityId));
    }

    cards.forEach((card) => {
        card.querySelector(".sound-play").addEventListener("click", () => toggleSound(card.dataset.sound));
        const soundId = card.dataset.sound;
        const slider = card.querySelector(".sound-volume");
        const valueLabel = card.querySelector(".sound-volume-value");
        slider.addEventListener("input", () => {
            const volume = Number(slider.value) / 100;
            soundVolumes.set(soundId, volume);
            valueLabel.value = `${slider.value}%`;
            valueLabel.textContent = `${slider.value}%`;
            activeSounds.get(soundId)?.setVolume?.(volume, Number(volumeInput.value) / 100);
        });
    });

    activityButtons.forEach((button) => {
        button.addEventListener("click", () => updateRecommendations(button.dataset.activity));
    });

    document.getElementById("load-recommendations").addEventListener("click", async () => {
        const activeActivity = activityButtons.find((button) => button.classList.contains("active")).dataset.activity;
        const sounds = recommendations[activeActivity].sounds;
        for (const sound of sounds) {
            if (!activeSounds.has(sound)) await toggleSound(sound);
        }
    });

    document.getElementById("stop-all-sounds").addEventListener("click", () => {
        activeSounds.forEach((sound, soundId) => {
            sound.stop();
            updateCard(soundId, false);
        });
        activeSounds.clear();
        audioStatus.textContent = "All sounds stopped.";
    });

    volumeInput.addEventListener("input", () => {
        const value = Number(volumeInput.value);
        volumeValue.textContent = `${value}%`;
        if (masterGain) masterGain.gain.value = value / 100;
        activeSounds.forEach((sound, soundId) => {
            sound.setVolume?.(soundVolumes.get(soundId), value / 100);
        });
    });
})();
