(() => {
    // Activity-to-sound recommendations and display labels for the sound library.
    const recommendations = {
        learning: { label: "Learning something new", sounds: ["brown", "piano", "ocean", "acoustic-piano", "ambient-synth"] },
        reviewing: { label: "Reviewing & revising", sounds: ["pink", "lofi", "cello", "432hz"] },
        coding: { label: "Coding & programming", sounds: ["brown", "lofi", "acoustic-piano", "ambient-synth"] },
        writing: { label: "Writing & typing", sounds: ["rain-window", "piano", "lofi", "cello"] },
        reading: { label: "Reading", sounds: ["rain-window", "ocean", "pink", "cello"] },
        "problem-solving": { label: "Problem solving", sounds: ["brown", "acoustic-piano", "pink", "theta6"] },
        homework: { label: "Homework", sounds: ["lofi", "brown", "852hz", "acoustic-piano", "174hz"] },
        creative: { label: "Creative work", sounds: ["gentle-creek", "lofi", "piano", "ambient-synth"] },
        memorization: { label: "Memorization", sounds: ["pink", "theta6", "gentle-creek", "ocean"] },
        break: { label: "Taking a study break", sounds: ["432hz", "ocean", "gentle-creek", "174hz"] }
    };
    const soundLabels = {
        brown: "Brown Noise",
        pink: "Pink Noise",
        "852hz": "852 Hz",
        ocean: "Ocean Waves",
        lofi: "Lo-Fi Glow",
        piano: "Calm Piano",
        "rain-window": "Rain on Window",
        "acoustic-piano": "Acoustic Guitar & Piano",
        cello: "Warm Cello",
        "ambient-synth": "Soft Ambient Synth",
        "gentle-creek": "Gentle Creek",
        "432hz": "432 Hz Solfeggio Tuning",
        theta6: "Theta Binaural Beats (6 Hz)",
        "174hz": "174 Hz Foundation Frequency"
    };
    const cards = Array.from(document.querySelectorAll("[data-sound]"));
    const activityButtons = Array.from(document.querySelectorAll("[data-activity]"));
    const recommendationCopy = document.getElementById("recommendation-copy");
    const selectedActivityLabel = document.getElementById("selected-activity-label");
    const loadRecommendationsButton = document.getElementById("load-recommendations");
    const audioStatus = document.getElementById("audio-status");
    const volumeInput = document.getElementById("master-volume");
    const volumeValue = document.getElementById("volume-value");
    const oceanAudio = document.getElementById("ocean-waves-audio");
    let audioContext;
    let masterGain;
    const activeSounds = new Map();
    const soundVolumes = new Map(cards.map((card) => [card.dataset.sound, 1]));

    // Create the shared Web Audio graph once and apply the master volume.
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

    // Generate a looping buffer of brown- or pink-spectrum noise samples.
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

    // Build a filtered noise source and return controls for stopping and volume.
    function createNoiseSound(context, kind) {
        const source = context.createBufferSource();
        source.buffer = createNoiseBuffer(context, kind === "brown" ? "brown" : "pink");
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = kind === "brown" ? "lowpass" : kind === "rain-window" ? "bandpass" : kind === "gentle-creek" ? "lowpass" : "highpass";
        filter.frequency.value = kind === "brown" ? 900 : kind === "rain-window" ? 1200 : kind === "gentle-creek" ? 1700 : 500;
        const gain = context.createGain();
        const baseVolume = ["rain-window", "gentle-creek"].includes(kind) ? 0.055 : 0.08;
        gain.gain.value = baseVolume * soundVolumes.get(kind);
        source.connect(filter).connect(gain).connect(masterGain);
        source.start();
        return {
            stop: () => source.stop(),
            setVolume: (value) => { gain.gain.setTargetAtTime(baseVolume * value, context.currentTime, 0.02); }
        };
    }

    // Sequence simple oscillator notes using the selected sound's musical profile.
    function createMusicSound(context, kind) {
        const profiles = {
            piano: { notes: [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23], type: "triangle", interval: 900, decay: 1.2 },
            lofi: { notes: [146.83, 174.61, 220, 261.63, 220, 174.61], type: "sine", interval: 1200, decay: 1.7 },
            "acoustic-piano": { notes: [196, 246.94, 293.66, 246.94, 220, 261.63, 329.63, 261.63], type: "triangle", interval: 1250, decay: 1.5 },
            cello: { notes: [65.41, 98, 130.81, 98, 73.42, 110, 146.83, 110], type: "sine", interval: 1700, decay: 2.2 },
            "ambient-synth": { notes: [174.61, 220, 261.63, 329.63, 261.63, 220], type: "sine", interval: 2200, decay: 2.8 }
        };
        const profile = profiles[kind];
        const baseVolume = kind === "ambient-synth" ? 0.04 : 0.055;
        const gain = context.createGain();
        gain.gain.value = baseVolume * soundVolumes.get(kind);
        gain.connect(masterGain);
        let noteIndex = 0;
        const playNote = () => {
            const oscillator = context.createOscillator();
            const noteGain = context.createGain();
            oscillator.type = profile.type;
            oscillator.frequency.value = profile.notes[noteIndex % profile.notes.length];
            noteGain.gain.setValueAtTime(0, context.currentTime);
            noteGain.gain.linearRampToValueAtTime(0.7, context.currentTime + 0.04);
            noteGain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + profile.decay);
            oscillator.connect(noteGain).connect(gain);
            oscillator.start();
            oscillator.stop(context.currentTime + profile.decay + 0.1);
            noteIndex += 1;
        };
        playNote();
        const interval = window.setInterval(playNote, profile.interval);
        return {
            stop: () => window.clearInterval(interval),
            setVolume: (value) => { gain.gain.setTargetAtTime(baseVolume * value, context.currentTime, 0.02); }
        };
    }

    // Play a steady sine tone at the requested frequency.
    function createToneSound(context, frequency, soundId) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.08 * soundVolumes.get(soundId);
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

    // Send slightly different tones to left and right channels for binaural audio.
    function createBinauralSound(context) {
        const oscillators = [context.createOscillator(), context.createOscillator()];
        const panners = [context.createStereoPanner(), context.createStereoPanner()];
        const gains = [context.createGain(), context.createGain()];
        const volume = soundVolumes.get("theta6");
        oscillators[0].frequency.value = 217;
        oscillators[1].frequency.value = 223;
        panners[0].pan.value = -1;
        panners[1].pan.value = 1;
        gains.forEach((gain) => { gain.gain.value = 0.035 * volume; });
        oscillators.forEach((oscillator, index) => {
            oscillator.type = "sine";
            oscillator.connect(panners[index]).connect(gains[index]).connect(masterGain);
            oscillator.start();
        });
        return {
            stop: () => {
                oscillators.forEach((oscillator) => {
                    oscillator.stop();
                    oscillator.disconnect();
                });
                panners.forEach((panner) => panner.disconnect());
                gains.forEach((gain) => gain.disconnect());
            },
            setVolume: (value) => gains.forEach((gain) => {
                gain.gain.setTargetAtTime(0.035 * value, context.currentTime, 0.02);
            })
        };
    }

    // Start or stop one sound and synchronize playback state with its card.
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
                sound = createToneSound(context, 852, soundId);
            } else if (soundId === "432hz") {
                sound = createToneSound(context, 432, soundId);
            } else if (soundId === "174hz") {
                sound = createToneSound(context, 174, soundId);
            } else if (soundId === "theta6") {
                sound = createBinauralSound(context);
            } else {
                sound = ["brown", "pink", "rain-window", "gentle-creek"].includes(soundId)
                    ? createNoiseSound(context, soundId)
                    : createMusicSound(context, soundId);
            }
        }
        activeSounds.set(soundId, sound);
        updateCard(soundId, true);
        audioStatus.textContent = `${soundLabels[soundId]} is playing.`;
    }

    // Update a sound card's playing style, button label, and pressed state.
    function updateCard(soundId, isPlaying) {
        const card = document.querySelector(`[data-sound="${soundId}"]`);
        const button = card?.querySelector(".sound-play");
        card?.classList.toggle("is-playing", isPlaying);
        if (button) {
            button.textContent = isPlaying ? "Stop" : "Play";
            button.setAttribute("aria-pressed", String(isPlaying));
        }
    }

    // Show the recommended mix and mark the selected study activity.
    function updateRecommendations(activityId) {
        const recommendation = recommendations[activityId];
        selectedActivityLabel.textContent = `Selected: ${recommendation.label}`;
        recommendationCopy.textContent = recommendation.sounds.map((sound) => soundLabels[sound]).join(", ");
        activityButtons.forEach((button) => {
            const isSelected = button.dataset.activity === activityId;
            button.classList.toggle("active", isSelected);
            button.setAttribute("aria-pressed", String(isSelected));
        });
    }

    // Connect each card's playback button and independent volume slider.
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

    // Let students change the recommendation set without starting audio.
    activityButtons.forEach((button) => {
        button.addEventListener("click", () => updateRecommendations(button.dataset.activity));
    });

    // Start every sound in the currently selected recommended mix.
    loadRecommendationsButton?.addEventListener("click", async () => {
        const activeButton = activityButtons.find((button) => button.classList.contains("active"));
        if (!activeButton) return;
        const sounds = recommendations[activeButton.dataset.activity].sounds;
        for (const sound of sounds) {
            if (!activeSounds.has(sound)) await toggleSound(sound);
        }
    });

    // Stop all active sources and reset each corresponding card.
    document.getElementById("stop-all-sounds")?.addEventListener("click", () => {
        activeSounds.forEach((sound, soundId) => {
            sound.stop();
            updateCard(soundId, false);
        });
        activeSounds.clear();
        audioStatus.textContent = "All sounds stopped.";
    });

    // Apply master gain changes to both generated audio and the ocean recording.
    volumeInput.addEventListener("input", () => {
        const value = Number(volumeInput.value);
        volumeValue.textContent = `${value}%`;
        if (masterGain) masterGain.gain.value = value / 100;
        activeSounds.forEach((sound, soundId) => {
            sound.setVolume?.(soundVolumes.get(soundId), value / 100);
        });
    });
})();
